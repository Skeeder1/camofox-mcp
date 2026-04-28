# Flux de données — d'un appel MCP à la réponse

## Cas 1 — Appel d'un tool simple (ex : `navigate`)

```mermaid
sequenceDiagram
  autonumber
  participant C as Client MCP
  participant T as Transport (stdio/http)
  participant S as McpServer
  participant Tool as registerNavigationTools.navigate
  participant State as state.ts
  participant Cli as CamofoxClient
  participant Br as camofox-browser

  C->>T: tools/call { name:"navigate", args:{tabId,url} }
  T->>S: dispatch
  S->>Tool: handler(args)
  Tool->>Tool: zod.parse(args)  → throw VALIDATION_ERROR si KO
  Tool->>State: getTrackedTab(tabId)  → throw TAB_NOT_FOUND si absent
  Tool->>Cli: client.navigate(tabId, url, userId)
  Cli->>Br: POST /tabs/{tabId}/navigate
  Br-->>Cli: 200 {url, title}
  Cli->>Cli: Zod parse réponse
  Cli-->>Tool: NavigateResponse
  Tool->>State: incrementToolCall(tabId) + updateTabUrl
  Tool->>Tool: recordTabAction("navigate", url)
  Tool-->>S: okResult({...})
  S-->>T: tools/call result
  T-->>C: JSON-RPC response
```

**Invariants :**
- Toute exception est attrapée par `try/catch` au niveau du handler et convertie via `toErrorResult(error)` (voir [03-runtime/error-model.md](../03-runtime/error-model.md)).
- Le tab DOIT exister dans `state.ts` avant tout appel (sauf `create_tab`).
- Chaque tool incrémente `tracked.toolCalls` (sauf erreurs précoces).

## Cas 2 — Tool sémantique (ex : `act`)

```mermaid
sequenceDiagram
  autonumber
  participant Tool as tools/semantic.act
  participant State as state.ts
  participant Cli as CamofoxClient
  participant Cache as TtlCache (5s)
  participant LLM as llm/router

  Tool->>Tool: ensureLLMReady() — bail si pas d'API key
  Tool->>Cli: client.snapshot(tabId, userId)  (fetch ARIA tree)
  Tool->>Cache: get(sha256(snapshot+intent))
  alt cache hit
    Cache-->>Tool: plan
  else miss
    Tool->>LLM: callLLMJson(actPrompt, snapshot+intent)
    LLM-->>Tool: { action, ref, confidence, reasoning }
    Tool->>Cache: set(key, plan)
  end
  Tool->>Tool: ActResultSchema.safeParse(plan)
  alt dry_run
    Tool-->>Caller: {executed:false, plan}
  else low_confidence
    Tool-->>Caller: {executed:false, reason:"low_confidence"}
  else
    Tool->>Cli: executePlan() → click/type/scroll/...
    Tool-->>Caller: {executed:true, plan, result}
  end
```

**Spécificités :**
- Cache TTL 5 s, max 50 entrées. Clé = `sha256(toolName + snapshot + intent + schema?)`.
- Si `LLM_DISABLED` → réponse normale (pas une erreur MCP) avec `{ error: "LLM_DISABLED: ..." }` dans le payload — le client peut continuer.
- `min_confidence` défaut = 0.6, paramétrable.
- Le `_meta` retourné inclut `model`, `latency_ms`, `repaired`, `used_fallback` pour la télémétrie.

## Cas 3 — Auto-start du browser server

```mermaid
sequenceDiagram
  autonumber
  participant Tool
  participant Cli as CamofoxClient
  participant Spawn as child_process
  participant Br as camofox-browser

  Tool->>Cli: client.healthCheck()
  Cli->>Br: GET /health
  Br-->>Cli: ECONNREFUSED
  Cli->>Cli: throw AppError("CONNECTION_REFUSED")
  Cli->>Cli: catch + ensureRunning()
  Cli->>Spawn: spawn("node", browserServerPath, {detached, stdio:"ignore"})
  loop 30 fois (×500ms)
    Cli->>Br: GET /health
    alt ok
      Br-->>Cli: 200
      Cli->>Cli: break
    else
      Br-->>Cli: ECONNREFUSED
    end
  end
  Cli->>Cli: retry original request (×1)
```

`ensureRunning()` n'est tenté qu'une seule fois par requête (`isRetry` flag) pour éviter les boucles infinies.

## Cas 4 — Cycle de vie d'un tab avec auto-save

```mermaid
sequenceDiagram
  autonumber
  participant Caller
  participant TabsTool as tools/tabs
  participant State
  participant Cli
  participant Profiles as profiles.ts

  Caller->>TabsTool: create_tab(userId)
  alt autoSave && profile _auto_<userId> existe
    TabsTool->>Profiles: loadProfile(profilesDir, "_auto_<userId>")
    Profiles-->>TabsTool: cookies + lastUrl
    TabsTool->>Cli: importCookies(userId, cookies)
    TabsTool->>Cli: navigate(tabId, lastUrl)
  end
  TabsTool->>State: trackTab(tabId, userId, sessionKey)
  TabsTool-->>Caller: { tabId, sessionKey }

  Caller->>TabsTool: close_tab(tabId)
  alt autoSave
    TabsTool->>Cli: exportCookies(tabId, userId)
    TabsTool->>Profiles: saveProfile("_auto_<userId>", ...) [withAutoTimeout 5s]
  end
  TabsTool->>Cli: closeTab(tabId, userId)
  TabsTool->>State: removeTrackedTab(tabId)
```

L'auto-save est **best-effort** : `withAutoTimeout(savePromise, 5000)`. Si le save plante ou timeout, la fermeture du tab continue normalement et `autoSaved: false` est renvoyé.
