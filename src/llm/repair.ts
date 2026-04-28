/**
 * JSON repair utilities — extracted from smart-snapshot for reuse across
 * all LLM-aware tools (extract, observe, act, find_element_by_prompt).
 *
 * Strategy: when an LLM truncates JSON mid-value (common with Gemini Flash
 * when hitting max_tokens), strip the last incomplete key-value pair, close
 * unclosed strings/arrays/objects, then close the root object.
 */

/**
 * Strip markdown code fences (```json ... ```) some LLMs wrap responses in
 * even when JSON mode is requested.
 */
export function stripMarkdownFences(raw: string): string {
  return raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
}

/**
 * Repair a truncated JSON string. Best-effort: returns a string that has
 * a higher chance of parsing. Caller still needs to JSON.parse() it.
 */
export function repairTruncatedJson(raw: string): string {
  let s = raw.trimEnd();

  // Strip trivially-incomplete tails: dangling commas, incomplete keys.
  s = s.replace(/,\s*$/, "");
  s = s.replace(/,?\s*"[^"]+"\s*:\s*$/, "");
  s = s.replace(/[,{[]\s*$/, "");
  s = s.replace(/,\s*$/, "");

  // Walk the string maintaining a stack of unclosed openers so we close them
  // in the correct nesting order.
  const stack: Array<"{" | "["> = [];
  let inString = false;
  let escape = false;
  for (const ch of s) {
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{" || ch === "[") {
      stack.push(ch);
    } else if (ch === "}" || ch === "]") {
      stack.pop();
    }
  }

  if (inString && escape) s = s.slice(0, -1);
  if (inString) s += '"';

  // After closing a string we may have ended right after a value (no comma);
  // closing the structure is fine. But we may also have ended right after an
  // open brace expecting a key — check by trimming and inspecting last char.
  while (stack.length > 0) {
    const opener = stack.pop()!;
    s += opener === "{" ? "}" : "]";
  }

  return s;
}

/**
 * Parse a string as JSON, with markdown stripping and truncation repair.
 * Throws if both attempts fail.
 */
export function parseJsonLenient(raw: string): { value: unknown; repaired: boolean; cleaned: string } {
  const cleaned = stripMarkdownFences(raw);
  try {
    return { value: JSON.parse(cleaned), repaired: false, cleaned };
  } catch {
    const repaired = repairTruncatedJson(cleaned);
    return { value: JSON.parse(repaired), repaired: true, cleaned };
  }
}
