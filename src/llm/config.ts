/**
 * LLM configuration loader.
 *
 * Resolution priority (highest first):
 *   1. Environment variables (CAMOFOX_LLM_*, OPEN_ROUTER, CAMOFOX_SUMMARIZER_*)
 *   2. ~/.camofox-mcp/config.yaml
 *   3. Hardcoded defaults
 *
 * Back-compat: legacy CAMOFOX_SUMMARIZER_* env vars are still honored so the
 * existing smart_snapshot configuration keeps working without changes.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const YAML_CONFIG_PATH = join(homedir(), ".camofox-mcp", "config.yaml");

export interface LLMConfig {
  /** When false, all LLM-aware tools return a disabled-notice payload. */
  enabled: boolean;
  /** Provider used for outbound HTTP calls. */
  provider: "openrouter" | "openai" | "anthropic" | "gemini" | "custom";
  /** Base URL of the OpenAI-compatible endpoint. */
  apiUrl: string;
  /** Bearer token. */
  apiKey: string | undefined;
  /** Default model for text-only calls. */
  defaultModel: string;
  /** Fallback model on primary failure. */
  fallbackModel: string | undefined;
  /** Model used when `vision: true` is passed. */
  visionModel: string;
  /** Per-purpose model overrides (extract, observe, act, …). */
  perPurposeModels: Partial<Record<string, string>>;
  /** Default max output tokens (per purpose can override). */
  maxTokens: number;
  /** Default temperature. */
  temperature: number;
  /** Hard timeout per attempt. */
  timeoutMs: number;
  /** Force `response_format: { type: "json_object" }` when applicable. */
  jsonFormat: boolean;
  /** Allow router to attempt MCP sampling first when the client supports it. */
  preferSampling: boolean;
}

function isFalsy(value: string | undefined): boolean {
  if (!value) return true;
  return ["false", "0", "no", "n", "off"].includes(value.trim().toLowerCase());
}

function loadYamlConfig(path: string = YAML_CONFIG_PATH): Record<string, string> {
  try {
    const text = readFileSync(path, "utf-8");
    const result: Record<string, string> = {};
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const colon = line.indexOf(":");
      if (colon === -1) continue;
      const key = line.slice(0, colon).trim();
      const value = line.slice(colon + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
      if (key) result[key] = value;
    }
    return result;
  } catch {
    return {};
  }
}

function pickProvider(value: string | undefined): LLMConfig["provider"] {
  const v = (value ?? "").trim().toLowerCase();
  if (v === "openai" || v === "anthropic" || v === "gemini" || v === "custom") return v;
  return "openrouter";
}

function pickApiKey(env: NodeJS.ProcessEnv, yaml: Record<string, string>, provider: LLMConfig["provider"]): string | undefined {
  // Generic key takes priority
  const generic = env.CAMOFOX_LLM_API_KEY ?? yaml.llm_api_key;
  if (generic) return generic;

  switch (provider) {
    case "openrouter":
      // Order: explicit OPENROUTER_API_KEY → OPEN_ROUTER (project convention)
      //        → legacy CAMOFOX_SUMMARIZER_API_KEY → yaml entries.
      return (
        env.OPENROUTER_API_KEY ??
        env.OPEN_ROUTER ??
        env.CAMOFOX_SUMMARIZER_API_KEY ??
        yaml.openrouter_api_key ??
        yaml.summarizer_api_key
      );
    case "openai":
      return env.OPENAI_API_KEY ?? yaml.openai_api_key;
    case "anthropic":
      return env.ANTHROPIC_API_KEY ?? yaml.anthropic_api_key;
    case "gemini":
      return env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY ?? yaml.gemini_api_key;
    default:
      return env.CAMOFOX_LLM_API_KEY ?? yaml.llm_api_key;
  }
}

function defaultApiUrl(provider: LLMConfig["provider"]): string {
  switch (provider) {
    case "openrouter":
      return "https://openrouter.ai/api/v1";
    case "openai":
      return "https://api.openai.com/v1";
    case "anthropic":
      return "https://api.anthropic.com/v1";
    case "gemini":
      return "https://generativelanguage.googleapis.com/v1beta/openai";
    default:
      return "https://openrouter.ai/api/v1";
  }
}

export function loadLLMConfig(env: NodeJS.ProcessEnv = process.env, yaml: Record<string, string> = loadYamlConfig()): LLMConfig {
  const get = (envKey: string, yamlKey: string, def: string): string =>
    env[envKey] ?? yaml[yamlKey] ?? def;

  const provider = pickProvider(env.CAMOFOX_LLM_PROVIDER ?? yaml.llm_provider);
  const apiUrl = (env.CAMOFOX_LLM_API_URL ?? yaml.llm_api_url ?? env.CAMOFOX_SUMMARIZER_API_URL ?? yaml.summarizer_api_url ?? defaultApiUrl(provider)).replace(/\/$/, "");
  const apiKey = pickApiKey(env, yaml, provider);

  // Default model: per-spec gemini-2.5-flash on OpenRouter (cheap, fast, JSON-native).
  // Back-compat fallback to legacy CAMOFOX_SUMMARIZER_MODEL if explicitly set.
  const defaultModel =
    env.CAMOFOX_LLM_MODEL ??
    yaml.llm_model ??
    env.CAMOFOX_SUMMARIZER_MODEL ??
    yaml.summarizer_model ??
    "google/gemini-2.5-flash";

  const fallbackModelStr =
    env.CAMOFOX_LLM_FALLBACK_MODEL ??
    yaml.llm_fallback_model ??
    env.CAMOFOX_SUMMARIZER_FALLBACK_MODEL ??
    yaml.summarizer_fallback_model ??
    "anthropic/claude-haiku-4.5";

  const visionModel =
    env.CAMOFOX_LLM_VISION_MODEL ??
    yaml.llm_vision_model ??
    "google/gemini-2.5-flash";

  const perPurposeModels: Partial<Record<string, string>> = {};
  for (const purpose of ["summarize", "extract", "act", "observe", "find_element", "vision"]) {
    const envKey = `CAMOFOX_LLM_MODEL_${purpose.toUpperCase()}`;
    const yamlKey = `llm_model_${purpose}`;
    const value = env[envKey] ?? yaml[yamlKey];
    if (value) perPurposeModels[purpose] = value;
  }

  const maxTokensRaw = parseInt(get("CAMOFOX_LLM_MAX_TOKENS", "llm_max_tokens", env.CAMOFOX_SUMMARIZER_MAX_TOKENS ?? yaml.summarizer_max_tokens ?? "10000"), 10);
  const temperatureRaw = parseFloat(get("CAMOFOX_LLM_TEMPERATURE", "llm_temperature", env.CAMOFOX_SUMMARIZER_TEMPERATURE ?? yaml.summarizer_temperature ?? "0"));
  const timeoutRaw = parseInt(get("CAMOFOX_LLM_TIMEOUT", "llm_timeout", env.CAMOFOX_SUMMARIZER_TIMEOUT ?? yaml.summarizer_timeout ?? "30000"), 10);

  const enabled = !isFalsy(env.CAMOFOX_LLM_ENABLED ?? yaml.llm_enabled ?? env.CAMOFOX_SMART_SNAPSHOT_ENABLED ?? yaml.summarizer_enabled ?? "true");
  const jsonFormat = !isFalsy(env.CAMOFOX_LLM_JSON_FORMAT ?? yaml.llm_json_format ?? env.CAMOFOX_SUMMARIZER_JSON_FORMAT ?? yaml.summarizer_json_format ?? "true");
  const preferSampling = !isFalsy(env.CAMOFOX_LLM_PREFER_SAMPLING ?? yaml.llm_prefer_sampling ?? "false");

  return {
    enabled,
    provider,
    apiUrl,
    apiKey: apiKey || undefined,
    defaultModel,
    fallbackModel: fallbackModelStr || undefined,
    visionModel,
    perPurposeModels,
    maxTokens: Number.isNaN(maxTokensRaw) ? 10_000 : maxTokensRaw,
    temperature: Number.isNaN(temperatureRaw) ? 0 : temperatureRaw,
    timeoutMs: Number.isNaN(timeoutRaw) ? 30_000 : timeoutRaw,
    jsonFormat,
    preferSampling,
  };
}

export function redactedLLMConfig(c: LLMConfig): Record<string, unknown> {
  return { ...c, apiKey: c.apiKey ? "***" : undefined };
}
