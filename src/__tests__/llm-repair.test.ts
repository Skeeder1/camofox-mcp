import { describe, it, expect } from "vitest";

import {
  parseJsonLenient,
  repairTruncatedJson,
  stripMarkdownFences,
} from "../llm/repair.js";

describe("llm/repair — stripMarkdownFences", () => {
  it("removes leading ```json and trailing ```", () => {
    expect(stripMarkdownFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("removes leading ``` only fences", () => {
    expect(stripMarkdownFences('```\n{"x":2}\n```')).toBe('{"x":2}');
  });

  it("returns plain JSON unchanged", () => {
    expect(stripMarkdownFences('{"a":1}')).toBe('{"a":1}');
  });
});

describe("llm/repair — repairTruncatedJson", () => {
  it("closes a single open object", () => {
    const repaired = repairTruncatedJson('{"a":1');
    expect(JSON.parse(repaired)).toEqual({ a: 1 });
  });

  it("closes nested arrays + objects", () => {
    const repaired = repairTruncatedJson('{"items":[{"id":1},{"id":2');
    const parsed = JSON.parse(repaired) as { items: Array<{ id: number }> };
    expect(parsed.items).toHaveLength(2);
    expect(parsed.items[1].id).toBe(2);
  });

  it("strips dangling key with no value", () => {
    const repaired = repairTruncatedJson('{"a":1,"b":');
    expect(JSON.parse(repaired)).toEqual({ a: 1 });
  });

  it("closes an open string", () => {
    const repaired = repairTruncatedJson('{"name":"unfinished');
    const parsed = JSON.parse(repaired) as { name: string };
    expect(parsed.name).toBe("unfinished");
  });

  it("strips trailing comma", () => {
    const repaired = repairTruncatedJson('{"a":1,');
    expect(JSON.parse(repaired)).toEqual({ a: 1 });
  });
});

describe("llm/repair — parseJsonLenient", () => {
  it("parses clean JSON", () => {
    const r = parseJsonLenient('{"a":1}');
    expect(r.value).toEqual({ a: 1 });
    expect(r.repaired).toBe(false);
  });

  it("parses fenced JSON without repair", () => {
    const r = parseJsonLenient('```json\n{"a":1}\n```');
    expect(r.value).toEqual({ a: 1 });
    expect(r.repaired).toBe(false);
  });

  it("repairs truncated JSON when needed", () => {
    const r = parseJsonLenient('{"items":[{"id":1');
    expect(r.repaired).toBe(true);
    const v = r.value as { items: Array<{ id: number }> };
    expect(v.items[0].id).toBe(1);
  });

  it("throws on completely garbled input", () => {
    expect(() => parseJsonLenient("not json at all !!!")).toThrow();
  });
});
