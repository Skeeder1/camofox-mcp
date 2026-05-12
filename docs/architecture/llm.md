# LLM Layer Architecture

The LLM layer powers semantic tools such as `extract`, `observe`, `act`, `find_element_by_prompt`, `execute`, and `smart_snapshot`.

## LLM Tree

```text
semantic tool
  -> snapshot from browser client
  -> prompt file
  -> LLM router
  -> OpenAI-compatible request
  -> JSON repair and validation
  -> normalized MCP result
```

## Configuration

The LLM layer reads `CAMOFOX_LLM_*` variables and still honors legacy `CAMOFOX_SUMMARIZER_*` variables for compatibility.

Common settings:

- `CAMOFOX_LLM_ENABLED`
- `CAMOFOX_LLM_PROVIDER`
- `CAMOFOX_LLM_API_URL`
- `CAMOFOX_LLM_API_KEY`
- `CAMOFOX_LLM_MODEL`
- `CAMOFOX_LLM_FALLBACK_MODEL`
- `CAMOFOX_LLM_VISION_MODEL`
- `CAMOFOX_LLM_MODEL_<PURPOSE>`
- `CAMOFOX_LLM_MAX_TOKENS`
- `CAMOFOX_LLM_TEMPERATURE`
- `CAMOFOX_LLM_TIMEOUT`
- `CAMOFOX_LLM_JSON_FORMAT`

## Semantic Tools

| Tool | Purpose |
| --- | --- |
| `extract` | Convert a page snapshot into structured data, preferably with a JSON Schema. |
| `observe` | Rank relevant interactive elements for a user intent. |
| `act` | Plan and optionally execute a single natural-language action. |
| `find_element_by_prompt` | Resolve one element ref or selector without executing. |
| `execute` | Run a typed action plan without using the LLM. |
| `smart_snapshot` | Summarize page state into compact structured JSON. |

## Failure Behavior

If the LLM layer is disabled or no API key is configured, semantic tools return a structured `LLM_DISABLED` result. This keeps the MCP server available and lets agents fall back to snapshot-first workflows.

## Agent Guidance

- Use `extract` with a schema for stable structured output.
- Use `observe` before acting when the target is ambiguous.
- Use `act` with `dry_run` or a higher confidence threshold for sensitive workflows.
- Use `execute` for deterministic short plans when refs or selectors are already known.
- Fall back to raw `snapshot` and selector tools when LLM calls are unavailable.

## Related Topics

- [Agents](../agents.md)
- [Tools architecture](tools.md)
- [Operations](../operations.md)
