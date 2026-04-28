# State model — `Map<tabId, TabInfo>`

Module : [`src/state.ts`](../../src/state.ts) (211 LOC). Toute la mémoire process-wide du serveur tient dans une **`Map` au niveau module**. Pas de DB, pas de Redis, pas de fichier d'état.

## Type `TabInfo`

```ts
// src/types.ts
export interface TabInfo {
  tabId: string;          // identifiant remote (camofox-browser)
  userId: string;         // isolation logique multi-utilisateurs
  sessionKey: string;     // randomUUID() local — non transmis au browser
  url: string;            // dernière URL visitée
  visitedUrls: string[];  // historique cap CAMOFOX_VISITED_URLS_LIMIT (50)
  toolCalls: number;      // compteur de tool calls réussis
  refsCount: number;      // refs ARIA du dernier snapshot
  createdAt: number;      // timestamp ms
  lastUsedAt: number;     // mis à jour à chaque incrementToolCall

  // ── Task tracking ──
  currentTask?: string;
  lastAction?: string;
  lastSnapshotHash?: string;
  taskHistory?: TaskHistoryEntry[]; // cap CAMOFOX_TASK_HISTORY_MAX (10), most recent first
}

export interface TaskHistoryEntry {
  ts: number;
  kind: "task" | "action" | "snapshot";
  text: string;
}
```

## Constantes

```ts
const MAX_TABS = 100;                                // hard-coded
const TAB_TTL_MS = parseInt(process.env.CAMOFOX_TAB_TTL_MS) || 1_800_000;  // 30 min
const VISITED_LIMIT = parseInt(process.env.CAMOFOX_VISITED_URLS_LIMIT) || 50;
const HISTORY_MAX  = parseInt(process.env.CAMOFOX_TASK_HISTORY_MAX) || 10;
```

## API publique

| Fonction | Effet | Throws |
|---|---|---|
| `trackTab(tabId, userId, sessionKey, url)` | Ajoute à la map. Refuse si `size >= MAX_TABS` | `MAX_TABS_EXCEEDED` |
| `getTrackedTab(tabId)` | Lookup + refresh `lastUsedAt` | `TAB_NOT_FOUND` |
| `removeTrackedTab(tabId)` | Suppression silencieuse | — |
| `listTrackedTabs()` | snapshot des tabs publics (sans `taskHistory`) | — |
| `getAllTrackedTabs()` | retourne tout `TabInfo` complet | — |
| `clearTrackedTabsByUserId(userId)` | bulk remove (ex : `close_session`, `toggle_display`) | — |
| `incrementToolCall(tabId)` | `++toolCalls` + `lastUsedAt` | — (no-op si absent) |
| `updateTabUrl(tabId, url)` | push `visitedUrls` (cap 50) + set `url` | — |
| `updateRefsCount(tabId, n)` | met à jour le compteur de refs ARIA | — |
| `setTabTask(tabId, task)` | set `currentTask` + push history `kind:"task"` | — |
| `clearTabTask(tabId)` | reset `currentTask` | — |
| `recordTabAction(tabId, action)` | set `lastAction` + push history `kind:"action"` | — |
| `setLastSnapshotHash(tabId, hash)` | utilisé par snapshot pour détecter le drift | — |
| `getTabTaskContext(tabId)` | `{ currentTask, lastAction, taskHistory, lastSnapshotHash }` | `TAB_NOT_FOUND` |
| `setupCleanup(client)` | démarre le sweep + handlers SIGINT/SIGTERM | — |

## Sweep périodique

```ts
function setupCleanup(client: CamofoxClient) {
  setInterval(() => {
    const now = Date.now();
    for (const [tabId, info] of trackedTabs) {
      if (now - info.lastUsedAt > TAB_TTL_MS) {
        client.closeTab(tabId, info.userId).catch(() => {});
        trackedTabs.delete(tabId);
      }
    }
  }, /* 60s */);
}
```

- L'intervalle interne tourne **chaque minute** par défaut.
- Le `closeTab` côté browser est **best-effort** — toute erreur est avalée.
- Un tab "active" (utilisé) ne sera jamais sweepé tant que `lastUsedAt` reste frais.

## Handlers de signal

```ts
process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);

async function gracefulShutdown() {
  // Timeout de 5s, après quoi process.exit(1)
  setTimeout(() => process.exit(1), 5000).unref();
  for (const [tabId, info] of trackedTabs) {
    await client.closeTab(tabId, info.userId).catch(() => {});
  }
  process.exit(0);
}
```

## Task history — modèle d'observabilité par tab

Chaque tab maintient un journal capped à 10 entrées (most recent first). C'est consommé par :
- `set_task_context` / `get_task_context` — exposition au client MCP
- `diagnose_failure` — heuristiques rule-based
- Le tool `snapshot` — injection de bannières `current_task` / `last_action` dans la réponse pour aider le LLM consommateur à rester focus

```ts
// Format de la bannière injectée dans le snapshot YAML
yaml-banner:
  task: "<currentTask, max 200 chars>"
  last_action: "<lastAction, max 200 chars>"
```

## Garanties & non-garanties

✅ **Garanti** :
- Ordre stable du `taskHistory` : most recent first
- Idempotence de `removeTrackedTab` / `incrementToolCall` (no-op si absent)
- `lastUsedAt` toujours frais après `getTrackedTab` (même usage en lecture)

❌ **Non garanti** :
- Persistance entre redémarrages (state in-memory uniquement)
- Atomicité multi-process (la `Map` n'est pas partagée entre instances HTTP scaled out)
- Cohérence avec `camofox-browser` après crash : un tab tracké peut pointer vers un tab inexistant côté browser → next call lèvera `TAB_NOT_FOUND` ou `INTERNAL_ERROR`
