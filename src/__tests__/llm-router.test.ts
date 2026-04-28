import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  callLLM,
  callLLMJson,
  LLMDisabledError,
  LLMTransportError,
  LLMTimeoutError,
  systemMessage,
  userMessage,
  userMessageWithImage,
  onLLMTelemetry,
  type LLMTelemetryEvent,
} from "../llm/router.js";
import type { LLMConfig } from "../llm/config.js";

function baseConfig(overrides: Partial<LLMConfig> = {}): LLMConfig {
  return {
    enabled: true,
    provider: "openrouter",
    apiUrl: "https://openrouter.ai/api/v1",
    apiKey: "test-key",
    defaultModel: "google/gemini-2.5-flash",
    fallbackModel: "anthropic/claude-haiku-4.5",
    visionModel: "google/gemini-2.5-flash",
    perPurposeModels: {},
    maxTokens: 1000,
    temperature: 0,
    timeoutMs: 5_000,
    jsonFormat: true,
    preferSampling: false,
    ...overrides,
  };
}

function makeFetchResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mockFetchOnce(payload: unknown, status = 200): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => makeFetchResponse(payload, status)),
  );
}

function makeOpenAIResponse(content: string, model = "google/gemini-2.5-flash"): unknown {
  return {
    id: "test",
    model,
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("llm/router — guards", () => {
  it("throws LLMDisabledError when LLM is disabled", async () => {
    await expect(
      callLLM(baseConfig({ enabled: false }), [userMessage("hi")]),
    ).rejects.toBeInstanceOf(LLMDisabledError);
  });

  it("throws LLMDisabledError when no API key is set", async () => {
    await expect(
      callLLM(baseConfig({ apiKey: undefined }), [userMessage("hi")]),
    ).rejects.toBeInstanceOf(LLMDisabledError);
  });
});

describe("llm/router — happy path", () => {
  it("returns text content from the primary model", async () => {
    mockFetchOnce(makeOpenAIResponse("hello world"));

    const result = await callLLM(baseConfig(), [userMessage("hi")]);

    expect(result.text).toBe("hello world");
    expect(result.model).toBe("google/gemini-2.5-flash");
    expect(result.usedFallback).toBe(false);
    expect(result.usage?.totalTokens).toBe(30);
  });

  it("strips markdown fences from response text", async () => {
    mockFetchOnce(makeOpenAIResponse('```json\n{"a":1}\n```'));

    const result = await callLLM(baseConfig(), [userMessage("hi")]);

    expect(result.text).toBe('{"a":1}');
  });

  it("uses per-purpose model when configured", async () => {
    const fetchMock = vi.fn(async () => makeFetchResponse(makeOpenAIResponse("ok")));
    vi.stubGlobal("fetch", fetchMock);

    await callLLM(
      baseConfig({ perPurposeModels: { extract: "openai/gpt-4o" } }),
      [userMessage("hi")],
      { purpose: "extract" },
    );

    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as { model: string };
    expect(body.model).toBe("openai/gpt-4o");
  });

  it("explicit model option overrides per-purpose model", async () => {
    const fetchMock = vi.fn(async () => makeFetchResponse(makeOpenAIResponse("ok")));
    vi.stubGlobal("fetch", fetchMock);

    await callLLM(
      baseConfig({ perPurposeModels: { extract: "openai/gpt-4o" } }),
      [userMessage("hi")],
      { purpose: "extract", model: "openai/gpt-5" },
    );

    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as { model: string };
    expect(body.model).toBe("openai/gpt-5");
  });

  it("auto-routes vision messages to visionModel", async () => {
    const fetchMock = vi.fn(async () => makeFetchResponse(makeOpenAIResponse("ok")));
    vi.stubGlobal("fetch", fetchMock);

    await callLLM(baseConfig({ visionModel: "openai/gpt-4o" }), [
      userMessageWithImage("describe", "AAAA", "image/png"),
    ]);

    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as {
      model: string;
      messages: Array<{ role: string; content: unknown }>;
    };
    expect(body.model).toBe("openai/gpt-4o");
    const content = body.messages[0]!.content as Array<{ type: string }>;
    expect(content.some((c) => c.type === "image_url")).toBe(true);
  });

  it("sends authorization header with api key", async () => {
    const fetchMock = vi.fn(async () => makeFetchResponse(makeOpenAIResponse("ok")));
    vi.stubGlobal("fetch", fetchMock);

    await callLLM(baseConfig({ apiKey: "sk-secret" }), [userMessage("hi")]);

    const headers = fetchMock.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer sk-secret");
  });

  it("does not send response_format on vision calls", async () => {
    const fetchMock = vi.fn(async () => makeFetchResponse(makeOpenAIResponse("ok")));
    vi.stubGlobal("fetch", fetchMock);

    await callLLM(baseConfig(), [userMessageWithImage("describe", "AAAA")]);

    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as Record<string, unknown>;
    expect(body.response_format).toBeUndefined();
  });

  it("sends response_format json_object on text calls when jsonFormat=true", async () => {
    const fetchMock = vi.fn(async () => makeFetchResponse(makeOpenAIResponse("{}")));
    vi.stubGlobal("fetch", fetchMock);

    await callLLM(baseConfig({ jsonFormat: true }), [userMessage("hi")]);

    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as {
      response_format?: { type: string };
    };
    expect(body.response_format?.type).toBe("json_object");
  });

  it("respects responseFormat=text override", async () => {
    const fetchMock = vi.fn(async () => makeFetchResponse(makeOpenAIResponse("plain")));
    vi.stubGlobal("fetch", fetchMock);

    await callLLM(baseConfig({ jsonFormat: true }), [userMessage("hi")], {
      responseFormat: "text",
    });

    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as Record<string, unknown>;
    expect(body.response_format).toBeUndefined();
  });
});

describe("llm/router — fallback model", () => {
  it("falls back to secondary model on transport error", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(makeFetchResponse({ error: "boom" }, 503))
      .mockResolvedValueOnce(makeFetchResponse(makeOpenAIResponse("ok", "anthropic/claude-haiku-4.5")));
    vi.stubGlobal("fetch", fetchMock);

    const result = await callLLM(baseConfig(), [userMessage("hi")]);

    expect(result.usedFallback).toBe(true);
    expect(result.model).toBe("anthropic/claude-haiku-4.5");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("propagates error when no fallback configured", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => makeFetchResponse({ error: "boom" }, 500)));

    await expect(
      callLLM(baseConfig({ fallbackModel: undefined }), [userMessage("hi")]),
    ).rejects.toBeInstanceOf(LLMTransportError);
  });

  it("propagates error when fallback also fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(makeFetchResponse({ error: "primary fail" }, 500))
        .mockResolvedValueOnce(makeFetchResponse({ error: "fallback fail" }, 500)),
    );

    await expect(callLLM(baseConfig(), [userMessage("hi")])).rejects.toBeInstanceOf(LLMTransportError);
  });
});

describe("llm/router — callLLMJson", () => {
  it("parses clean JSON response", async () => {
    mockFetchOnce(makeOpenAIResponse('{"hello":"world"}'));

    const result = await callLLMJson<{ hello: string }>(baseConfig(), [userMessage("hi")]);

    expect(result.json.hello).toBe("world");
    expect(result.repaired).toBe(false);
  });

  it("repairs truncated JSON", async () => {
    mockFetchOnce(makeOpenAIResponse('{"items":[{"id":1'));

    const result = await callLLMJson<{ items: Array<{ id: number }> }>(baseConfig(), [
      userMessage("hi"),
    ]);

    expect(result.repaired).toBe(true);
    expect(result.json.items[0]!.id).toBe(1);
  });

  it("throws LLMTransportError when JSON cannot be repaired", async () => {
    mockFetchOnce(makeOpenAIResponse("complete garbage no braces"));

    await expect(callLLMJson(baseConfig(), [userMessage("hi")])).rejects.toBeInstanceOf(
      LLMTransportError,
    );
  });
});

describe("llm/router — telemetry", () => {
  let events: LLMTelemetryEvent[];
  let unsubscribe: () => void;

  beforeEach(() => {
    events = [];
    unsubscribe = onLLMTelemetry((e) => events.push(e));
  });

  afterEach(() => {
    unsubscribe();
  });

  it("emits ok event on successful call", async () => {
    mockFetchOnce(makeOpenAIResponse("hello"));

    await callLLM(baseConfig(), [userMessage("hi")]);

    expect(events).toHaveLength(1);
    expect(events[0]!.status).toBe("ok");
    expect(events[0]!.model).toBe("google/gemini-2.5-flash");
  });

  it("emits fallback_used event when fallback is taken", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(makeFetchResponse({ error: "fail" }, 500))
        .mockResolvedValueOnce(makeFetchResponse(makeOpenAIResponse("ok"))),
    );

    await callLLM(baseConfig(), [userMessage("hi")]);

    expect(events.some((e) => e.status === "fallback_used")).toBe(true);
  });

  it("emits repaired event when JSON had to be repaired", async () => {
    mockFetchOnce(makeOpenAIResponse('{"a":1'));

    await callLLMJson(baseConfig(), [userMessage("hi")]);

    expect(events.some((e) => e.status === "repaired")).toBe(true);
  });
});

describe("llm/router — message helpers", () => {
  it("systemMessage builds correct shape", () => {
    expect(systemMessage("you are helpful")).toEqual({
      role: "system",
      content: "you are helpful",
    });
  });

  it("userMessage builds correct shape", () => {
    expect(userMessage("hi")).toEqual({ role: "user", content: "hi" });
  });

  it("userMessageWithImage builds multi-part content", () => {
    const m = userMessageWithImage("describe", "BASE64", "image/jpeg");
    expect(m.role).toBe("user");
    expect(Array.isArray(m.content)).toBe(true);
    const parts = m.content as Array<{ type: string }>;
    expect(parts[0]!.type).toBe("text");
    expect(parts[1]!.type).toBe("image");
  });
});

describe("llm/router — timeout", () => {
  it("throws LLMTimeoutError when call exceeds timeoutMs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_, reject) => {
            init.signal?.addEventListener("abort", () => {
              const err = new Error("aborted");
              err.name = "AbortError";
              reject(err);
            });
          }),
      ),
    );

    await expect(
      callLLM(baseConfig({ timeoutMs: 50, fallbackModel: undefined }), [userMessage("hi")]),
    ).rejects.toBeInstanceOf(LLMTimeoutError);
  });
});
