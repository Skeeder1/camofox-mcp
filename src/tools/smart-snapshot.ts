/**
 * Smart Snapshot — LLM-summarized accessibility tree.
 *
 * Refactored to use the unified LLM router (src/llm/router.ts). Keeps the
 * public tool signature unchanged for back-compat. Cache + on-disk telemetry
 * preserved.
 */

import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { okResult, toErrorResult } from "../errors.js";
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
const PROMPT_PATH = join(__dirname, "..", "prompts", "smart-snapshot-system.md");

function loadPrompt(): string {
  return readFileSync(PROMPT_PATH, "utf-8");
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function isFalsy(value: string | undefined): boolean {
  if (!value) return true;
  return ["false", "0", "no", "n", "off"].includes(value.trim().toLowerCase());
}

function debug(...args: unknown[]): void {
  if (!isFalsy(process.env.CAMOFOX_DEBUG)) {
    console.error("[smart_snapshot]", ...args);
  }
}

// ── File logger ─────────────────────────────────────────────────────────────
const LOG_DIR = join(homedir(), ".camofox-mcp", "logs", "smart-snapshot");

function logCall(entry: Record<string, unknown>): void {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const status = String(entry.status ?? "unknown");
    const filename = join(LOG_DIR, `${ts}_${status}.json`);
    appendFileSync(filename, JSON.stringify({ ts: new Date().toISOString(), ...entry }, null, 2));
  } catch {
    // Non-fatal — never break the tool over logging
  }
}

// ── Cache (5 s TTL, keyed on snapshot+task+lastAction) ──────────────────────
interface CacheEntry {
  result: Record<string, unknown>;
  ts: number;
}

const CACHE_TTL_MS = 5_000;
const cache = new Map<string, CacheEntry>();

function cacheKey(snapshot: string, task: string, lastAction: string): string {
  return createHash("sha256")
    .update(snapshot)
    .update(task)
    .update(lastAction)
    .digest("hex")
    .slice(0, 16);
}

function getCached(key: string): Record<string, unknown> | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return entry.result;
}

function setCache(key: string, result: Record<string, unknown>): void {
  cache.set(key, { result, ts: Date.now() });
  if (cache.size > 50) {
    const now = Date.now();
    for (const [k, v] of cache) {
      if (now - v.ts > CACHE_TTL_MS) cache.delete(k);
    }
  }
}

// ── Registration ────────────────────────────────────────────────────────────
export function registerSmartSnapshotTools(server: McpServer, deps: ToolDeps): void {
  const llmConfig: LLMConfig = loadLLMConfig();
  const systemPrompt = loadPrompt();

  debug("LLM config:", { ...llmConfig, apiKey: llmConfig.apiKey ? "***" : undefined });

  const DISABLED_RESULT = {
    error: "smart_snapshot_disabled",
    raw_snapshot_available: true,
    alerts: "smart_snapshot is disabled — use mcp_camofox_snapshot for raw output",
  };

  server.tool(
    "smart_snapshot",
    "Get an LLM-summarized page state as compact JSON optimized for navigation decisions. Returns structured data (page type, task-relevant elements, forms, items, pagination, alerts) instead of a raw accessibility tree. Provide `current_task` and `last_action` for best results. Falls back to error object if the LLM is unavailable; use `snapshot` as fallback for the raw tree. Requires OPEN_ROUTER (or CAMOFOX_LLM_API_KEY).",
    {
      tabId: z.string().min(1).describe("Tab ID from create_tab"),
      userId: z.string().optional().describe("Override userId for this call. Defaults to tracked tab userId."),
      current_task: z.string().optional().describe("What the agent is currently trying to accomplish. Improves element prioritization."),
      last_action: z.string().optional().describe("The action just executed (e.g. 'clicked search button'). Enables change detection. Omit on first call."),
      include_raw_on_failure: z.boolean().optional().describe("If true and the summarizer fails, include the raw ARIA snapshot in the fallback result. Default false."),
    },
    async (args) => {
      try {
        if (!llmConfig.enabled) {
          return okResult(DISABLED_RESULT);
        }

        const tracked = getTrackedTab(args.tabId);
        const userId = args.userId ?? tracked.userId;
        const response = await deps.client.snapshot(args.tabId, userId);
        incrementToolCall(args.tabId);
        updateTabUrl(args.tabId, response.url);
        updateRefsCount(args.tabId, response.refsCount);

        const currentTask = args.current_task ?? "not specified";
        const lastAction = args.last_action ?? "null (first call)";

        const key = cacheKey(response.snapshot, currentTask, lastAction);
        const cached = getCached(key);
        if (cached) {
          debug("Cache HIT", key);
          return okResult({ ...cached, _meta: { cached: true } });
        }

        const startMs = Date.now();
        try {
          const userMsg = `ARIA_SNAPSHOT:\n${response.snapshot}\n\nCURRENT_TASK: ${currentTask}\nLAST_ACTION: ${lastAction}`;
          const result = await callLLMJson<Record<string, unknown>>(
            llmConfig,
            [systemMessage(systemPrompt), userMessage(userMsg)],
            { purpose: "summarize", responseFormat: "json_object" },
          );

          const latencyMs = Date.now() - startMs;
          if (
            typeof result.json !== "object" ||
            result.json === null ||
            Array.isArray(result.json)
          ) {
            throw new Error("Summarizer returned non-object JSON");
          }

          logCall({
            status: result.repaired ? "repaired" : "ok",
            model: result.model,
            current_task: currentTask,
            last_action: lastAction,
            snapshot_chars: response.snapshot.length,
            snapshot_preview: response.snapshot.slice(0, 300),
            latency_ms: latencyMs,
            usage: result.usage,
            used_fallback: result.usedFallback,
          });

          setCache(key, result.json);

          return okResult({
            ...result.json,
            _meta: {
              model: result.model,
              latency_ms: latencyMs,
              snapshot_chars: response.snapshot.length,
              used_fallback: result.usedFallback,
              repaired: result.repaired,
            },
          });
        } catch (summarizerError) {
          const latencyMs = Date.now() - startMs;
          const errMsg =
            summarizerError instanceof Error ? summarizerError.message : String(summarizerError);

          if (summarizerError instanceof LLMDisabledError) {
            return okResult(DISABLED_RESULT);
          }

          console.error("[smart_snapshot] Summarizer failed:", errMsg);
          logCall({
            status: "failed",
            current_task: currentTask,
            last_action: lastAction,
            snapshot_chars: response.snapshot.length,
            latency_ms: latencyMs,
            error: errMsg,
          });

          const fallback: Record<string, unknown> = {
            error: "summarizer_failed",
            raw_snapshot_available: true,
            alerts: "Summarizer unavailable — use mcp_camofox_snapshot for raw output",
            _meta: {
              latency_ms: latencyMs,
              snapshot_chars: response.snapshot.length,
              error: errMsg,
            },
          };

          if (args.include_raw_on_failure) {
            fallback.raw_snapshot = response.snapshot;
          }

          return okResult(fallback);
        }
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );
}
