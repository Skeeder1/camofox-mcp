# Tools — Semantic (L1) + Smart-Snapshot

Tools LLM-aware. Activés quand `flags.semantic: true` (profils `lean` et `full`). Pour `smart_snapshot` : `flags.legacy: true`.

Fichiers :
- [tools/semantic.ts](../../src/tools/semantic.ts) (560 LOC)
- [tools/smart-snapshot.ts](../../src/tools/smart-snapshot.ts) (232 LOC)

## Garde commune `ensureLLMReady()`

Tous les tools sémantiques commencent par :

```ts
function ensureLLMReady(): { error: string } | null {
  if (!llmConfig.enabled)
    return { error: "LLM_DISABLED: LLM is disabled (CAMOFOX_LLM_ENABLED=false)" };
  if (!llmConfig.apiKey)
    return { error: "LLM_DISABLED: no API key configured. Set OPEN_ROUTER, CAMOFOX_LLM_API_KEY, or the provider-specific env var." };
  return null;
}
```

Si guard non-null → `okResult(guard)` immédiat (réponse normale, pas une erreur MCP).

## Cache TTL commun

Chaque tool sémantique a son **propre `TtlCache<T>`** :

```ts
const extractCache = new TtlCache<...>();   // TTL 5s, max 50
const observeCache = new TtlCache<...>();
const actCache     = new TtlCache<...>();
```

Clé = `sha256(toolName + snapshot + intent + schemaStr)`. Évite de relancer le LLM si le même `(snapshot, intent)` est demandé deux fois en 5 secondes.

---

## `extract`

Extraction structurée via LLM. Le LLM lit le snapshot ARIA et retourne un JSON.

```ts
{
  tabId: z.string().min(1),
  query: z.string().min(1),                    // "all product cards: name, price, rating"
  schema: z.record(z.string(), z.unknown()).optional(),  // JSON Schema (recommandé)
  userId: z.string().optional()
}
```

**Prompt système** : chargé depuis `dist/prompts/semantic-extract.md` (voir [src/prompts/](../../src/prompts/)).

**Réponse type** :
```jsonc
{
  "data": [...] | {...},
  "missing_fields": ["price for item 3"],
  "confidence": 0.85,
  "source_refs": ["e12", "e15", "e18"],
  "_meta": {
    "model": "google/gemini-2.5-flash",
    "latency_ms": 1234,
    "repaired": false,
    "used_fallback": false,
    "cached": false
  }
}
```

**Validation** : `ExtractResultSchema.safeParse(json)`. Si fail → fallback `{ data: <raw>, confidence: 0.3, notes: "schema validation failed" }`.

---

## `observe`

Liste les éléments pertinents avec scoring de relevance. Plus économique que `snapshot` quand on veut juste savoir « que peut-on faire ici ? ».

```ts
{
  tabId,
  intent: z.string().optional(),               // "I want to log in"
  userId: z.string().optional()
}
```

**Réponse** :
```jsonc
{
  "candidates": [
    { "ref": "e3", "role": "button", "label": "Sign in", "purpose": "auth", "relevance": 0.95 },
    { "ref": "e7", "role": "link",   "label": "Forgot password?", "purpose": "auth_recovery", "relevance": 0.6 },
    ...
  ],
  "_meta": { ... }
}
```

---

## `act`

Action haut-niveau planifiée par le LLM puis exécutée.

```ts
{
  tabId,
  intent: z.string().min(1),                   // "click the login button"
  dry_run: z.boolean().optional(),             // si true: retourne le plan sans exécuter
  min_confidence: z.number().min(0).max(1).optional(),  // défaut 0.6
  userId: z.string().optional()
}
```

**Pipeline** :

```text
1. ensureLLMReady → bail
2. fetchSnapshot(tabId)
3. cache lookup
4. miss → callLLMJson(actPrompt, snapshot+intent)
   → { action, ref?, selector?, text?, direction?, amount?, url?, ms?, confidence, reasoning }
5. ActResultSchema.safeParse
6. dry_run → return { executed:false, reason:"dry_run", plan }
7. action === "noop" → return { executed:false, reason:"noop", plan }
8. confidence < min_confidence → return { executed:false, reason:"low_confidence", plan }
9. switch action: convert plan → PlanStep
10. executePlan([step], stopOnError:true)
11. return { executed:true, plan, result, _meta }
```

**Actions supportées** : `click`, `type`, `scroll`, `navigate`, `wait`, `noop` (LLM signale qu'aucune action utile n'est possible).

**Confidence** : valeur en `[0, 1]` retournée par le LLM. `min_confidence` (défaut **0.6**) est le seuil sous lequel on n'exécute pas mais on retourne le plan pour inspection.

---

## `find_element_by_prompt`

Résout un seul ref depuis une description naturelle, **sans exécuter**. Pour chaîner avec une logique custom.

```ts
{
  tabId,
  prompt: z.string().min(1),                   // "the search input"
  userId: z.string().optional()
}
```

**Réponse** :
```jsonc
{
  "ref": "e23",
  "selector": null,
  "confidence": 0.9,
  "reasoning": "The textbox with placeholder 'Search...' matches the prompt",
  "_meta": { ... }
}
```

Réutilise le **prompt système d'`act`** avec une intent reformulée `"click <prompt>"`. Sert principalement à offrir un point d'extension : on récupère le ref puis on enchaîne avec un click custom (autre stratégie, autres options).

---

## `execute`

**Plan typé sans LLM**. Permet de scripter une séquence d'actions atomiques. Idéal pour les workflows déterministes (formulaires multi-champs, navigation scriptée).

```ts
{
  tabId,
  plan: z.array(PlanStepSchema).min(1),
  stop_on_error: z.boolean().optional(),       // défaut true
  userId: z.string().optional()
}
```

### `PlanStepSchema` (discriminated union)

```ts
type PlanStep =
  | { type: "click"; ref?: string; selector?: string }
  | { type: "type"; ref?: string; selector?: string; text: string }
  | { type: "scroll"; direction: "up" | "down"; amount?: number }
  | { type: "navigate"; url: string }
  | { type: "wait"; ms: number }
  | { type: "press_key"; key: string };
```

### Réponse

```jsonc
{
  "ok": true,
  "aborted": false,
  "steps": [
    { "index": 0, "type": "click", "ok": true, "details": { ... } },
    { "index": 1, "type": "type", "ok": true, "details": { ... } },
    { "index": 2, "type": "press_key", "ok": false, "error": "..." }
  ],
  "_meta": {
    "latency_ms": 1234,
    "total_steps": 3,
    "executed_steps": 3
  }
}
```

Avec `stop_on_error: true` (défaut), un step en échec arrête la séquence. Avec `false`, tous les steps tentent leur exécution et le résultat est résumé.

---

## `smart_snapshot` (LEGACY)

Snapshot **résumé par le LLM** sous forme de JSON compact optimisé pour la décision de navigation. Alternative économique à un `snapshot` brut quand la page est volumineuse.

```ts
{
  tabId,
  current_task: z.string().optional(),
  last_action: z.string().optional(),
  include_raw_on_failure: z.boolean().optional()    // si LLM down, inclure le snapshot brut
}
```

**Cache** : 5 s, clé `sha256(snapshot + currentTask + lastAction)`.

**Réponse type** :
```jsonc
{
  "page_type": "search_results",
  "task_relevant_elements": [
    { "ref": "e5", "role": "button", "label": "Filter", "rationale": "matches user task" },
    ...
  ],
  "forms": [...],
  "items": [...],
  "pagination": { "current": 1, "total": 10, "next_ref": "e80" },
  "alerts": [],
  "change_summary": "3 new product cards loaded"
}
```

Si `LLM_DISABLED` :
```jsonc
{
  "error": "LLM_DISABLED: ...",
  "raw_snapshot_available": true,
  "alerts": []
}
// + si include_raw_on_failure → ajoute le YAML brut
```

### Télémétrie disque

`smart_snapshot` écrit pour chaque appel un fichier de log dans `~/.camofox-mcp/logs/smart-snapshot/<timestamp>_<status>.json` contenant :
- l'input snapshot
- le prompt envoyé
- la réponse brute du LLM
- la réponse parsée
- le model utilisé
- la latency

Très utile pour le debug post-mortem. ⚠ Peut grossir — prévoir une rotation manuelle ou logrotate.

## Comparatif

| Tool | Coût LLM | Sortie | Use case |
|---|---|---|---|
| `snapshot` | 0 (pas de LLM) | YAML ARIA brut | Référence canonique |
| `smart_snapshot` | 1 appel | JSON résumé | Décision rapide sur page volumineuse |
| `extract` | 1 appel | JSON typé | Récupérer des données structurées |
| `observe` | 1 appel | Candidats rankés | « Que faire ici ? » |
| `act` | 1 appel + exécution | Plan + résultat | Action haut-niveau autonome |
| `find_element_by_prompt` | 1 appel | Seul ref | Chaînage custom |
| `execute` | 0 (déterministe) | Résultats par step | Workflow scripté |
