# Observabilité

`camofox-mcp` expose plusieurs sources d'observabilité — counters internes, télémétrie LLM, logs disque. Cette section les recense.

## `get_stats` — état runtime du tab

```ts
// MCP tool
{ tabId } → {
  visitedUrls: string[];    // cap 50 dernières
  toolCalls: number;
  refsCount: number;        // dernière valeur snapshot
  sessionKey: string;
  remote: { /* stats du browser-side, JSON quelconque */ }
}
```

Permet de mesurer l'activité par tab. Utile pour :
- Détecter un agent en boucle (toolCalls qui ne convergent pas)
- Tracer les pages visitées
- Vérifier la fraîcheur des refs

## Router LLM — counters globaux

[src/llm/router.ts](../../src/llm/router.ts) maintient un compteur process-wide :

```ts
interface RouterCounters {
  totalCalls: number;
  okCalls: number;
  errorCalls: number;
  repairedCalls: number;       // appels où parseJsonLenient a sauvé la mise
  fallbackCalls: number;       // appels où le fallback model a réussi
  totalLatencyMs: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
}

export function getRouterCounters(): Readonly<RouterCounters>;
export function resetRouterCounters(): void;     // pour les tests
```

Pas exposé via un tool MCP par défaut — à intégrer dans un endpoint d'admin si nécessaire (ex : `/admin/stats` côté reverse proxy custom).

## Télémétrie LLM par-événement

Sinks via `onLLMTelemetry(callback)` :

```ts
type LLMTelemetryEvent = {
  ts: string;                                  // ISO timestamp
  purpose: string;                             // "extract" | "act" | "observe" | "summarize" | ...
  model: string;
  provider: string;
  status: "ok" | "error" | "fallback_used" | "repaired";
  latencyMs: number;
  usage?: { prompt: number; completion: number; total: number };
  error?: string;                              // status === "error"
};

import { onLLMTelemetry } from "camofox-mcp/dist/llm/router.js";

onLLMTelemetry((ev) => {
  // Forward vers Datadog, Honeycomb, journald, ...
  appendFile("/var/log/camofox-mcp/llm.jsonl", JSON.stringify(ev) + "\n");
});
```

Plusieurs sinks supportés. Une exception dans un sink ne propage pas (try/catch interne).

## Smart-snapshot — logs disque

Chaque appel à `smart_snapshot` ([src/tools/smart-snapshot.ts](../../src/tools/smart-snapshot.ts)) écrit un fichier dans :

```
~/.camofox-mcp/logs/smart-snapshot/
└── 20251122-143022_ok_<sha>.json
```

Contenu :
```jsonc
{
  "ts": "2025-11-22T14:30:22.000Z",
  "tabId": "...",
  "currentTask": "...",
  "lastAction": "...",
  "rawSnapshot": "...",          // YAML ARIA brut
  "prompt": [...],               // messages envoyés au LLM
  "model": "google/gemini-2.5-flash",
  "rawResponse": "...",          // texte brut LLM
  "parsed": { ... },             // après parseJsonLenient
  "status": "ok" | "error" | "llm_disabled",
  "latencyMs": 1234,
  "repaired": false,
  "usedFallback": false
}
```

⚠ Les logs ne sont **pas rotated automatiquement**. Set up une rotation via cron / systemd timer / logrotate :

```bash
0 3 * * * find ~/.camofox-mcp/logs/smart-snapshot -type f -mtime +7 -delete
```

## State counters

[src/state.ts](../../src/state.ts) ne maintient pas de counters globaux. La taille de la map peut être inspectée via :

```ts
import { getAllTrackedTabs } from "camofox-mcp/dist/state.js";
const allTabs = getAllTrackedTabs();
console.log("active tabs:", allTabs.length);
```

À intégrer dans un endpoint d'admin si besoin.

## HTTP — accès logs

[src/http.ts](../../src/http.ts) log chaque requête entrante en stderr (format Express-like). Format approximatif :

```
[2025-11-22T14:30:22.000Z] POST /mcp/v1 200 12ms - 0.0.0.0
```

Pour les déploiements prod, intercepter via stdin/stderr du process.

## stdio — pas de logs requête

En mode stdio (défaut), il n'y a pas de log par requête (ce serait du bruit dans le canal stdio MCP). Les `console.error` de startup et d'erreur sont eux écrits sur stderr, donc visibles.

## Métriques recommandées à surveiller

| Métrique | Source | Alerte si |
|---|---|---|
| Active tab count | `getAllTrackedTabs().length` | > 80 (cap = 100) |
| toolCalls par tab | `get_stats` | > 200 sur un tab "court" → bug en boucle |
| Router error rate | `getRouterCounters()` | `errorCalls / totalCalls > 5 %` |
| Router latency p95 | Telemetry sink | > 10 s |
| `repairedCalls / totalCalls` | counters | > 30 % → modèle qui produit du JSON dégradé, à changer |
| Disk : profils | `du -sh ~/.camofox-mcp/profiles/` | > 100 MB → nettoyer les `_auto_*` orphelins |
| Disk : logs smart-snapshot | `du -sh ~/.camofox-mcp/logs/` | > 1 GB → activer rotation |
| consecutiveFailures | `server_status` | > 3 → restart browser |

## Healthcheck minimal

Pour un orchestrateur (Kubernetes, fly.io, …) :

```bash
curl -s http://127.0.0.1:3000/mcp/v1 \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"server_status","arguments":{}}}' \
  | jq -e '.result.content[0].text | fromjson | .ok == true'
```

Status 0 si tout va bien, sinon non-zero. À mettre dans le `livenessProbe` / `readinessProbe`.

## Trace & corrélation

`camofox-mcp` n'implémente **pas** OpenTelemetry pour le moment. Pour corréler les requêtes MCP côté client avec les opérations browser :
- Le client MCP doit envoyer un `id` JSON-RPC unique
- Le `tabId` retourné par `create_tab` peut servir de correlation key
- Le `sessionKey` (UUID v4 par tab) est exposé via `list_tabs` et `get_stats`

Pour un trace bout-en-bout, instrumenter manuellement via `onLLMTelemetry` + un wrapper côté client autour des tool calls.
