import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ToolResult } from "../errors.js";

function unwrapToolResult(result: ToolResult): Record<string, unknown> {
  expect(result.isError).toBeUndefined();
  const first = result.content[0];
  if (!first || first.type !== "text") {
    throw new Error("Expected ToolResult to have text content");
  }
  return JSON.parse(first.text) as Record<string, unknown>;
}

function makeOpenAIResponse(content: string, model = "google/gemini-2.5-flash"): unknown {
  return {
    id: "test",
    model,
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  };
}

function mockFetch(payload: unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () =>
    new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } }),
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

async function setupSemantic(opts: {
  snapshot?: string;
  url?: string;
  envOverride?: Record<string, string>;
} = {}) {
  vi.resetModules();

  const env = {
    OPEN_ROUTER: "test-key",
    CAMOFOX_LLM_DEFAULT_MODEL: "google/gemini-2.5-flash",
    CAMOFOX_LLM_FALLBACK_MODEL: "anthropic/claude-haiku-4.5",
    CAMOFOX_LLM_TIMEOUT_MS: "5000",
    ...opts.envOverride,
  };
  for (const [k, v] of Object.entries(env)) {
    process.env[k] = v;
  }

  const tracked = { tabId: "tab-1", userId: "user-1" };
  const getTrackedTabMock = vi.fn(() => tracked);
  const incrementToolCallMock = vi.fn();
  const updateTabUrlMock = vi.fn();
  const updateRefsCountMock = vi.fn();

  vi.doMock("../state.js", () => ({
    getTrackedTab: getTrackedTabMock,
    incrementToolCall: incrementToolCallMock,
    updateTabUrl: updateTabUrlMock,
    updateRefsCount: updateRefsCountMock,
  }));

  const snapshotResp = {
    snapshot: opts.snapshot ?? "[1] button 'Login'\n[2] textbox 'Search'",
    url: opts.url ?? "https://example.com",
    refsCount: 2,
  };

  const clientMock = {
    snapshot: vi.fn(async () => snapshotResp),
    click: vi.fn(async () => ({ success: true, navigated: false })),
    smartTypeText: vi.fn(async () => undefined),
    scroll: vi.fn(async () => undefined),
    navigate: vi.fn(async () => ({ url: "https://example.com/next", title: "Next" })),
    pressKey: vi.fn(async () => undefined),
  };

  const { registerSemanticTools } = await import("../tools/semantic.js");

  const tools: Record<string, (input: unknown) => Promise<ToolResult>> = {};
  const server = {
    tool: vi.fn((name: string, _desc: string, _schema: unknown, handler: (i: unknown) => Promise<ToolResult>) => {
      tools[name] = handler;
    }),
  };

  registerSemanticTools(
    server as unknown as Parameters<typeof registerSemanticTools>[0],
    { client: clientMock, config: {} } as unknown as Parameters<typeof registerSemanticTools>[1],
  );

  return { tools, clientMock, getTrackedTabMock, incrementToolCallMock };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.unmock("../state.js");
  delete process.env.OPEN_ROUTER;
  delete process.env.CAMOFOX_LLM_DEFAULT_MODEL;
  delete process.env.CAMOFOX_LLM_FALLBACK_MODEL;
  delete process.env.CAMOFOX_LLM_TIMEOUT_MS;
  delete process.env.CAMOFOX_LLM_ENABLED;
  delete process.env.CAMOFOX_LLM_API_KEY;
});

describe("semantic.extract", () => {
  it("returns structured data when LLM responds with valid JSON", async () => {
    const { tools } = await setupSemantic();
    mockFetch(
      makeOpenAIResponse(
        JSON.stringify({
          data: { title: "Hello", price: 12.5 },
          missing_fields: [],
          confidence: 0.9,
          source_refs: ["1"],
        }),
      ),
    );

    const result = await tools.extract!({ tabId: "tab-1", query: "title and price" });
    const parsed = unwrapToolResult(result);
    expect(parsed.data).toEqual({ title: "Hello", price: 12.5 });
    expect(parsed.confidence).toBe(0.9);
    expect((parsed._meta as Record<string, unknown>).model).toBeTruthy();
  });

  it("returns LLM_DISABLED error when no API key", async () => {
    const { tools } = await setupSemantic({ envOverride: { OPEN_ROUTER: "" } });
    const result = await tools.extract!({ tabId: "tab-1", query: "anything" });
    const parsed = unwrapToolResult(result);
    expect(parsed.error).toMatch(/LLM_DISABLED/);
  });

  it("caches identical extract calls", async () => {
    const { tools } = await setupSemantic();
    const fetchMock = mockFetch(
      makeOpenAIResponse(
        JSON.stringify({ data: { x: 1 }, confidence: 0.8 }),
      ),
    );

    await tools.extract!({ tabId: "tab-1", query: "x" });
    const second = await tools.extract!({ tabId: "tab-1", query: "x" });
    const parsed = unwrapToolResult(second);
    expect((parsed._meta as Record<string, unknown>).cached).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("semantic.observe", () => {
  it("returns candidate list", async () => {
    const { tools } = await setupSemantic();
    mockFetch(
      makeOpenAIResponse(
        JSON.stringify({
          page_type: "login",
          page_title: "Login",
          url: "https://example.com",
          candidates: [
            { ref: "1", role: "button", label: "Login", purpose: "submit", relevance: 0.9 },
          ],
          summary: "login page",
        }),
      ),
    );

    const result = await tools.observe!({ tabId: "tab-1", intent: "log in" });
    const parsed = unwrapToolResult(result);
    expect(parsed.page_type).toBe("login");
    expect((parsed.candidates as unknown[]).length).toBe(1);
  });
});

describe("semantic.act", () => {
  it("auto-executes click when confidence ≥ threshold", async () => {
    const { tools, clientMock } = await setupSemantic();
    mockFetch(
      makeOpenAIResponse(
        JSON.stringify({ action: "click", ref: "1", confidence: 0.95, reasoning: "login button" }),
      ),
    );

    const result = await tools.act!({ tabId: "tab-1", intent: "click login" });
    const parsed = unwrapToolResult(result);
    expect(parsed.executed).toBe(true);
    expect(clientMock.click).toHaveBeenCalledTimes(1);
    expect(clientMock.click.mock.calls[0]![1]).toEqual({ ref: "1", selector: undefined });
  });

  it("returns plan without executing when confidence < threshold", async () => {
    const { tools, clientMock } = await setupSemantic();
    mockFetch(
      makeOpenAIResponse(
        JSON.stringify({ action: "click", ref: "1", confidence: 0.3 }),
      ),
    );

    const result = await tools.act!({ tabId: "tab-1", intent: "click login" });
    const parsed = unwrapToolResult(result);
    expect(parsed.executed).toBe(false);
    expect(parsed.reason).toBe("low_confidence");
    expect(clientMock.click).not.toHaveBeenCalled();
  });

  it("respects dry_run", async () => {
    const { tools, clientMock } = await setupSemantic();
    mockFetch(
      makeOpenAIResponse(
        JSON.stringify({ action: "click", ref: "1", confidence: 0.95 }),
      ),
    );
    const result = await tools.act!({ tabId: "tab-1", intent: "click login", dry_run: true });
    const parsed = unwrapToolResult(result);
    expect(parsed.executed).toBe(false);
    expect(parsed.reason).toBe("dry_run");
    expect(clientMock.click).not.toHaveBeenCalled();
  });

  it("handles type action", async () => {
    const { tools, clientMock } = await setupSemantic();
    mockFetch(
      makeOpenAIResponse(
        JSON.stringify({ action: "type", ref: "2", text: "hello", confidence: 0.9 }),
      ),
    );
    await tools.act!({ tabId: "tab-1", intent: "type hello" });
    expect(clientMock.smartTypeText).toHaveBeenCalledTimes(1);
    expect(clientMock.smartTypeText.mock.calls[0]![2]).toBe("hello");
  });
});

describe("semantic.find_element_by_prompt", () => {
  it("returns ref + confidence without executing", async () => {
    const { tools, clientMock } = await setupSemantic();
    mockFetch(
      makeOpenAIResponse(
        JSON.stringify({ action: "click", ref: "1", confidence: 0.85 }),
      ),
    );
    const result = await tools.find_element_by_prompt!({ tabId: "tab-1", prompt: "the login button" });
    const parsed = unwrapToolResult(result);
    expect(parsed.ref).toBe("1");
    expect(parsed.confidence).toBe(0.85);
    expect(clientMock.click).not.toHaveBeenCalled();
  });
});

describe("semantic.execute", () => {
  it("runs a multi-step plan in order", async () => {
    const { tools, clientMock } = await setupSemantic();
    const result = await tools.execute!({
      tabId: "tab-1",
      plan: [
        { type: "type", ref: "2", text: "paris" },
        { type: "click", ref: "1" },
      ],
    });
    const parsed = unwrapToolResult(result);
    expect(parsed.ok).toBe(true);
    expect((parsed.steps as unknown[]).length).toBe(2);
    expect(clientMock.smartTypeText).toHaveBeenCalledTimes(1);
    expect(clientMock.click).toHaveBeenCalledTimes(1);
  });

  it("aborts on first error when stop_on_error=true (default)", async () => {
    const { tools, clientMock } = await setupSemantic();
    clientMock.click.mockRejectedValueOnce(new Error("boom"));
    const result = await tools.execute!({
      tabId: "tab-1",
      plan: [
        { type: "click", ref: "1" },
        { type: "type", ref: "2", text: "x" },
      ],
    });
    const parsed = unwrapToolResult(result);
    expect(parsed.ok).toBe(false);
    expect(parsed.aborted).toBe(true);
    expect((parsed.steps as unknown[]).length).toBe(1);
    expect(clientMock.smartTypeText).not.toHaveBeenCalled();
  });

  it("continues past errors when stop_on_error=false", async () => {
    const { tools, clientMock } = await setupSemantic();
    clientMock.click.mockRejectedValueOnce(new Error("boom"));
    const result = await tools.execute!({
      tabId: "tab-1",
      plan: [
        { type: "click", ref: "1" },
        { type: "wait", ms: 1 },
      ],
      stop_on_error: false,
    });
    const parsed = unwrapToolResult(result);
    expect(parsed.aborted).toBe(false);
    expect((parsed.steps as unknown[]).length).toBe(2);
    expect((parsed.steps as Array<{ ok: boolean }>)[0]!.ok).toBe(false);
    expect((parsed.steps as Array<{ ok: boolean }>)[1]!.ok).toBe(true);
  });
});
