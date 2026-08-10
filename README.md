# CamoFox MCP — semantic fork

[![Upstream](https://img.shields.io/badge/upstream-redf0x1%2Fcamofox--mcp%20v1.14.5-blue)](https://github.com/redf0x1/camofox-mcp)
[![Tools](https://img.shields.io/badge/tools-58-green)](#tool-layers)
[![Tests](https://img.shields.io/badge/tests-248%20passing-brightgreen)](#testing)

A fork of [redf0x1/camofox-mcp](https://github.com/redf0x1/camofox-mcp) that adds
a **built-in LLM layer**, so an agent can drive the browser by *intent* instead
of by refs and selectors.

Upstream is a faithful MCP adapter over the `camofox-browser` REST API: snapshot
the page, read refs, click ref `e42`. That works, but it pushes the whole
accessibility tree into the model's context on every step and makes the model do
the element resolution.

This fork moves that work server-side:

```js
// Upstream: snapshot, scan the tree yourself, then act on a ref.
snapshot({ tabId })                    // → a large a11y tree in your context
click({ tabId, ref: "e42" })           // → you had to find e42 yourself

// This fork: say what you want.
act({ tabId, intent: "click the login button" })
extract({ tabId, instruction: "the product name and price" })
observe({ tabId, purpose: "what can I do on this page?" })
```

Everything upstream does still works — the ref and selector tools are all still
there. This README covers **what the fork adds**.

> **Fork status:** synced with upstream **v1.14.5**. Original work by redf0x1,
> MIT licence retained.

---

## What the fork adds

### 1. Provider-agnostic LLM router

[`src/llm/router.ts`](src/llm/router.ts) speaks to **Anthropic**, **OpenAI** and
**OpenRouter** through a single OpenAI-compatible HTTP path, with a
primary → fallback model chain and per-call telemetry (`ok` / `error` /
`fallback_used` / `repaired`).

```bash
CAMOFOX_LLM_ENABLED=true
CAMOFOX_LLM_PROVIDER=openrouter         # anthropic | openai | openrouter
CAMOFOX_LLM_MODEL=claude-sonnet-5
CAMOFOX_LLM_API_KEY=...                 # or ANTHROPIC_API_KEY / OPENAI_API_KEY / OPENROUTER_API_KEY
CAMOFOX_LLM_FALLBACK_MODEL=...          # used when the primary fails
CAMOFOX_LLM_VISION_MODEL=...            # for screenshot-based reasoning
CAMOFOX_LLM_JSON_FORMAT=true            # request structured output natively
CAMOFOX_LLM_TIMEOUT=60000
CAMOFOX_LLM_TEMPERATURE=0
CAMOFOX_LLM_MAX_TOKENS=4096
```

**JSON repair.** LLMs return almost-JSON often enough that
[`src/llm/repair.ts`](src/llm/repair.ts) exists: it strips code fences, trailing
commas and prose wrappers before parsing, so one malformed reply doesn't fail a
whole browsing step.

### 2. Semantic tools

[`src/tools/semantic.ts`](src/tools/semantic.ts)

| Tool | What it does |
| --- | --- |
| `act` | Perform an action from intent: *"click the login button"*, *"type 'paris' in the city field"*. Resolves the element, picks the interaction, executes it. |
| `extract` | Return structured data from the page against an instruction, with a `missing` list for what it could not find. |
| `observe` | List the relevant interactive elements with roles, labels, purposes and relevance scores — an oriented map, not a raw dump. |
| `find_element_by_prompt` | Resolve one element ref from a description **without** executing. Use when you want to look before you leap. |
| `execute` | Run a typed multi-step plan atomically (`click`, `type`, `scroll`, `navigate`, `wait`, `press_key`), stopping at the first failure. |

### 3. `smart_snapshot`

[`src/tools/smart-snapshot.ts`](src/tools/smart-snapshot.ts) returns an
LLM-summarised page state as compact JSON — page purpose, key elements, available
actions — instead of a full accessibility tree. This is the single biggest
context saver in the fork on large pages.

### 4. Tool layers

[`src/layers.ts`](src/layers.ts). 58 tools is a lot to put in front of a model.
Layers let you choose the surface:

| Profile | Layers enabled | Use for |
| --- | --- | --- |
| `lean` | core + semantic | agents that should think in intent; smallest tool list |
| `full` | core + semantic + legacy | default; everything, backward compatible |
| `custom` | set each flag yourself | tune per deployment |

```bash
CAMOFOX_PROFILE=lean          # or full, custom
```

Individual layers: `core`, `semantic`, `stealth`, `vision`, `cache`, `network`,
`legacy`. Configurable via env or a YAML config file.

### 5. Externalised prompts

[`src/prompts/`](src/prompts/) holds the system prompts as **editable Markdown**
rather than string literals: `semantic-act`, `semantic-extract`,
`semantic-observe`, `smart-snapshot-system`, `recovery-system`, `full-agent`,
`lean-agent`. Tune the agent's behaviour without touching TypeScript.

### 6. Failure diagnosis and task context

| Tool | What it does |
| --- | --- |
| `set_task_context` | Persist a high-level task descriptor on a tab. |
| `get_task_context` | Read current task, last action and recent history. |
| `diagnose_failure` | Post-failure snapshot: task context, last action, URL, dialog visibility — one call instead of five. |

Snapshots can inject the current task as a banner, which keeps a long browsing
session anchored to its goal.

### 7. Eager browser warmup

Set `CAMOFOX_BROWSER_SERVER_PATH` and the MCP server spawns `camofox-browser`
itself and warms it in the background at startup, so the first tool call doesn't
pay the cold-start cost.

---

## Anti-detection

Fingerprinting is handled by `camofox-browser` and the Camoufox engine; this
package is the adapter. Verified against the live server on 2026-08-09:

| Check | Result |
| --- | --- |
| TLS fingerprint (`tls.peet.ws`) | **Authentic Firefox** — no GREASE, `X25519MLKEM768` post-quantum group, correct cipher order |
| User agent | Consistent with the TLS stack (Firefox/Gecko) |

The Firefox version the engine reports is tied to the `camofox-browser` build in
use, not to this package. Keep that dependency current — a browser version far
behind release is itself a weak signal.

---

## Install

```bash
# 1. the browser server
npx camofox-browser@latest

# 2. this MCP server
git clone https://github.com/Skeeder1/camofox-mcp.git
cd camofox-mcp && npm install && npm run build
```

Register with an MCP client:

```json
{
  "mcpServers": {
    "camofox": {
      "command": "node",
      "args": ["/path/to/camofox-mcp/dist/index.js"],
      "env": {
        "CAMOFOX_URL": "http://localhost:9377",
        "CAMOFOX_LLM_ENABLED": "true",
        "CAMOFOX_LLM_PROVIDER": "openrouter",
        "CAMOFOX_LLM_API_KEY": "sk-or-...",
        "CAMOFOX_PROFILE": "lean"
      }
    }
  }
}
```

### HTTP transport

```bash
node dist/http.js --port 8101 --host 127.0.0.1
```

Secure it — inherited from upstream v1.14.5, and important, since an open port
means anyone can browse through your machine:

```bash
CAMOFOX_HTTP_API_KEY=...                       # bearer token on /mcp, min 32 chars
CAMOFOX_HTTP_ALLOWED_HOSTS=localhost,127.0.0.1 # DNS-rebinding protection
CAMOFOX_VIEWPORT=1280x720                      # default viewport for new tabs
```

Binding `--http-host` beyond loopback without a token is refused outright, and
a token shorter than 32 characters is rejected rather than quietly accepted.

---

## Documentation

| Document | Contents |
| --- | --- |
| [docs/quickstart.md](docs/quickstart.md) | first tab, first semantic call |
| [docs/guide.md](docs/guide.md) | task-oriented recipes |
| [docs/mcp-server.md](docs/mcp-server.md) | every tool, every argument |
| [docs/architecture/llm.md](docs/architecture/llm.md) | router, prompts, repair |
| [docs/architecture/tools.md](docs/architecture/tools.md) | layers and tool surface |
| [docs/operations.md](docs/operations.md) | deployment and troubleshooting |
| [features-inventory.md](features-inventory.md) | fork feature ledger |

## Testing

```bash
npm test              # 242 tests
npx tsc --noEmit      # type check
```

Coverage includes the LLM router and its fallback chain, JSON repair, layer
resolution, prompt loading, the semantic tools, config parsing and the HTTP auth
boundary.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Browser-engine and fingerprinting issues
belong to [camofox-browser](https://github.com/redf0x1/camofox-browser); adapter
and semantic-layer issues belong here.

## Licence

MIT, unchanged from upstream — Copyright (c) 2026 CamoFox MCP Contributors.
Fork modifications by Skeeder1.

## Roadmap

- **MCP sampling.** Delegate LLM calls to the calling client's own model via the
  MCP `sampling` capability, so the semantic tools would need no API key of their
  own. The config surface (`CAMOFOX_LLM_PREFER_SAMPLING`) is stubbed; the
  transport is not implemented yet.
- **Native Anthropic transport.** The router currently speaks OpenAI-compatible
  chat-completions to every provider through one HTTP path; a native
  `/v1/messages` path would drop that compatibility assumption for Claude models.
