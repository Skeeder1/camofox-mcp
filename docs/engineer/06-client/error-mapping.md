# Mapping HTTP → AppError

Implémenté dans [`CamofoxClient.buildHttpError`](../../src/client.ts) — appelé pour chaque réponse non-2xx du serveur `camofox-browser`.

## Algorithme

```ts
private async buildHttpError(response: Response): Promise<AppError> {
  let message = `CamoFox API request failed with ${response.status}`;

  // 1. Tenter de lire le body comme JSON { error?, message? }
  const rawBody = await response.text();
  if (rawBody) {
    try {
      const json = JSON.parse(rawBody);
      const parsed = ApiErrorPayloadSchema.safeParse(json);
      if (parsed.success) {
        message = parsed.data.error ?? parsed.data.message ?? rawBody;
      } else {
        message = rawBody;
      }
    } catch {
      message = rawBody;        // body non-JSON → on prend tel quel
    }
  }

  // 2. Mapping par status code
  if (response.status === 404) {
    return new AppError("TAB_NOT_FOUND", message, 404);
  }
  if (response.status === 401 || response.status === 403) {
    const hint = "CAMOFOX_API_KEY is required for this operation";
    const combined = message.toLowerCase().includes("camofox_api_key")
      ? message
      : `${hint} (${response.status}): ${message}`;
    return new AppError("API_KEY_REQUIRED", combined, response.status);
  }
  if (response.status === 400 && /element|ref|selector/i.test(message)) {
    return new AppError("ELEMENT_NOT_FOUND", message, 400);
  }
  if (response.status >= 500) {
    return new AppError("NAVIGATION_FAILED", message, response.status);
  }
  return new AppError("INTERNAL_ERROR", message, response.status);
}
```

## Tableau de mapping

| HTTP status | Conditions | AppError code | Note |
|---|---|---|---|
| `404` | toujours | `TAB_NOT_FOUND` | Tab supprimé / inexistant côté browser |
| `401` | toujours | `API_KEY_REQUIRED` | Auth manquante. Hint ajouté si message ne mentionne pas déjà `CAMOFOX_API_KEY` |
| `403` | toujours | `API_KEY_REQUIRED` | Idem |
| `400` | message match `/element\|ref\|selector/i` | `ELEMENT_NOT_FOUND` | Le browser a rejeté un ref/selector invalide |
| `400` | autre | `INTERNAL_ERROR` | Validation plus large |
| `500-504` | toujours | `NAVIGATION_FAILED` | Reformulé en faveur de la cause typique : navigation foirée |
| `429` | (pas de mapping spécial) | `INTERNAL_ERROR` | Rate-limit côté browser. À surveiller |
| autre | | `INTERNAL_ERROR` | Catchall |

## Erreurs **non**-HTTP

Avant le `request()`, plusieurs exceptions JS peuvent être levées :

| Origine | AppError mappé | Détails |
|---|---|---|
| `AbortError` | `TIMEOUT` | timeout interne (`CAMOFOX_TIMEOUT`) |
| `fetch error` (DNS, ECONNREFUSED) | `CONNECTION_REFUSED` | Déclenche `ensureRunning()` puis retry × 1 |
| `JSON.parse` échec sur body attendu JSON | `INTERNAL_ERROR` | message inclut le path et le status |
| `ZodError` sur schema de réponse | `INTERNAL_ERROR` | message inclut les `issues` |

## Mapping inverse (pour le client MCP)

Quand un tool retourne une erreur, le payload final côté MCP est :

```jsonc
{
  "content": [{
    "type": "text",
    "text": "{\"error\":\"<CODE>\",\"message\":\"...\",\"status\":404}"
  }],
  "isError": true
}
```

Le client peut donc router sur `error` :

| `error` | Action recommandée |
|---|---|
| `TAB_NOT_FOUND` | re-`create_tab` |
| `MAX_TABS_EXCEEDED` | `close_tab` ou attendre le sweep TTL |
| `ELEMENT_NOT_FOUND` | `snapshot()` pour rafraîchir les refs |
| `API_KEY_REQUIRED` | configurer `CAMOFOX_API_KEY` |
| `CONNECTION_REFUSED` | retry plus tard / vérifier `camofox-browser` |
| `TIMEOUT` | augmenter `CAMOFOX_TIMEOUT` ou simplifier la page |
| `NAVIGATION_FAILED` | retry + `diagnose_failure` |
| `VALIDATION_ERROR` | corriger les arguments du tool call |
| `PROFILE_NOT_FOUND` | `list_profiles` pour voir ce qui existe |
| `PROFILE_ERROR` | inspecter le format des cookies |
| `INTERNAL_ERROR` | inspecter `message` ; reporter si récurrent |

## Exemple de boucle de récupération côté agent

```ts
async function safeClick(tabId, ref) {
  try {
    return await mcp.call("click", { tabId, ref, verify: true });
  } catch (e) {
    if (e.error === "ELEMENT_NOT_FOUND") {
      const snap = await mcp.call("snapshot", { tabId });
      // re-prompt LLM with fresh refs
      return retryWithNewRef(snap);
    }
    if (e.error === "TAB_NOT_FOUND") {
      const { tabId: newTab } = await mcp.call("create_tab", { url: ... });
      return safeClick(newTab, ref);
    }
    throw e;
  }
}
```
