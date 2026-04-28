/**
 * Unified LLM types shared across all LLM-aware tools.
 *
 * The router abstracts away the provider (OpenRouter, OpenAI, Anthropic,
 * Gemini, MCP sampling) so individual tools just declare what they need.
 */

export type LLMRole = "system" | "user" | "assistant";

export interface LLMTextContent {
  type: "text";
  text: string;
}

export interface LLMImageContent {
  type: "image";
  /** Base64-encoded image (no data URL prefix). */
  data: string;
  /** MIME type, e.g. "image/png", "image/jpeg". */
  mimeType: string;
}

export type LLMContentPart = LLMTextContent | LLMImageContent;

export interface LLMMessage {
  role: LLMRole;
  /** Either plain text (most cases) or multi-part for vision calls. */
  content: string | LLMContentPart[];
}

export type LLMResponseFormat = "text" | "json_object";

export interface LLMCallOptions {
  /** Logical purpose — used to pick the default model and for telemetry. */
  purpose?: "summarize" | "extract" | "act" | "observe" | "find_element" | "vision" | "generic";

  /** Override the configured default model for this call. */
  model?: string;

  /** Override fallback model. */
  fallbackModel?: string;

  /** Max output tokens. Defaults vary per purpose. */
  maxTokens?: number;

  /** Sampling temperature. Defaults to 0 (deterministic). */
  temperature?: number;

  /** Force JSON object response when the provider supports it. */
  responseFormat?: LLMResponseFormat;

  /**
   * Hint that this call is multi-modal (uses image parts). The router will
   * route to the configured vision model if `model` is not explicitly set.
   */
  vision?: boolean;

  /** Hard timeout in milliseconds. */
  timeoutMs?: number;

  /** Caller-side abort signal (in addition to the internal timeout). */
  signal?: AbortSignal;
}

export interface LLMUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface LLMCallResult {
  /** Raw text content returned by the model (after stripping markdown fences). */
  text: string;
  /** Model that actually answered (could be the fallback). */
  model: string;
  /** Provider that handled the call. */
  provider: "openrouter" | "openai" | "anthropic" | "gemini" | "sampling" | "custom";
  /** Token usage if the provider reported it. */
  usage?: LLMUsage;
  /** Provider-reported finish reason. */
  finishReason?: string;
  /** Wall-clock latency for this call in milliseconds. */
  latencyMs: number;
  /** Whether a fallback model had to be used. */
  usedFallback: boolean;
}

export interface LLMJsonResult<T = Record<string, unknown>> extends LLMCallResult {
  json: T;
  /** True if the JSON had to be repaired (truncation). */
  repaired: boolean;
}
