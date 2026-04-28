import { describe, it, expect } from "vitest";

import { loadLLMConfig, redactedLLMConfig } from "../llm/config.js";

describe("llm/config — loadLLMConfig", () => {
  it("returns defaults when nothing is set", () => {
    const cfg = loadLLMConfig({} as NodeJS.ProcessEnv, {});
    expect(cfg.provider).toBe("openrouter");
    expect(cfg.apiUrl).toBe("https://openrouter.ai/api/v1");
    expect(cfg.apiKey).toBeUndefined();
    expect(cfg.defaultModel).toBe("google/gemini-2.5-flash");
    expect(cfg.fallbackModel).toBe("anthropic/claude-haiku-4.5");
    expect(cfg.maxTokens).toBe(10_000);
    expect(cfg.temperature).toBe(0);
    expect(cfg.timeoutMs).toBe(30_000);
    expect(cfg.jsonFormat).toBe(true);
    expect(cfg.enabled).toBe(true);
  });

  it("honors OPEN_ROUTER env var", () => {
    const cfg = loadLLMConfig({ OPEN_ROUTER: "sk-or-v1-test" } as NodeJS.ProcessEnv, {});
    expect(cfg.apiKey).toBe("sk-or-v1-test");
  });

  it("CAMOFOX_LLM_API_KEY takes priority over OPEN_ROUTER", () => {
    const cfg = loadLLMConfig(
      { OPEN_ROUTER: "fallback", CAMOFOX_LLM_API_KEY: "primary" } as NodeJS.ProcessEnv,
      {},
    );
    expect(cfg.apiKey).toBe("primary");
  });

  it("falls back to CAMOFOX_SUMMARIZER_API_KEY for back-compat", () => {
    const cfg = loadLLMConfig(
      { CAMOFOX_SUMMARIZER_API_KEY: "legacy-key" } as NodeJS.ProcessEnv,
      {},
    );
    expect(cfg.apiKey).toBe("legacy-key");
  });

  it("respects CAMOFOX_LLM_ENABLED=false", () => {
    const cfg = loadLLMConfig({ CAMOFOX_LLM_ENABLED: "false" } as NodeJS.ProcessEnv, {});
    expect(cfg.enabled).toBe(false);
  });

  it("loads custom model from env", () => {
    const cfg = loadLLMConfig(
      { CAMOFOX_LLM_MODEL: "openai/gpt-4o-mini" } as NodeJS.ProcessEnv,
      {},
    );
    expect(cfg.defaultModel).toBe("openai/gpt-4o-mini");
  });

  it("loads per-purpose model overrides", () => {
    const cfg = loadLLMConfig(
      {
        CAMOFOX_LLM_MODEL_EXTRACT: "openai/gpt-4o",
        CAMOFOX_LLM_MODEL_OBSERVE: "anthropic/claude-haiku-4.5",
      } as NodeJS.ProcessEnv,
      {},
    );
    expect(cfg.perPurposeModels.extract).toBe("openai/gpt-4o");
    expect(cfg.perPurposeModels.observe).toBe("anthropic/claude-haiku-4.5");
  });

  it("YAML config provides values when env is empty", () => {
    const cfg = loadLLMConfig({} as NodeJS.ProcessEnv, {
      llm_model: "yaml-model",
      llm_max_tokens: "5000",
      openrouter_api_key: "yaml-key",
    });
    expect(cfg.defaultModel).toBe("yaml-model");
    expect(cfg.maxTokens).toBe(5000);
    expect(cfg.apiKey).toBe("yaml-key");
  });

  it("env overrides YAML", () => {
    const cfg = loadLLMConfig(
      { CAMOFOX_LLM_MODEL: "env-model" } as NodeJS.ProcessEnv,
      { llm_model: "yaml-model" },
    );
    expect(cfg.defaultModel).toBe("env-model");
  });

  it("switches API URL based on provider", () => {
    const cfg = loadLLMConfig(
      { CAMOFOX_LLM_PROVIDER: "openai", OPENAI_API_KEY: "k" } as NodeJS.ProcessEnv,
      {},
    );
    expect(cfg.provider).toBe("openai");
    expect(cfg.apiUrl).toBe("https://api.openai.com/v1");
    expect(cfg.apiKey).toBe("k");
  });
});

describe("llm/config — redactedLLMConfig", () => {
  it("masks the API key", () => {
    const cfg = loadLLMConfig({ OPEN_ROUTER: "secret" } as NodeJS.ProcessEnv, {});
    const red = redactedLLMConfig(cfg);
    expect(red.apiKey).toBe("***");
  });

  it("leaves apiKey undefined when not set", () => {
    const cfg = loadLLMConfig({} as NodeJS.ProcessEnv, {});
    const red = redactedLLMConfig(cfg);
    expect(red.apiKey).toBeUndefined();
  });
});
