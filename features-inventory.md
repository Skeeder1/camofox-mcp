# Features inventory — CamoFox MCP fork

Ledger of everything this fork adds on top of upstream
[redf0x1/camofox-mcp](https://github.com/redf0x1/camofox-mcp). Upstream features
are not listed.

**Fork base:** upstream v1.14.5 · **MCP tools:** 58 · **Tests:** 242

---

## Semantic tools

`src/tools/semantic.ts`

| Tool | Purpose |
| --- | --- |
| `act` | Execute an action from natural-language intent. Resolves the element and picks the interaction. |
| `extract` | Return structured data against an instruction, plus a `missing` list. |
| `observe` | List relevant interactive elements with roles, labels, purposes and relevance scores. |
| `find_element_by_prompt` | Resolve one element ref from a description without executing. |
| `execute` | Run a typed plan atomically: `click`, `type`, `scroll`, `navigate`, `wait`, `press_key`. |

`src/tools/smart-snapshot.ts`

| Tool | Purpose |
| --- | --- |
| `smart_snapshot` | LLM-summarised page state as compact JSON, in place of a full a11y tree. |

---

## LLM layer

| Module | Responsibility |
| --- | --- |
| `src/llm/router.ts` | Provider routing, sampling delegation, fallback chain, retries. |
| `src/llm/config.ts` | `CAMOFOX_LLM_*` resolution and validation. |
| `src/llm/repair.ts` | Repair malformed LLM JSON (code fences, trailing commas, prose wrappers). |
| `src/llm/types.ts` | Shared request/response types. |
| `src/llm/index.ts` | Public surface. |

**Providers:** Anthropic · OpenAI · OpenRouter · MCP sampling (client's own model).

### Configuration

| Variable | Purpose |
| --- | --- |
| `CAMOFOX_LLM_ENABLED` | Master switch for the semantic layer. |
| `CAMOFOX_LLM_PROVIDER` | `anthropic` \| `openai` \| `openrouter`. |
| `CAMOFOX_LLM_MODEL` | Primary model id. |
| `CAMOFOX_LLM_FALLBACK_MODEL` | Used when the primary fails. |
| `CAMOFOX_LLM_VISION_MODEL` | Model for screenshot-based reasoning. |
| `CAMOFOX_LLM_API_KEY` | Generic key; provider-specific vars also honoured. |
| `CAMOFOX_LLM_API_URL` | Custom endpoint (self-hosted, proxy). |
| `CAMOFOX_LLM_PREFER_SAMPLING` | Ask the MCP client's model first — no API key needed. |
| `CAMOFOX_LLM_JSON_FORMAT` | Request native structured output. |
| `CAMOFOX_LLM_TEMPERATURE` / `CAMOFOX_LLM_MAX_TOKENS` / `CAMOFOX_LLM_TIMEOUT` | Generation controls. |

---

## Tool layers

`src/layers.ts` — controls how many tools the model sees.

| Profile | core | semantic | legacy | stealth | vision | cache | network |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `lean` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `full` (default) | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `custom` | configurable per flag | | | | | | |

Selected with `CAMOFOX_PROFILE`, or per-layer flags, or a YAML config file.

---

## Externalised prompts

`src/prompts/` — editable Markdown, no recompilation needed to tune behaviour.

`semantic-act.md` · `semantic-extract.md` · `semantic-observe.md` ·
`smart-snapshot-system.md` · `recovery-system.md` · `full-agent.md` ·
`lean-agent.md`

---

## Task context and diagnosis

| Tool | Purpose |
| --- | --- |
| `set_task_context` | Persist a high-level task descriptor on a tab. |
| `get_task_context` | Current task, last action, recent history (most recent first). |
| `diagnose_failure` | One-call post-failure report: context, last action, URL, dialog visibility. |

---

## Runtime

| Feature | Detail |
| --- | --- |
| Eager browser warmup | `CAMOFOX_BROWSER_SERVER_PATH` spawns `camofox-browser` and warms it at startup, so the first tool call skips cold start. |

---

## Test coverage added by the fork

| Suite | Covers |
| --- | --- |
| `llm-router.test.ts` | provider routing, sampling, fallback chain (24 tests) |
| `llm-config.test.ts` | env resolution and validation (12) |
| `llm-repair.test.ts` | malformed-JSON repair (12) |
| `semantic.test.ts` | act / extract / observe (12) |
| `layers.test.ts` | profile and flag resolution (10) |
| `prompts.test.ts` | prompt loading (5) |

---

## Known limitations

| Limitation | Impact | Mitigation |
| --- | --- | --- |
| Semantic tools need an LLM | With `CAMOFOX_LLM_ENABLED=false` they are unavailable; ref/selector tools still work | Enable sampling (`CAMOFOX_LLM_PREFER_SAMPLING=true`) for a key-free setup. |
| Firefox version comes from `camofox-browser` | A build far behind release is a weak detection signal | Keep the `camofox-browser` dependency current. |
| `full` profile exposes 58 tools | Large tool list in model context | Use `CAMOFOX_PROFILE=lean`. |

---

## Operational tooling

| Script | Purpose |
| --- | --- |
| `scripts/healthcheck.mjs` | Probes both layers: the MCP contract, then `server_status` to confirm the browser answers. Exit 0 healthy, 1 reachable but broken or browser down, 2 unreachable. `--allow-browser-down` narrows it to an adapter-only check. |

| Unit in `deploy/` | Cadence | Catches |
| --- | --- | --- |
| `camofox-mcp.service` | — | runs the adapter with warmup, loopback bind and the `lean` tool profile |
| `camofox-healthcheck.timer` | 5 min | the adapter answering perfectly while the browser behind it is gone |

## Hardening applied to the fork

| Fix | Why it mattered |
| --- | --- |
| `startHttpServer` asserts the HTTP safety config itself | The guard was gated on `transport === "http"`, but `dist/http.js` serves HTTP while leaving transport at its `stdio` default — so a sub-32-char token was accepted and a non-loopback bind with no token raised nothing. |
| `--port` / `--host` accepted as aliases | They were silently ignored, so the server bound its default port 3000 while the operator believed otherwise. |
| Unrecognised `--flag` now warns | Previously dropped without a word, which is how the port bug stayed invisible. |
