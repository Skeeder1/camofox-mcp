# Référence — Codes d'erreur

Recensement des 11 `ErrorCode` exposés par `camofox-mcp`. Source : [src/errors.ts](../../src/errors.ts).

## Format de réponse erreur

Toute erreur retournée à un client MCP suit cette forme :

```jsonc
{
  "content": [{
    "type": "text",
    "text": "{\"error\":\"<CODE>\",\"message\":\"...\",\"status\":<HTTP|null>}"
  }],
  "isError": true
}
```

Le client doit `JSON.parse(content[0].text)` pour récupérer la structure.

## Tableau complet

| Code | Origine principale | HTTP suggéré | Récupération |
|---|---|---|---|
| `TAB_NOT_FOUND` | state — `getTrackedTab` ; client — 404 | 404 | `create_tab` |
| `MAX_TABS_EXCEEDED` | state — `trackTab` quand size ≥ 100 | 429 | `close_tab` ou attendre TTL |
| `ELEMENT_NOT_FOUND` | client — 400 + message contient "element|ref|selector" | 400 | `snapshot()` puis re-issue |
| `API_KEY_REQUIRED` | client — 401/403 | 401 | Configurer `CAMOFOX_API_KEY` |
| `CONNECTION_REFUSED` | client — fetch error | 503 | retry après `ensureRunning` ; vérifier `camofox-browser` |
| `TIMEOUT` | client — AbortError sur timeout | 408 | augmenter `CAMOFOX_TIMEOUT` |
| `NAVIGATION_FAILED` | client — 5xx | 500 | retry, `diagnose_failure` |
| `VALIDATION_ERROR` | tools — Zod parse fail ; profiles — regex ID | 400 | corriger les arguments |
| `PROFILE_NOT_FOUND` | profiles — ENOENT sur read | 404 | `list_profiles` |
| `PROFILE_ERROR` | profiles — corruption JSON, Zod, write fail | 500 | inspecter le fichier |
| `INTERNAL_ERROR` | catchall | 500 | message contient les détails |

## Détails par code

### `TAB_NOT_FOUND`

**Origines** :
- `getTrackedTab(tabId)` ([src/state.ts](../../src/state.ts)) lève cette erreur si le tabId n'est pas dans la map locale
- `CamofoxClient.buildHttpError` mappe les `404` du browser sur ce code

**Message type** :
```
"Tab <tabId> not found. It may have been closed, expired (TTL), or never created."
```

**Action** : recréer le tab. Si récurrent, vérifier `CAMOFOX_TAB_TTL_MS` (peut-être trop court).

### `MAX_TABS_EXCEEDED`

**Origine** : `state.ts` quand `tabsMap.size >= MAX_TABS (100)`.

**Message** : `"Maximum tabs reached: 100"`.

**Action** : appeler `close_tab` sur les tabs inactifs, ou attendre le sweep TTL (toutes les `CAMOFOX_TAB_SWEEP_INTERVAL_MS = 60000` ms).

### `ELEMENT_NOT_FOUND`

**Origine** : `CamofoxClient.buildHttpError` quand le browser retourne `400` ET le message contient `element` / `ref` / `selector` (regex case-insensitive).

**Action** :
1. `snapshot()` pour des refs frais
2. Si toujours échec, vérifier que l'élément est bien rendu (lazy load / SPA hydration → `wait_for_selector`)

### `API_KEY_REQUIRED`

**Origines** :
- `CamofoxClient.buildHttpError` sur 401/403
- Pré-check : si tool requiert `CAMOFOX_API_KEY` mais aucune key configurée → AppError direct sans HTTP

**Tools concernés** : `evaluate_js`, `query_selector`, `get_page_html`, `import_cookies`, `wait_for_selector`, fallback long-text de `type_text`.

**Action** : `export CAMOFOX_API_KEY=<key>` (la même que côté `camofox-browser`).

### `CONNECTION_REFUSED`

**Origine** : `fetch` error réseau (browser pas up). Le client tente automatiquement `ensureRunning()` + retry ×1 ; ce code est levé après échec du retry.

**Action** :
- Vérifier `CAMOFOX_URL` (défaut `http://127.0.0.1:8080`)
- Vérifier que `camofox-browser` est installé (`npm ls camofox-browser`)
- Lancer manuellement `node $(npm root)/camofox-browser/bin/camofox-browser.js` pour voir les logs

### `TIMEOUT`

**Origine** : `AbortController` interne du client expiré (`CAMOFOX_TIMEOUT`, défaut 30 000 ms).

**Action** :
- Augmenter le timeout pour les opérations connues lentes (`screenshot fullPage` sur très grosse page, `evaluate` lourd)
- Réduire la portée (`focus_selector`, `clip` pour screenshots)

### `NAVIGATION_FAILED`

**Origine** : `CamofoxClient.buildHttpError` sur HTTP `5xx`. Le nom est historique (Playwright lève souvent des erreurs de navigation), mais couvre tous les 5xx.

**Action** :
- `server_status` pour vérifier `consecutiveFailures`
- `stop_browser` puis attendre auto-restart
- Inspecter les logs `camofox-browser`

### `VALIDATION_ERROR`

**Origines** :
- Zod parse fail sur les inputs des tools
- `validateProfileId` regex fail
- `client.smartTypeText` sans selector pour fallback long-text

**Message** : contient typiquement la structure des erreurs Zod ou le détail de la règle violée.

**Action** : corriger l'argument fautif. Le `message` est explicite.

### `PROFILE_NOT_FOUND`

**Origine** : `loadProfile` quand le fichier `.json` n'existe pas (`ENOENT`).

**Spécial** : pendant `create_tab` avec auto-load, ce code est **silencieusement attrapé** car c'est attendu pour les nouveaux userIds. `autoLoaded: false` est retourné sans erreur.

### `PROFILE_ERROR`

**Origines** :
- JSON corrompu sur disque
- Zod fail (ProfileSchema)
- `writeFile` échec (disque plein, permissions)

**Action** :
- `cat ~/.camofox-mcp/profiles/<profileId>.json | jq` pour valider la structure
- Si corrompu : `delete_profile` puis re-save_profile manuel
- Si écriture échoue : vérifier les permissions du dossier (doit être 0o700)

### `INTERNAL_ERROR`

**Origine** : catchall. N'importe quel error non typé (JS native, schema Zod sur réponse browser, JSON parse fail).

**Action** : inspecter `message` pour la cause. Si récurrent, reporter avec :
- version de `camofox-mcp`
- version de `camofox-browser`
- traces complètes (stderr du process)
- input du tool qui a déclenché

## Helpers de production

### `okResult(value)`

```ts
export function okResult(value: unknown) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}
```

### `imageResult(base64, mime?)`

```ts
export function imageResult(base64: string, mimeType: string = "image/png") {
  return { content: [{ type: "image", data: base64, mimeType }] };
}
```

### `binaryResult(base64, mime)`

```ts
export function binaryResult(base64: string, mimeType: string) {
  return { content: [{ type: "resource", resource: { uri: "...", mimeType, blob: base64 } }] };
}
```

### `normalizeError(error)`

```ts
export function normalizeError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof z.ZodError) {
    return new AppError("VALIDATION_ERROR", error.issues.map(...).join("; "));
  }
  if (error instanceof Error) {
    return new AppError("INTERNAL_ERROR", error.message);
  }
  return new AppError("INTERNAL_ERROR", String(error));
}
```

### `toErrorResult(error)`

```ts
export function toErrorResult(error: unknown) {
  const app = normalizeError(error);
  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        error: app.code,
        message: app.message,
        status: app.status,
        details: app.details
      })
    }],
    isError: true
  };
}
```
