# Modèle d'erreur

Module : [`src/errors.ts`](../../src/errors.ts) (91 LOC). Toutes les erreurs **internes** transitent par `AppError` ; les réponses MCP sont normalisées en `ToolResult`.

## `class AppError`

```ts
export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly status?: number   // HTTP status si pertinent
  ) {
    super(message);
    this.name = "AppError";
  }
}
```

## Codes d'erreur (`ErrorCode`)

| Code | Origine typique | HTTP suggéré |
|---|---|---|
| `CONNECTION_REFUSED` | `fetch` vers `camofox-browser` échoue | — |
| `TIMEOUT` | `AbortController` après `CAMOFOX_TIMEOUT` ms | — |
| `TAB_NOT_FOUND` | `getTrackedTab(id)` ou 404 du browser | 404 |
| `MAX_TABS_EXCEEDED` | `trackTab` quand `size >= 100` | — |
| `ELEMENT_NOT_FOUND` | 400 du browser avec message "element/ref/selector" | 400 |
| `NAVIGATION_FAILED` | 5xx du browser | 5xx |
| `API_KEY_REQUIRED` | 401/403 du browser | 401/403 |
| `PROFILE_NOT_FOUND` | `loadProfile` sur un id absent | — |
| `PROFILE_ERROR` | `saveProfile` validation Zod cookies invalides | — |
| `VALIDATION_ERROR` | `ZodError` sur l'input du tool | — |
| `INTERNAL_ERROR` | Catchall (réponse non-JSON, schéma inattendu) | — |

Détails complets : [11-reference/error-codes.md](../11-reference/error-codes.md).

## Format `ToolResult`

```ts
type ToolResult = {
  content: Array<TextContent | ImageContent | BinaryContent>;
  isError?: boolean;
};
```

C'est le contrat du SDK MCP. Tous les helpers retournent ce format.

## Helpers

### `okResult(data: unknown): ToolResult`

```ts
export function okResult(data: unknown): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }]
  };
}
```

Sérialisation JSON pretty (2-space). Pas de `isError`.

### `imageResult(base64: string, mimeType = "image/png"): ToolResult`

```ts
export function imageResult(base64: string, mimeType = "image/png"): ToolResult {
  return { content: [{ type: "image", data: base64, mimeType }] };
}
```

### `binaryResult(base64: string, mimeType: string): ToolResult`

Variante avec mime explicite (`image/jpeg`, etc.).

### `normalizeError(err: unknown): AppError`

```ts
if (err instanceof AppError) return err;
if (err instanceof ZodError) return new AppError("VALIDATION_ERROR", issues.join(", "));
if (err instanceof Error)    return new AppError("INTERNAL_ERROR", err.message);
return                              new AppError("INTERNAL_ERROR", String(err));
```

### `toErrorResult(err: unknown): ToolResult`

```ts
const app = normalizeError(err);
return {
  content: [{ type: "text", text: JSON.stringify({
    error: app.code,
    message: app.message,
    ...(app.status ? { status: app.status } : {})
  }) }],
  isError: true
};
```

## Pattern uniforme d'un tool

```ts
server.tool("foo", "...", schema, async (input) => {
  try {
    const parsed = Schema.parse(input);
    // ... logique métier (peut throw AppError, ZodError, ou Error nu)
    return okResult({ ... });
  } catch (error) {
    return toErrorResult(error);
  }
});
```

**Convention** : un tool ne plante **jamais** le serveur. Toute exception est convertie en `ToolResult { isError: true }`. Les erreurs LLM "soft" (`LLMDisabledError`) sont retournées en `okResult({ error: "LLM_DISABLED: ..." })` sans `isError` — le client peut continuer son flow.

## Mapping HTTP → AppError ([client.ts:buildHttpError](../../src/client.ts))

```
404                            → TAB_NOT_FOUND
401, 403                       → API_KEY_REQUIRED
400 + msg ~ /element|ref|selector/  → ELEMENT_NOT_FOUND
5xx                            → NAVIGATION_FAILED
autre                          → INTERNAL_ERROR
```

L'erreur Zod sur la **validation de réponse** côté client (réponse non conforme au schema attendu) → `INTERNAL_ERROR` avec le détail des `issues`.

## Exemple complet

Tool `click` avec ref invalide :

```jsonc
// MCP request
{
  "method": "tools/call",
  "params": {
    "name": "click",
    "arguments": { "tabId": "tab_abc", "ref": "e999" }
  }
}

// MCP response (isError: true)
{
  "content": [{
    "type": "text",
    "text": "{\"error\":\"ELEMENT_NOT_FOUND\",\"message\":\"Element not found: ref=e999\",\"status\":400}"
  }],
  "isError": true
}
```

Le client peut parser `content[0].text` en JSON et router sur `error` (le code).
