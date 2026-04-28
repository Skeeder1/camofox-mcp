/**
 * LLM Router — single entry point for every LLM call in camofox-mcp.
 *
 * Responsibilities:
 *  - Pick the right model for the call's purpose (extract/observe/act/vision/...)
 *  - Translate our provider-agnostic message format to the OpenAI-compatible
 *    chat-completions API (used by OpenRouter, OpenAI, Gemini openai-compat
 *    endpoint, and any custom proxy)
 *  - Handle timeouts, fallback models, JSON repair, telemetry
 *  - Provide a high-level `callJson<T>()` for tools that want structured output
 *
 * Providers other than OpenAI-compat (e.g. native Anthropic /v1/messages) are
 * deliberately routed through OpenRouter to keep one HTTP path.
 */

import { parseJsonLenient, stripMarkdownFences } from "./repair.js";
import type {
  LLMCallOptions,
  LLMCallResult,
  LLMContentPart,
  LLMJsonResult,
  LLMMessage,
  LLMUsage,
} from "./types.js";
import type { LLMConfig } from "./config.js";

// ── Errors ──────────────────────────────────────────────────────────────────

export class LLMDisabledError extends Error {
  readonly code = "LLM_DISABLED";
  constructor(reason: string) {
    super(reason);
    this.name = "LLMDisabledError";
  }
}

export class LLMTransportError extends Error {
  readonly code = "LLM_TRANSPORT_ERROR";
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "LLMTransportError";
    this.status = status;
  }
}

export class LLMTimeoutError extends Error {
  readonly code = "LLM_TIMEOUT";
  constructor(message: string) {
    super(message);
    this.name = "LLMTimeoutError";
  }
}

// ── Telemetry ───────────────────────────────────────────────────────────────

export interface LLMTelemetryEvent {
  ts: string;
  purpose: string;
  model: string;
  provider: string;
  status: "ok" | "error" | "fallback_used" | "repaired";
  latencyMs: number;
  usage?: LLMUsage;
  error?: string;
}

type TelemetrySink = (event: LLMTelemetryEvent) => void;

const telemetrySinks: TelemetrySink[] = [];

export function onLLMTelemetry(sink: TelemetrySink): () => void {
  telemetrySinks.push(sink);
  return () => {
    const idx = telemetrySinks.indexOf(sink);
    if (idx >= 0) telemetrySinks.splice(idx, 1);
  };
}

function emitTelemetry(event: LLMTelemetryEvent): void {
  for (const sink of telemetrySinks) {
    try {
      sink(event);
    } catch {
      // Telemetry must never throw
    }
  }
}

// ── Aggregate counters (exposed via getStats / get_stats tool) ──────────────

interface RouterCounters {
  totalCalls: number;
  okCalls: number;
  errorCalls: number;
  repairedCalls: number;
  fallbackCalls: number;
  totalLatencyMs: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
}

const counters: RouterCounters = {
  totalCalls: 0,
  okCalls: 0,
  errorCalls: 0,
  repairedCalls: 0,
  fallbackCalls: 0,
  totalLatencyMs: 0,
  totalPromptTokens: 0,
  totalCompletionTokens: 0,
};

export function getRouterCounters(): Readonly<RouterCounters> {
  return { ...counters };
}

// ── Message conversion ─────────────────────────────────────────────────────

interface OpenAICompatContent {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

interface OpenAICompatMessage {
  role: "system" | "user" | "assistant";
  content: string | OpenAICompatContent[];
}

function partToOpenAI(part: LLMContentPart): OpenAICompatContent {
  if (part.type === "text") return { type: "text", text: part.text };
  return {
    type: "image_url",
    image_url: { url: `data:${part.mimeType};base64,${part.data}` },
  };
}

function messageToOpenAI(msg: LLMMessage): OpenAICompatMessage {
  if (typeof msg.content === "string") {
    return { role: msg.role, content: msg.content };
  }
  return { role: msg.role, content: msg.content.map(partToOpenAI) };
}

function hasVisionParts(messages: LLMMessage[]): boolean {
  return messages.some(
    (m) => Array.isArray(m.content) && m.content.some((p) => p.type === "image"),
  );
}

// ── Model selection ─────────────────────────────────────────────────────────

function pickModel(config: LLMConfig, opts: LLMCallOptions, isVision: boolean): string {
  if (opts.model) return opts.model;
  if (isVision) return opts.model ?? config.visionModel;
  if (opts.purpose && config.perPurposeModels[opts.purpose]) {
    return config.perPurposeModels[opts.purpose] as string;
  }
  return config.defaultModel;
}

// ── Single attempt against the OpenAI-compat endpoint ──────────────────────

interface AttemptArgs {
  config: LLMConfig;
  model: string;
  messages: LLMMessage[];
  opts: LLMCallOptions;
  isVision: boolean;
}

interface AttemptResult {
  text: string;
  finishReason?: string;
  usage?: LLMUsage;
  latencyMs: number;
}

async function attemptOpenAICompat(args: AttemptArgs): Promise<AttemptResult> {
  const { config, model, messages, opts, isVision } = args;
  const timeoutMs = opts.timeoutMs ?? config.timeoutMs;
  const internalController = new AbortController();
  const timer = setTimeout(() => internalController.abort(new Error("timeout")), timeoutMs);

  // Compose external + internal abort signals
  const externalAbort = (): void => internalController.abort(new Error("aborted"));
  if (opts.signal) opts.signal.addEventListener("abort", externalAbort, { once: true });

  const startMs = Date.now();
  try {
    const body: Record<string, unknown> = {
      model,
      messages: messages.map(messageToOpenAI),
      max_tokens: opts.maxTokens ?? config.maxTokens,
      temperature: opts.temperature ?? config.temperature,
    };

    const wantsJson = opts.responseFormat === "json_object" || (config.jsonFormat && opts.purpose !== "vision" && !isVision && opts.responseFormat !== "text");
    if (wantsJson) {
      body.response_format = { type: "json_object" };
    }

    const url = `${config.apiUrl}/chat/completions`;
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`;

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: internalController.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new LLMTransportError(
        `LLM provider returned ${response.status}: ${text.slice(0, 500)}`,
        response.status,
      );
    }

    type ApiResponse = {
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    const data = (await response.json()) as ApiResponse;
    const choice = data.choices?.[0];
    const content = choice?.message?.content;
    if (typeof content !== "string") {
      throw new LLMTransportError("LLM response missing choices[0].message.content");
    }
    const finishReason = choice?.finish_reason;
    const usage: LLMUsage | undefined = data.usage
      ? {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
        }
      : undefined;

    return { text: content, finishReason, usage, latencyMs: Date.now() - startMs };
  } catch (err) {
    if (err instanceof LLMTransportError) throw err;
    if (err instanceof Error && (err.name === "AbortError" || err.message === "timeout")) {
      throw new LLMTimeoutError(`LLM call exceeded timeout of ${timeoutMs}ms (model=${model})`);
    }
    if (err instanceof Error) throw new LLMTransportError(err.message);
    throw new LLMTransportError("Unknown LLM transport error");
  } finally {
    clearTimeout(timer);
    if (opts.signal) opts.signal.removeEventListener("abort", externalAbort);
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Make a raw LLM call. Returns text content unparsed.
 *
 * Throws LLMDisabledError if no API key is configured and LLM is enabled.
 */
export async function callLLM(
  config: LLMConfig,
  messages: LLMMessage[],
  opts: LLMCallOptions = {},
): Promise<LLMCallResult> {
  if (!config.enabled) {
    throw new LLMDisabledError("LLM is disabled (CAMOFOX_LLM_ENABLED=false)");
  }
  if (!config.apiKey) {
    throw new LLMDisabledError(
      `LLM API key not configured. Set OPEN_ROUTER, CAMOFOX_LLM_API_KEY, or the provider-specific key in .env / ~/.camofox-mcp/config.yaml`,
    );
  }

  const isVision = opts.vision === true || hasVisionParts(messages);
  const primaryModel = pickModel(config, opts, isVision);
  const fallbackModel = opts.fallbackModel ?? config.fallbackModel;

  counters.totalCalls += 1;
  const purpose = opts.purpose ?? "generic";

  // Try primary
  try {
    const r = await attemptOpenAICompat({ config, model: primaryModel, messages, opts, isVision });
    counters.okCalls += 1;
    counters.totalLatencyMs += r.latencyMs;
    if (r.usage?.promptTokens) counters.totalPromptTokens += r.usage.promptTokens;
    if (r.usage?.completionTokens) counters.totalCompletionTokens += r.usage.completionTokens;
    emitTelemetry({
      ts: new Date().toISOString(),
      purpose,
      model: primaryModel,
      provider: config.provider,
      status: "ok",
      latencyMs: r.latencyMs,
      usage: r.usage,
    });
    return {
      text: stripMarkdownFences(r.text),
      model: primaryModel,
      provider: config.provider,
      usage: r.usage,
      finishReason: r.finishReason,
      latencyMs: r.latencyMs,
      usedFallback: false,
    };
  } catch (primaryErr) {
    if (!fallbackModel || fallbackModel === primaryModel) {
      counters.errorCalls += 1;
      emitTelemetry({
        ts: new Date().toISOString(),
        purpose,
        model: primaryModel,
        provider: config.provider,
        status: "error",
        latencyMs: 0,
        error: primaryErr instanceof Error ? primaryErr.message : String(primaryErr),
      });
      throw primaryErr;
    }

    // Try fallback
    try {
      const r = await attemptOpenAICompat({ config, model: fallbackModel, messages, opts, isVision });
      counters.fallbackCalls += 1;
      counters.okCalls += 1;
      counters.totalLatencyMs += r.latencyMs;
      if (r.usage?.promptTokens) counters.totalPromptTokens += r.usage.promptTokens;
      if (r.usage?.completionTokens) counters.totalCompletionTokens += r.usage.completionTokens;
      emitTelemetry({
        ts: new Date().toISOString(),
        purpose,
        model: fallbackModel,
        provider: config.provider,
        status: "fallback_used",
        latencyMs: r.latencyMs,
        usage: r.usage,
      });
      return {
        text: stripMarkdownFences(r.text),
        model: fallbackModel,
        provider: config.provider,
        usage: r.usage,
        finishReason: r.finishReason,
        latencyMs: r.latencyMs,
        usedFallback: true,
      };
    } catch (fallbackErr) {
      counters.errorCalls += 1;
      emitTelemetry({
        ts: new Date().toISOString(),
        purpose,
        model: fallbackModel,
        provider: config.provider,
        status: "error",
        latencyMs: 0,
        error: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
      });
      throw fallbackErr;
    }
  }
}

/**
 * Make an LLM call and parse the response as JSON. Handles markdown fences and
 * truncation repair automatically.
 */
export async function callLLMJson<T = Record<string, unknown>>(
  config: LLMConfig,
  messages: LLMMessage[],
  opts: LLMCallOptions = {},
): Promise<LLMJsonResult<T>> {
  const finalOpts: LLMCallOptions = {
    responseFormat: "json_object",
    ...opts,
  };

  const result = await callLLM(config, messages, finalOpts);
  try {
    const { value, repaired } = parseJsonLenient(result.text);
    if (repaired) {
      counters.repairedCalls += 1;
      emitTelemetry({
        ts: new Date().toISOString(),
        purpose: opts.purpose ?? "generic",
        model: result.model,
        provider: result.provider,
        status: "repaired",
        latencyMs: result.latencyMs,
      });
    }
    return { ...result, json: value as T, repaired };
  } catch (parseErr) {
    throw new LLMTransportError(
      `LLM returned invalid JSON that could not be repaired: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
    );
  }
}

/**
 * Convenience helpers for building messages.
 */
export function systemMessage(text: string): LLMMessage {
  return { role: "system", content: text };
}

export function userMessage(text: string): LLMMessage {
  return { role: "user", content: text };
}

export function userMessageWithImage(text: string, imageBase64: string, mimeType = "image/png"): LLMMessage {
  return {
    role: "user",
    content: [
      { type: "text", text },
      { type: "image", data: imageBase64, mimeType },
    ],
  };
}
