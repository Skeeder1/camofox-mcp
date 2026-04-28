/**
 * Semantic tools (Layer L1) — Stagehand-style high-level browser actions
 * powered by the unified LLM router.
 *
 * Tools registered here:
 *  - extract            : structured-data extraction with optional JSON schema
 *  - observe            : list relevant interactive elements with relevance scores
 *  - act                : LLM-planned single action ("click login", "type 'paris' in city")
 *  - find_element_by_prompt : resolve a single ref from a description
 *  - execute            : run a typed action plan atomically
 *
 * All five share a small in-memory cache (5 s TTL) keyed on
 * sha256(snapshot+intent+schema) to make repeated probes cheap.
 */

import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { okResult, toErrorResult, AppError } from "../errors.js";
import { getTrackedTab, incrementToolCall, updateRefsCount, updateTabUrl } from "../state.js";
import type { ToolDeps } from "../server.js";
import {
  callLLMJson,
  loadLLMConfig,
  systemMessage,
  userMessage,
  LLMDisabledError,
  type LLMConfig,
} from "../llm/index.js";

// ── Prompt loading ──────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, "..", "prompts");

function loadPromptFile(name: string): string {
  return readFileSync(join(PROMPTS_DIR, name), "utf-8");
}

// ── Cache ───────────────────────────────────────────────────────────────────
interface CacheEntry<T> {
  value: T;
  ts: number;
}

const CACHE_TTL_MS = 5_000;
const CACHE_MAX = 50;

class TtlCache<T> {
  private map = new Map<string, CacheEntry<T>>();

  get(key: string): T | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.ts > CACHE_TTL_MS) {
      this.map.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    this.map.set(key, { value, ts: Date.now() });
    if (this.map.size > CACHE_MAX) {
      const now = Date.now();
      for (const [k, v] of this.map) {
        if (now - v.ts > CACHE_TTL_MS) this.map.delete(k);
      }
    }
  }
}

function cacheKey(...parts: string[]): string {
  const h = createHash("sha256");
  for (const p of parts) h.update(p).update("\x00");
  return h.digest("hex").slice(0, 16);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function fetchSnapshot(deps: ToolDeps, tabId: string, userIdOverride?: string) {
  const tracked = getTrackedTab(tabId);
  const userId = userIdOverride ?? tracked.userId;
  const response = await deps.client.snapshot(tabId, userId);
  incrementToolCall(tabId);
  updateTabUrl(tabId, response.url);
  updateRefsCount(tabId, response.refsCount);
  return { response, userId };
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

// ── Schemas ─────────────────────────────────────────────────────────────────

const ExtractResultSchema = z
  .object({
    data: z.unknown(),
    missing_fields: z.array(z.string()).optional(),
    confidence: z.number().min(0).max(1).optional(),
    source_refs: z.array(z.string()).optional(),
    notes: z.string().optional(),
  })
  .passthrough();

const ActResultSchema = z
  .object({
    action: z.enum(["click", "type", "scroll", "navigate", "wait", "noop"]),
    ref: z.string().optional(),
    selector: z.string().optional(),
    text: z.string().optional(),
    url: z.string().optional(),
    direction: z.enum(["up", "down"]).optional(),
    amount: z.number().optional(),
    ms: z.number().optional(),
    confidence: z.number().min(0).max(1).optional(),
    reasoning: z.string().optional(),
  })
  .passthrough();

const ObserveResultSchema = z
  .object({
    page_type: z.string().optional(),
    page_title: z.string().optional(),
    url: z.string().optional(),
    candidates: z
      .array(
        z
          .object({
            ref: z.string().optional(),
            role: z.string().optional(),
            label: z.string().optional(),
            purpose: z.string().optional(),
            relevance: z.number().min(0).max(1).optional(),
          })
          .passthrough(),
      )
      .optional(),
    summary: z.string().optional(),
  })
  .passthrough();

const PlanStepSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("click"), ref: z.string().optional(), selector: z.string().optional() }),
  z.object({ type: z.literal("type"), ref: z.string().optional(), selector: z.string().optional(), text: z.string() }),
  z.object({ type: z.literal("scroll"), direction: z.enum(["up", "down"]), amount: z.number().int().positive().optional() }),
  z.object({ type: z.literal("navigate"), url: z.string().min(1) }),
  z.object({ type: z.literal("wait"), ms: z.number().int().positive() }),
  z.object({ type: z.literal("press_key"), key: z.string().min(1) }),
]);

type PlanStep = z.infer<typeof PlanStepSchema>;

// ── Plan execution ──────────────────────────────────────────────────────────

interface StepResult {
  index: number;
  type: PlanStep["type"];
  ok: boolean;
  details?: Record<string, unknown>;
  error?: string;
}

async function executePlan(
  deps: ToolDeps,
  tabId: string,
  userId: string,
  plan: PlanStep[],
  stopOnError: boolean,
): Promise<{ results: StepResult[]; aborted: boolean }> {
  const results: StepResult[] = [];
  for (let i = 0; i < plan.length; i++) {
    const step = plan[i]!;
    try {
      let details: Record<string, unknown> | undefined;
      switch (step.type) {
        case "click": {
          if (!step.ref && !step.selector) {
            throw new AppError("VALIDATION_ERROR", "click step requires ref or selector");
          }
          const r = await deps.client.click(tabId, { ref: step.ref, selector: step.selector }, userId);
          details = { success: r.success, navigated: r.navigated };
          break;
        }
        case "type": {
          if (!step.ref && !step.selector) {
            throw new AppError("VALIDATION_ERROR", "type step requires ref or selector");
          }
          await deps.client.smartTypeText(tabId, { ref: step.ref, selector: step.selector }, step.text, userId);
          details = { typed: step.text.length };
          break;
        }
        case "scroll": {
          await deps.client.scroll(tabId, step.direction, step.amount, userId);
          details = { direction: step.direction, amount: step.amount ?? 500 };
          break;
        }
        case "navigate": {
          const r = await deps.client.navigate(tabId, step.url, userId);
          details = { url: r.url, title: r.title };
          break;
        }
        case "wait": {
          await new Promise((res) => setTimeout(res, step.ms));
          details = { waited_ms: step.ms };
          break;
        }
        case "press_key": {
          await deps.client.pressKey(tabId, step.key, userId);
          details = { key: step.key };
          break;
        }
      }
      incrementToolCall(tabId);
      results.push({ index: i, type: step.type, ok: true, details });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      results.push({ index: i, type: step.type, ok: false, error: errMsg });
      if (stopOnError) {
        return { results, aborted: true };
      }
    }
  }
  return { results, aborted: false };
}

// ── Registration ────────────────────────────────────────────────────────────

export function registerSemanticTools(server: McpServer, deps: ToolDeps): void {
  const llmConfig: LLMConfig = loadLLMConfig();
  const extractPrompt = loadPromptFile("semantic-extract.md");
  const actPrompt = loadPromptFile("semantic-act.md");
  const observePrompt = loadPromptFile("semantic-observe.md");

  const extractCache = new TtlCache<Record<string, unknown>>();
  const observeCache = new TtlCache<Record<string, unknown>>();
  const actCache = new TtlCache<Record<string, unknown>>();

  function ensureLLMReady(): { error: string } | null {
    if (!llmConfig.enabled) {
      return { error: "LLM_DISABLED: LLM is disabled (CAMOFOX_LLM_ENABLED=false)" };
    }
    if (!llmConfig.apiKey) {
      return {
        error:
          "LLM_DISABLED: no API key configured. Set OPEN_ROUTER, CAMOFOX_LLM_API_KEY, or the provider-specific env var.",
      };
    }
    return null;
  }

  // ── extract ──────────────────────────────────────────────────────────────
  server.tool(
    "extract",
    "Extract structured data from the current page. The LLM reads the accessibility snapshot and returns `{data, missing_fields, confidence, source_refs}`. Pass `schema` (JSON Schema) to enforce a specific output shape — strongly recommended. Pass `query` describing what to extract. Falls back to error object if LLM is unavailable.",
    {
      tabId: z.string().min(1).describe("Tab ID from create_tab"),
      query: z.string().min(1).describe("What to extract (e.g. 'all product cards: name, price, rating')"),
      schema: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Optional JSON Schema describing the expected output shape. Strongly recommended."),
      userId: z.string().optional().describe("Override userId."),
    },
    async (args) => {
      try {
        const guard = ensureLLMReady();
        if (guard) return okResult(guard);

        const { response, userId } = await fetchSnapshot(deps, args.tabId, args.userId);
        const schemaStr = args.schema ? safeStringify(args.schema) : "";
        const key = cacheKey("extract", response.snapshot, args.query, schemaStr);
        const cached = extractCache.get(key);
        if (cached) return okResult({ ...cached, _meta: { cached: true } });

        const userMsg = `ARIA_SNAPSHOT:\n${response.snapshot}\n\nQUERY:\n${args.query}\n\nSCHEMA (JSON Schema, may be empty):\n${schemaStr || "(none — use your judgment)"}`;
        const start = Date.now();
        const result = await callLLMJson<Record<string, unknown>>(
          llmConfig,
          [systemMessage(extractPrompt), userMessage(userMsg)],
          { purpose: "extract", responseFormat: "json_object" },
        );
        const latencyMs = Date.now() - start;

        const validated = ExtractResultSchema.safeParse(result.json);
        if (!validated.success) {
          // Best-effort: return the raw JSON anyway with low confidence flag
          const fallback = { data: result.json, confidence: 0.3, missing_fields: [], notes: "schema validation failed" };
          extractCache.set(key, fallback);
          return okResult({ ...fallback, _meta: { model: result.model, latency_ms: latencyMs, repaired: result.repaired } });
        }
        extractCache.set(key, validated.data);
        // Acknowledge userId so we don't get unused-variable warnings in case
        // future refactors depend on it.
        void userId;
        return okResult({
          ...validated.data,
          _meta: { model: result.model, latency_ms: latencyMs, repaired: result.repaired, used_fallback: result.usedFallback },
        });
      } catch (err) {
        if (err instanceof LLMDisabledError) {
          return okResult({ error: `LLM_DISABLED: ${err.message}` });
        }
        return toErrorResult(err);
      }
    },
  );

  // ── observe ──────────────────────────────────────────────────────────────
  server.tool(
    "observe",
    "List relevant interactive elements on the current page (refs + roles + labels + purposes + relevance scores). Cheaper than `snapshot` for 'what can I do here?' Pass `intent` to focus the ranking on a specific goal.",
    {
      tabId: z.string().min(1).describe("Tab ID from create_tab"),
      intent: z.string().optional().describe("Optional goal to focus the ranking ('I want to log in')"),
      userId: z.string().optional().describe("Override userId."),
    },
    async (args) => {
      try {
        const guard = ensureLLMReady();
        if (guard) return okResult(guard);

        const { response } = await fetchSnapshot(deps, args.tabId, args.userId);
        const intent = args.intent ?? "(none — rank by general utility)";
        const key = cacheKey("observe", response.snapshot, intent);
        const cached = observeCache.get(key);
        if (cached) return okResult({ ...cached, _meta: { cached: true } });

        const userMsg = `ARIA_SNAPSHOT:\n${response.snapshot}\n\nURL: ${response.url}\nINTENT: ${intent}`;
        const start = Date.now();
        const result = await callLLMJson<Record<string, unknown>>(
          llmConfig,
          [systemMessage(observePrompt), userMessage(userMsg)],
          { purpose: "observe", responseFormat: "json_object" },
        );
        const latencyMs = Date.now() - start;

        const validated = ObserveResultSchema.safeParse(result.json);
        const value = validated.success ? validated.data : (result.json as Record<string, unknown>);
        observeCache.set(key, value);
        return okResult({
          ...value,
          _meta: { model: result.model, latency_ms: latencyMs, repaired: result.repaired, used_fallback: result.usedFallback },
        });
      } catch (err) {
        if (err instanceof LLMDisabledError) {
          return okResult({ error: `LLM_DISABLED: ${err.message}` });
        }
        return toErrorResult(err);
      }
    },
  );

  // ── act ──────────────────────────────────────────────────────────────────
  server.tool(
    "act",
    "Perform a high-level action by intent ('click the login button', 'type 'paris' in the city field', 'scroll to comments'). The LLM picks the best ref and the tool executes the action. Returns the action that was taken plus its result. If `dry_run: true`, returns the plan without executing.",
    {
      tabId: z.string().min(1).describe("Tab ID from create_tab"),
      intent: z.string().min(1).describe("Natural-language action ('click sign in', 'type \\'cat\\' in search')"),
      dry_run: z.boolean().optional().describe("If true, return the planned action without executing. Default false."),
      min_confidence: z.number().min(0).max(1).optional().describe("Minimum confidence to auto-execute. Below this, returns plan with `executed: false`. Default 0.6."),
      userId: z.string().optional().describe("Override userId."),
    },
    async (args) => {
      try {
        const guard = ensureLLMReady();
        if (guard) return okResult(guard);

        const minConfidence = args.min_confidence ?? 0.6;
        const { response, userId } = await fetchSnapshot(deps, args.tabId, args.userId);
        const key = cacheKey("act", response.snapshot, args.intent);
        let plan = actCache.get(key);
        let llmMeta: Record<string, unknown> | undefined;

        if (!plan) {
          const userMsg = `ARIA_SNAPSHOT:\n${response.snapshot}\n\nINTENT: ${args.intent}\nLAST_ACTION: (n/a)`;
          const start = Date.now();
          const result = await callLLMJson<Record<string, unknown>>(
            llmConfig,
            [systemMessage(actPrompt), userMessage(userMsg)],
            { purpose: "act", responseFormat: "json_object" },
          );
          const latencyMs = Date.now() - start;
          const validated = ActResultSchema.safeParse(result.json);
          if (!validated.success) {
            return okResult({
              error: "act_plan_invalid",
              raw: result.json,
              issues: validated.error.issues.map((i) => i.message),
            });
          }
          plan = validated.data;
          actCache.set(key, plan);
          llmMeta = {
            model: result.model,
            latency_ms: latencyMs,
            repaired: result.repaired,
            used_fallback: result.usedFallback,
          };
        }

        const action = plan.action as string;
        const confidence = (plan.confidence as number | undefined) ?? 0;

        if (args.dry_run) {
          return okResult({ executed: false, reason: "dry_run", plan, _meta: llmMeta });
        }

        if (action === "noop") {
          return okResult({ executed: false, reason: "noop", plan, _meta: llmMeta });
        }

        if (confidence < minConfidence) {
          return okResult({
            executed: false,
            reason: "low_confidence",
            min_confidence: minConfidence,
            plan,
            _meta: llmMeta,
          });
        }

        // Convert plan to a single-step PlanStep for executePlan
        let step: PlanStep;
        switch (action) {
          case "click":
            step = { type: "click", ref: plan.ref as string | undefined, selector: plan.selector as string | undefined };
            break;
          case "type":
            step = {
              type: "type",
              ref: plan.ref as string | undefined,
              selector: plan.selector as string | undefined,
              text: (plan.text as string | undefined) ?? "",
            };
            break;
          case "scroll":
            step = {
              type: "scroll",
              direction: ((plan.direction as "up" | "down" | undefined) ?? "down"),
              amount: plan.amount as number | undefined,
            };
            break;
          case "navigate":
            step = { type: "navigate", url: (plan.url as string | undefined) ?? "" };
            break;
          case "wait":
            step = { type: "wait", ms: (plan.ms as number | undefined) ?? 1000 };
            break;
          default:
            return okResult({ executed: false, reason: `unknown_action:${action}`, plan, _meta: llmMeta });
        }

        const exec = await executePlan(deps, args.tabId, userId, [step], true);
        return okResult({
          executed: true,
          plan,
          result: exec.results[0],
          _meta: llmMeta,
        });
      } catch (err) {
        if (err instanceof LLMDisabledError) {
          return okResult({ error: `LLM_DISABLED: ${err.message}` });
        }
        return toErrorResult(err);
      }
    },
  );

  // ── find_element_by_prompt ──────────────────────────────────────────────
  server.tool(
    "find_element_by_prompt",
    "Resolve a single element ref from a natural-language description, without executing. Returns `{ref, role, label, confidence}`. Use to chain custom logic on top of an LLM-resolved ref.",
    {
      tabId: z.string().min(1).describe("Tab ID from create_tab"),
      prompt: z.string().min(1).describe("Description of the target element ('the search input', 'the next page link')"),
      userId: z.string().optional().describe("Override userId."),
    },
    async (args) => {
      try {
        const guard = ensureLLMReady();
        if (guard) return okResult(guard);

        const { response } = await fetchSnapshot(deps, args.tabId, args.userId);
        const userMsg = `ARIA_SNAPSHOT:\n${response.snapshot}\n\nINTENT: click ${args.prompt}\nLAST_ACTION: (n/a)`;
        const start = Date.now();
        const result = await callLLMJson<Record<string, unknown>>(
          llmConfig,
          [systemMessage(actPrompt), userMessage(userMsg)],
          { purpose: "find_element", responseFormat: "json_object" },
        );
        const latencyMs = Date.now() - start;

        const validated = ActResultSchema.safeParse(result.json);
        if (!validated.success) {
          return okResult({ error: "find_element_invalid", raw: result.json });
        }
        const plan = validated.data;
        return okResult({
          ref: plan.ref ?? null,
          selector: plan.selector ?? null,
          confidence: plan.confidence ?? 0,
          reasoning: plan.reasoning ?? null,
          _meta: {
            model: result.model,
            latency_ms: latencyMs,
            repaired: result.repaired,
            used_fallback: result.usedFallback,
          },
        });
      } catch (err) {
        if (err instanceof LLMDisabledError) {
          return okResult({ error: `LLM_DISABLED: ${err.message}` });
        }
        return toErrorResult(err);
      }
    },
  );

  // ── execute ──────────────────────────────────────────────────────────────
  server.tool(
    "execute",
    "Run a typed plan of actions atomically. Each step is one of: click, type, scroll, navigate, wait, press_key. Stops on first error by default. Returns per-step results. Useful for multi-field forms or short scripted flows. Does NOT use the LLM — pass refs/selectors/values directly.",
    {
      tabId: z.string().min(1).describe("Tab ID from create_tab"),
      plan: z.array(PlanStepSchema).min(1).describe("Ordered list of steps to execute"),
      stop_on_error: z.boolean().optional().describe("Abort on first failed step. Default true."),
      userId: z.string().optional().describe("Override userId."),
    },
    async (args) => {
      try {
        const tracked = getTrackedTab(args.tabId);
        const userId = args.userId ?? tracked.userId;
        const stopOnError = args.stop_on_error ?? true;
        const start = Date.now();
        const exec = await executePlan(deps, args.tabId, userId, args.plan as PlanStep[], stopOnError);
        const latencyMs = Date.now() - start;
        const ok = exec.results.every((r) => r.ok);
        return okResult({
          ok,
          aborted: exec.aborted,
          steps: exec.results,
          _meta: { latency_ms: latencyMs, total_steps: args.plan.length, executed_steps: exec.results.length },
        });
      } catch (err) {
        return toErrorResult(err);
      }
    },
  );
}
