# Composants — fichier par fichier

Inventaire exhaustif de [src/](../../src/). Chaque entrée précise : LOC, rôle, exports principaux, dépendances internes.

## Entry points

### [`src/index.ts`](../../src/index.ts) — 55 LOC
Point d'entrée stdio (binaire `camofox-mcp`).
- Charge la config via `loadConfig(process.argv, process.env)`
- Si `transport === "http"` → délègue à [`src/http.ts`](../../src/http.ts) (`startHttpServer`)
- Sinon → `createServer(config)` + `StdioServerTransport` + `server.connect(transport)`
- Handler de démarrage en échec : ferme tous les tabs trackés (`client.closeTab(tabId, userId)`) avant `process.exit(1)`

### [`src/http.ts`](../../src/http.ts) — 147 LOC
Transport HTTP via Express + StreamableHTTP du SDK MCP.
- `startHttpServer(config)` exporté
- Express + `helmet` + `cors` + middleware de rate-limit (par défaut 60/min/IP)
- Route `POST /mcp` : crée à chaque requête un nouveau `McpServer` ET un nouveau `StreamableHTTPServerTransport({ sessionIdGenerator: undefined })` → **stateless**
- Routes `GET /mcp` et `DELETE /mcp` → `405 Method Not Allowed`
- Cleanup `res.on("close")` ferme le transport et le server

### [`src/server.ts`](../../src/server.ts) — 73 LOC
Construit le `McpServer` SDK et enregistre les tools selon les flags de couche.
- `createServer(config)` retourne un `McpServer` configuré
- Instancie un `CamofoxClient` (singleton par server)
- Ordre d'enregistrement (déterministe pour la stabilité) :
  1. **L0** : health, tabs, navigation, sessions, profiles, downloads
  2. **L1 semantic** (si `flags.semantic`)
  3. **LEGACY** (si `flags.legacy`) : interaction, observation, smart-snapshot, extraction, search, youtube, batch, presets
  4. Prompts (toujours)
- Exporte `interface ToolDeps { client, config }` injecté dans chaque `register*Tools(server, deps)`

## Configuration & layers

### [`src/config.ts`](../../src/config.ts) — 145 LOC
Loader de config CLI + env. `loadConfig(argv, env): Config`.
- Parsing minimaliste de `argv` (pas de yargs)
- Priorité **CLI > env > default**
- Flags : `--camofox-url`, `--api-key`, `--default-user-id`, `--profiles-dir`, `--timeout`, `--auto-save`, `--transport`, `--http-port`, `--http-host`, `--http-rate-limit`
- Défauts : voir [02-configuration/environment-variables.md](../02-configuration/environment-variables.md)

### [`src/layers.ts`](../../src/layers.ts) — 145 LOC
Système de couches (`lean` / `full` / `custom`).
- `loadLayersConfig(): { profile, flags }`
- Lit `~/.camofox-mcp/config.yaml` puis applique les overrides env (`CAMOFOX_LAYER_*`)
- `pickProfile()` défaut = `"full"` (back-compat)
- `applyOverride(envValue, yamlValue, defaultValue)` : env truthy > env falsy > yaml truthy > yaml falsy > default
- Détails : [02-configuration/layers-profiles.md](../02-configuration/layers-profiles.md)

### [`src/types.ts`](../../src/types.ts) — 228 LOC
Toutes les interfaces TypeScript publiques. Voir [11-reference/types.md](../11-reference/types.md) pour le détail.

### [`src/errors.ts`](../../src/errors.ts) — 91 LOC
- `class AppError(code, message, status?)` étend `Error`
- 11 codes d'erreur (voir [11-reference/error-codes.md](../11-reference/error-codes.md))
- Helpers : `okResult()`, `imageResult()`, `binaryResult()`, `normalizeError()`, `toErrorResult()`
- Mapping `ZodError` → `VALIDATION_ERROR` automatique

### [`src/state.ts`](../../src/state.ts) — 211 LOC
Module-level `Map<tabId, TabInfo>` et son cycle de vie.
- `trackTab`, `getTrackedTab` (throw `TAB_NOT_FOUND`), `removeTrackedTab`, `listTrackedTabs`, `getAllTrackedTabs`, `clearTrackedTabsByUserId`
- Métriques : `incrementToolCall`, `updateTabUrl` (cap visité 50), `updateRefsCount`
- Task context : `setTabTask`, `clearTabTask`, `recordTabAction`, `setLastSnapshotHash`, `getTabTaskContext`
- `setupCleanup()` : timer de sweep + handlers SIGINT/SIGTERM
- Détails : [03-runtime/state-model.md](../03-runtime/state-model.md)

## Profils

### [`src/profiles.ts`](../../src/profiles.ts) — ~275 LOC
Persistance des cookies sur disque.
- `validateProfileId(id)` regex `/^[a-zA-Z0-9_][a-zA-Z0-9._-]{0,63}$/`
- `class Mutex` avec `runExclusive(fn)` + map global `Map<filePath, Mutex>`
- `withAutoTimeout<T>(promise, ms)` : `{ok:true,value} | {ok:false,reason:"timeout"|"error"}`
- `saveProfile / loadProfile / deleteProfile / listProfiles`
- Schema Zod `Profile` v1 + atomic write tmp → rename, mode `0o600`, dir `0o700`
- Détails : [07-profiles/persistence.md](../07-profiles/persistence.md)

## Prompts

### [`src/prompts.ts`](../../src/prompts.ts) — 166 LOC
6 prompts MCP enregistrés sur le server :
- `setup-verify` (statique)
- `troubleshoot` (avec arg optionnel `symptom`)
- `quick-start` (avec arg optionnel `task`)
- `agent-system-lean`, `agent-system-full`, `agent-system-recovery` : chargés depuis `dist/prompts/*.md` (ou `src/prompts/*.md` en dev)

## LLM

### [`src/llm/router.ts`](../../src/llm/router.ts) — 421 LOC
Router HTTP unique pour tous les appels LLM.
- 3 erreurs typées : `LLMDisabledError`, `LLMTransportError`, `LLMTimeoutError`
- Telemetry sinks (`onLLMTelemetry(sink)`) + counters agrégés
- Conversion message → format OpenAI-compat (texte + image_url)
- `pickModel(config, opts, isVision)` : option > vision > per-purpose > default
- `attemptOpenAICompat()` avec `AbortController` + signal externe composable
- `callJson<T>` haut-niveau avec retry sur fallback model + JSON repair

### [`src/llm/config.ts`](../../src/llm/config.ts) — 184 LOC
- `interface LLMConfig` (15 champs)
- `loadLLMConfig(env, yaml)` : env > yaml > default
- 5 providers supportés : `openrouter` (défaut) | `openai` | `anthropic` | `gemini` | `custom`
- Per-purpose models : `summarize`, `extract`, `act`, `observe`, `find_element`, `vision`
- API key fallback chain pour openrouter : `CAMOFOX_LLM_API_KEY` > `OPENROUTER_API_KEY` > `OPEN_ROUTER` > `CAMOFOX_SUMMARIZER_API_KEY` > yaml

### [`src/llm/repair.ts`](../../src/llm/repair.ts) — 91 LOC
- `stripMarkdownFences(text)` : retire ` ```json ` / ` ``` `
- `parseJsonLenient(text)` : essaie `JSON.parse` direct, sinon extrait l'objet entre `{...}` outermost

### [`src/llm/types.ts`](../../src/llm/types.ts), [`src/llm/index.ts`](../../src/llm/index.ts)
Types + barrel re-exports.

## HTTP Client

### [`src/client.ts`](../../src/client.ts) — 1172 LOC
Wrapper HTTP autour de l'API `camofox-browser`.
- Schémas Zod pour chaque réponse (raw + normalisée). Plusieurs `*RawResponseSchema` tolèrent les variations d'API.
- `LONG_TEXT_THRESHOLD = 400` : au-delà, `smartTypeText` fallback sur `evaluate()` qui assigne `value` directement (input/textarea/contenteditable).
- `class CamofoxClient` :
  - `healthCheck()`, `stopBrowser()`, `ensureRunning()` (lazy spawn `node browserServerPath`, poll /health 30×500ms = 15s)
  - `listPresets()` (404 → empty)
  - Tabs : `createTab`, `closeTab`
  - Navigation : `navigate`, `navigateMacro`, `goBack/goForward/refresh`
  - Interaction : `click`, `typeText`, `smartTypeText`, `scroll`, `scrollElement`, `evaluate`, `pressKey`, `hover`, `waitForReady`, `waitForText`
  - Observation : `snapshot`, `snapshotDialog`, `screenshot`, `getLinks/WithOptions`
  - Sessions : `closeSession`, `toggleDisplay`, `getStats`, `exportCookies`, `importCookies` (chunked 500/req)
  - Downloads : `listTabDownloads`, `listUserDownloads`, `getDownload`, `getDownloadContent`, `deleteDownload`
  - Resources : `extractResources`, `batchDownload`, `resolveBlobs`
  - Misc : `youtubeTranscript`
- HTTP layer privé : `request()`, `requestJson<T>(schema)`, `requestBinary()`, `requestNoContent()` + `buildHttpError()`
- Auto-retry × 1 sur `CONNECTION_REFUSED` après `ensureRunning()`
- Détails : [06-client/http-client.md](../06-client/http-client.md)

## Tools (`src/tools/`)

| Fichier | LOC | Tools enregistrés |
|---|---:|---|
| [`tabs.ts`](../../src/tools/tabs.ts) | 193 | `create_tab`, `close_tab`, `list_tabs` |
| [`navigation.ts`](../../src/tools/navigation.ts) | 109 | `navigate`, `go_back`, `go_forward`, `refresh` |
| [`interaction.ts`](../../src/tools/interaction.ts) | 321 | `click`, `type_text`, `scroll`, `camofox_scroll_element`, `camofox_evaluate_js`, `camofox_hover`, `camofox_wait_for`, `camofox_press_key` |
| [`observation.ts`](../../src/tools/observation.ts) | 441 | `snapshot`, `snapshot_dialog`, `camofox_get_page_html`, `camofox_query_selector`, `screenshot`, `get_links`, `camofox_wait_for_text`, `camofox_wait_for_selector` |
| [`semantic.ts`](../../src/tools/semantic.ts) | 560 | `extract`, `observe`, `act`, `find_element_by_prompt`, `execute` |
| [`smart-snapshot.ts`](../../src/tools/smart-snapshot.ts) | 232 | `smart_snapshot` |
| [`session.ts`](../../src/tools/session.ts) | 257 | `import_cookies`, `get_stats`, `camofox_close_session`, `toggle_display`, `set_task_context`, `get_task_context`, `diagnose_failure` |
| [`profiles.ts`](../../src/tools/profiles.ts) | 135 | `save_profile`, `load_profile`, `list_profiles`, `delete_profile` |
| [`downloads.ts`](../../src/tools/downloads.ts) | 221 | `list_downloads`, `get_download`, `delete_download` |
| [`extraction.ts`](../../src/tools/extraction.ts) | 161 | `extract_resources`, `batch_download`, `resolve_blobs` |
| [`batch.ts`](../../src/tools/batch.ts) | 348 | `fill_form`, `type_and_submit`, `navigate_and_snapshot`, `scroll_and_snapshot` |
| [`search.ts`](../../src/tools/search.ts) | 64 | `web_search` |
| [`youtube.ts`](../../src/tools/youtube.ts) | 31 | `youtube_transcript` |
| [`presets.ts`](../../src/tools/presets.ts) | 29 | `list_presets` |
| [`health.ts`](../../src/tools/health.ts) | 34 | `server_status`, `stop_browser` |

Total ≈ 47 tools. Détails par catégorie dans [05-tools/](../05-tools/).
