# `CamofoxClient` — client HTTP

Module : [`src/client.ts`](../../src/client.ts) (1172 LOC). C'est le **wrapper HTTP** unique autour de l'API REST de `camofox-browser`. Toute communication avec le browser server passe par lui.

## Constructeur

```ts
new CamofoxClient(config: Config);
// stocke baseUrl, apiKey, timeout, defaultUserId, browserServerPath
```

`browserServerPath` est résolu via `require.resolve("camofox-browser/bin/camofox-browser.js")` (peer dependency).

## Auto-start du serveur browser (`ensureRunning`)

```ts
private async ensureRunning(): Promise<void> {
  const child = spawn("node", [this.browserServerPath], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env }
  });
  child.unref();

  // Poll /health 30 fois × 500ms (15s max)
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 500));
    try {
      const ok = await this.healthCheck();
      if (ok.ok) return;
    } catch { /* continue */ }
  }
  throw new AppError("CONNECTION_REFUSED", "camofox-browser failed to start within 15s");
}
```

**Quand est-il appelé ?** Dans le `catch` de `request()` quand l'erreur est `CONNECTION_REFUSED` ET que ce n'est pas déjà un retry.

```ts
private async request(path, init, isRetry = false) {
  try {
    const res = await fetch(...);
    if (!res.ok) throw await this.buildHttpError(res);
    return res;
  } catch (error) {
    if (error instanceof AppError && error.code === "CONNECTION_REFUSED" && !isRetry) {
      await this.ensureRunning();
      return this.request(path, init, true);   // retry × 1
    }
    throw error;
  }
}
```

Une seule tentative de retry par requête. Si la 2ème tentative échoue, l'erreur est propagée.

## Layer HTTP privé

### `request(path, init, isRetry?)`
Bas-niveau. Gère :
- Construction des headers (`content-type: application/json`, `x-api-key`, `Authorization: Bearer` si `requireApiKey`)
- AbortController + timeout
- Mapping HTTP status → AppError ([06-client/error-mapping.md](error-mapping.md))
- Auto-retry après `ensureRunning()` sur `CONNECTION_REFUSED`

### `requestJson<T>(path, init, schema: z.ZodType<T>): Promise<T>`
Requête + parse JSON + validation Zod. Si la réponse n'est pas du JSON valide ou ne matche pas le schema → `AppError("INTERNAL_ERROR", details)`.

### `requestBinary(path, init): Promise<ArrayBuffer>`
Pour les screenshots, les downloads — retourne `arrayBuffer()`.

### `requestNoContent(path, init): Promise<void>`
Pour les opérations qui n'ont pas de réponse utile (ex : `pressKey`, `scroll`).

## API publique — par catégorie

### Health & lifecycle
- `healthCheck(): Promise<HealthResponse>`
- `stopBrowser(): Promise<void>`
- `ensureRunning(): Promise<void>` (privé mais déclenché automatiquement)

### Tabs
- `createTab(userId, preset?): Promise<{ tabId: string }>` — accepte plusieurs schémas de réponse (`id` / `tabId` / `tab.id`) via `CreateTabRawResponseSchema`
- `closeTab(tabId, userId): Promise<void>`

### Navigation
- `navigate(tabId, url, userId): Promise<NavigateResponse>`
- `navigateMacro(tabId, macro, query, userId): Promise<NavigateResponse>` — pour `@google_search`, etc.
- `goBack(tabId, userId)`, `goForward(tabId, userId)`, `refresh(tabId, userId)`

### Interaction
- `click(tabId, params, userId): Promise<ClickResponse>` — params = `{ ref?, selector?, strategy?, retries?, verify?, pre_wait_ms?, post_wait_ms? }`
- `typeText(tabId, params, text, userId): Promise<void>`
- `smartTypeText(tabId, params, text, userId)` — fallback `evaluate` si `text.length > 400`
- `pressKey(tabId, key, userId)`
- `scroll(tabId, direction, amount?, userId)`
- `scrollElement(tabId, params, userId): Promise<{ ok, scrollPosition }>`
- `evaluate(tabId, expression, userId, timeout?): Promise<{ ok, result, resultType, truncated, error?, errorType? }>` — `requireApiKey: true`
- `hover(tabId, params, userId)`
- `waitForReady(tabId, userId, timeout?, waitForNetwork?)`
- `waitForText(tabId, userId, text, timeoutMs?)` — implémentation côté **client** : poll `snapshot()` toutes les 500 ms

### Observation
- `snapshot(tabId, userId, offset?, scopedParams?): Promise<SnapshotResponse>`
- `snapshotDialog(tabId, userId): Promise<SnapshotDialogResponse>`
- `screenshot(tabId, userId, options?): Promise<{ buffer: Buffer; mime }>`
- `getLinks(tabId, userId)`, `getLinksWithOptions(tabId, userId, options)`

### Sessions
- `closeSession(userId)`
- `toggleDisplay(userId, headless): Promise<ToggleDisplayResponse>`
- `getStats(tabId, userId): Promise<StatsResponse>`
- `exportCookies(tabId, userId): Promise<unknown[]>`
- `importCookies(userId, cookies, tabId?)` — chunké à **500 cookies/requête**

### Downloads
- `listTabDownloads(tabId, userId, filters?)`
- `listUserDownloads(userId, filters?)`
- `getDownload(downloadId, userId)`
- `getDownloadContent(downloadId, userId): Promise<Buffer>`
- `deleteDownload(downloadId, userId)`

### Resources
- `extractResources(tabId, params)`
- `batchDownload(tabId, params)`
- `resolveBlobs(tabId, userId, urls)`

### Misc
- `youtubeTranscript(url, languages?): Promise<YouTubeTranscriptResponse>`
- `listPresets(): Promise<PresetsResponse>` — graceful 404 → `{ presets: {} }`

## Schémas Zod — exemples

Le client utilise des schémas Zod pour valider **chaque** réponse du browser. Ça protège contre les régressions d'API et les réponses malformées.

```ts
const CreateTabRawResponseSchema = z.union([
  z.object({ tabId: z.string() }),
  z.object({ id: z.string() }),
  z.object({ tab: z.object({ id: z.string() }) }),
]).transform(/* normalize to { tabId } */);

const ClickRawResponseSchema = z.object({
  clicked: z.boolean().optional(),
  strategy: z.string().optional(),
  retries_used: z.number().optional(),
  verified: z.boolean().optional()
}).passthrough();

const SnapshotRawResponseSchema = z.object({
  url: z.string().nullable().optional(),
  snapshot: z.string().nullable().optional(),
  refsCount: z.number().optional(),
  truncated: z.boolean().optional(),
  totalChars: z.number().optional(),
  hasMore: z.boolean().optional(),
  nextOffset: z.number().nullable().optional(),
  scoped: z.boolean().optional(),
  newElementsCount: z.number().optional()
});
```

Variations tolérées via `.passthrough()` et `.optional()` pour ne pas casser au moindre changement mineur côté browser.

## Long-text fallback (`smartTypeText`)

```ts
async smartTypeText(tabId, locator, text, userId) {
  if (text.length <= LONG_TEXT_THRESHOLD /* = 400 */) {
    return this.typeText(tabId, locator, text, userId);
  }
  // Fallback: assigner directement la valeur via JS
  if (!locator.selector)
    throw new AppError("VALIDATION_ERROR", "A CSS selector is required for long text input");

  const result = await this.evaluate(
    tabId,
    buildLongTextEvaluateExpression(locator.selector, text),
    userId
  );
  if (!result.ok) throw new AppError(...);
}

// buildLongTextEvaluateExpression(selector, text) génère un IIFE qui :
//   - querySelector(selector)
//   - si <input>/<textarea>: el.value = text + dispatchEvent("input"/"change")
//   - si contenteditable: el.textContent = text + dispatch
```

⚠ Cette voie n'envoie pas individuellement chaque keypress (rapide pour les longs textes) mais peut ne pas déclencher les handlers React `onChange` qui s'attendent à des keystrokes. Si le formulaire ne reçoit pas correctement la valeur, splitter le texte en chunks < 400 chars et passer en mode standard.

## Configuration

Le client lit ces champs dans `Config` :

| Champ | Source | Effet |
|---|---|---|
| `camofoxUrl` | `CAMOFOX_URL` | base URL pour fetch |
| `apiKey` | `CAMOFOX_API_KEY` | bearer token (`x-api-key` + `Authorization`) |
| `timeout` | `CAMOFOX_TIMEOUT` | abort de la requête |
| `defaultUserId` | `CAMOFOX_DEFAULT_USER_ID` | userId fallback si non fourni |

Aucune mutation runtime — la config est gelée à la construction.

## Tests

Les tests `client.test.ts` ([src/__tests__/client.test.ts](../../src/__tests__/client.test.ts)) couvrent :
- mocking de `fetch` global
- les chemins d'erreur HTTP (404 → TAB_NOT_FOUND, 401 → API_KEY_REQUIRED, etc.)
- les schemas Zod (acceptation des variantes, rejet des malformés)
- l'auto-retry (`ensureRunning` mocké via `child_process` mock)
