# Référence des tools (47)

`camofox-mcp` enregistre jusqu'à **47 tools** sur le `McpServer`, regroupés par couche et catégorie. Chaque tool est défini via `server.tool(name, description, zodSchema, handler)` du SDK `@modelcontextprotocol/sdk`.

## Index par catégorie

| Catégorie | Fichier | Tools | Couche |
|---|---|---|---|
| Health | [tools/health.ts](../../src/tools/health.ts) | `server_status`, `stop_browser` | L0 (toujours) |
| Tabs | [tools/tabs.ts](../../src/tools/tabs.ts) | `create_tab`, `close_tab`, `list_tabs` | L0 |
| Navigation | [tools/navigation.ts](../../src/tools/navigation.ts) | `navigate`, `go_back`, `go_forward`, `refresh` | L0 |
| Sessions | [tools/session.ts](../../src/tools/session.ts) | `import_cookies`, `get_stats`, `camofox_close_session`, `toggle_display`, `set_task_context`, `get_task_context`, `diagnose_failure` | L0 |
| Profiles | [tools/profiles.ts](../../src/tools/profiles.ts) | `save_profile`, `load_profile`, `list_profiles`, `delete_profile` | L0 |
| Downloads | [tools/downloads.ts](../../src/tools/downloads.ts) | `list_downloads`, `get_download`, `delete_download` | L0 |
| Semantic | [tools/semantic.ts](../../src/tools/semantic.ts) | `extract`, `observe`, `act`, `find_element_by_prompt`, `execute` | L1 (`semantic`) |
| Interaction | [tools/interaction.ts](../../src/tools/interaction.ts) | `click`, `type_text`, `scroll`, `camofox_scroll_element`, `camofox_evaluate_js`, `camofox_hover`, `camofox_wait_for`, `camofox_press_key` | LEGACY |
| Observation | [tools/observation.ts](../../src/tools/observation.ts) | `snapshot`, `snapshot_dialog`, `camofox_get_page_html`, `camofox_query_selector`, `screenshot`, `get_links`, `camofox_wait_for_text`, `camofox_wait_for_selector` | LEGACY |
| Smart-snapshot | [tools/smart-snapshot.ts](../../src/tools/smart-snapshot.ts) | `smart_snapshot` | LEGACY |
| Extraction | [tools/extraction.ts](../../src/tools/extraction.ts) | `extract_resources`, `batch_download`, `resolve_blobs` | LEGACY |
| Search | [tools/search.ts](../../src/tools/search.ts) | `web_search` | LEGACY |
| Batch workflows | [tools/batch.ts](../../src/tools/batch.ts) | `fill_form`, `type_and_submit`, `navigate_and_snapshot`, `scroll_and_snapshot` | LEGACY |
| YouTube | [tools/youtube.ts](../../src/tools/youtube.ts) | `youtube_transcript` | LEGACY |
| Presets | [tools/presets.ts](../../src/tools/presets.ts) | `list_presets` | LEGACY |

## Documentation détaillée

- [core.md](core.md) — health, tabs, navigation, sessions, profiles, downloads, presets, youtube
- [interaction.md](interaction.md) — click 5-strategies, type_text, scroll, evaluate, hover, press_key, wait_for
- [observation.md](observation.md) — snapshot scoped/paginated, dialog, html, screenshot, links, wait
- [semantic.md](semantic.md) — extract, observe, act, find_element_by_prompt, execute, smart_snapshot
- [batch-search.md](batch-search.md) — fill_form, type_and_submit, navigate_and_snapshot, scroll_and_snapshot, web_search, extract_resources, batch_download, resolve_blobs

## Conventions communes

### Pattern d'un tool

```ts
server.tool(
  "tool_name",
  "Description visible dans tools/list",
  {
    /* Zod schema des arguments. Chaque champ a un .describe() exposé au client. */
    tabId: z.string().min(1).describe("..."),
    foo: z.string().optional()
  },
  async (input: unknown) => {
    try {
      const parsed = z.object({ /* idem */ }).parse(input);
      const tracked = getTrackedTab(parsed.tabId);                  // throw TAB_NOT_FOUND
      const result  = await deps.client.someMethod(...);            // HTTP
      incrementToolCall(parsed.tabId);                              // stats
      return okResult({ /* ... */ });
    } catch (error) {
      return toErrorResult(error);                                  // normalize
    }
  }
);
```

### Réponse

Toutes les réponses suivent :

```jsonc
// Succès
{ "content": [{ "type": "text", "text": "<JSON pretty 2-space>" }] }

// Erreur
{ "content": [{ "type": "text", "text": "{\"error\":\"CODE\",\"message\":\"...\"}" }], "isError": true }

// Image
{ "content": [{ "type": "image", "data": "<base64>", "mimeType": "image/png" }] }
```

### Identifiants

- **`tabId`** — string opaque retournée par `create_tab` ; identifie un tab côté `camofox-browser`. Format dépendant du browser (typiquement UUID ou similaire).
- **`userId`** — string logique pour l'isolation. Pas un user système, pas authentifié, fourni par le client. Tous les tabs d'un même `userId` partagent leur context Playwright (cookies, storage) côté browser.
- **`sessionKey`** — UUID v4 généré côté `camofox-mcp` à la création du tab, exposé via `list_tabs` et `get_stats`. Sert d'idempotency key éventuelle ; non transmis au browser.
- **`ref`** — identifier ARIA tree retourné par `snapshot` (format typique : `e1`, `e2`, …). Stable pendant la durée d'un snapshot, pas entre snapshots.

### Gestion userId par défaut

Plusieurs tools acceptent `userId?: string` optionnel. La résolution est toujours :

```ts
const userId = parsed.userId ?? deps.config.defaultUserId;     // pour les tools sans tabId
const userId = parsed.userId ?? tracked.userId;                // pour les tools avec tabId
```

`deps.config.defaultUserId` vient de `CAMOFOX_DEFAULT_USER_ID` (défaut `"default"`).

### Tools nécessitant `CAMOFOX_API_KEY`

Les tools suivants envoient `requireApiKey: true` au client HTTP, ce qui ajoute `x-api-key` + `Authorization: Bearer` aux requêtes vers `camofox-browser`. Si le browser server est configuré pour exiger l'auth, ces tools échouent en `API_KEY_REQUIRED` sans clé :

- `camofox_evaluate_js`
- `camofox_query_selector`
- `camofox_get_page_html`
- `camofox_wait_for_selector`
- `import_cookies`
- (fallback long-text de `type_text` → `evaluate` → idem)

Les autres tools fonctionnent sans clé si le browser server n'enforce pas l'auth.
