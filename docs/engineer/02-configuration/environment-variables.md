# Variables d'environnement

Référence exhaustive. Toutes les vars sont **optionnelles** avec un défaut documenté.

## Configuration générale ([src/config.ts](../../src/config.ts))

| Variable | Défaut | Type | Rôle |
|---|---|---|---|
| `CAMOFOX_URL` | `http://localhost:9377` | URL | Endpoint du serveur `camofox-browser` |
| `CAMOFOX_API_KEY` | _(vide)_ | string | Bearer token transmis en `x-api-key` + `Authorization: Bearer …`. Requis pour : `evaluate`, `query_selector`, `get_page_html`, `wait_for_selector`, `import_cookies` |
| `CAMOFOX_DEFAULT_USER_ID` | `default` | string | userId implicite quand non fourni |
| `CAMOFOX_PROFILES_DIR` | `~/.camofox-mcp/profiles` | path | Dossier de stockage des profils JSON (créé `mode 0o700`) |
| `CAMOFOX_TIMEOUT` | `30000` | ms | Timeout par requête HTTP vers `camofox-browser` |
| `CAMOFOX_AUTO_SAVE` | `true` | bool | Active l'auto-load au `create_tab` et l'auto-save au `close_tab`/`close_session` |
| `CAMOFOX_TRANSPORT` | `stdio` | `stdio`\|`http` | Choix du transport MCP |

## Transport HTTP ([src/http.ts](../../src/http.ts))

| Variable | Défaut | Type | Rôle |
|---|---|---|---|
| `CAMOFOX_HTTP_PORT` | `3000` | int | Port d'écoute |
| `CAMOFOX_HTTP_HOST` | `127.0.0.1` | host | Bind address. ⚠ Ne JAMAIS exposer `0.0.0.0` sans reverse proxy + auth |
| `CAMOFOX_HTTP_RATE_LIMIT` | `60` | req/min/IP | `express-rate-limit` window 60s |

## State ([src/state.ts](../../src/state.ts))

| Variable | Défaut | Type | Rôle |
|---|---|---|---|
| `CAMOFOX_TAB_TTL_MS` | `1800000` | ms (30 min) | TTL d'inactivité avant sweep d'un tab |
| `CAMOFOX_VISITED_URLS_LIMIT` | `50` | int | Cap de l'historique d'URLs par tab |
| `CAMOFOX_TASK_HISTORY_MAX` | `10` | int | Cap des entrées de `taskHistory` par tab |
| `MAX_TABS` | `100` | const | Hard-coded dans [state.ts](../../src/state.ts) — non configurable |

## Layers ([src/layers.ts](../../src/layers.ts))

| Variable | Défaut | Type | Rôle |
|---|---|---|---|
| `CAMOFOX_LAYER_PROFILE` | `full` | `lean`\|`full`\|`custom` | Profil de couches |
| `CAMOFOX_LAYER_SEMANTIC` | _(profil)_ | bool | Force activation/désactivation L1 sémantique |
| `CAMOFOX_LAYER_STEALTH` | _(profil)_ | bool | Réservé (couche stealth pas encore exposée) |
| `CAMOFOX_LAYER_VISION` | _(profil)_ | bool | Réservé |
| `CAMOFOX_LAYER_CACHE` | _(profil)_ | bool | Réservé |
| `CAMOFOX_LAYER_NETWORK` | _(profil)_ | bool | Réservé |
| `CAMOFOX_LAYER_LEGACY` | _(profil)_ | bool | Active/désactive les tools legacy |

Détails [02-configuration/layers-profiles.md](layers-profiles.md).

## Couche LLM ([src/llm/config.ts](../../src/llm/config.ts))

| Variable | Défaut | Type | Rôle |
|---|---|---|---|
| `CAMOFOX_LLM_ENABLED` | `true` | bool | Master switch |
| `CAMOFOX_LLM_PROVIDER` | `openrouter` | `openrouter`\|`openai`\|`anthropic`\|`gemini`\|`custom` | Provider |
| `CAMOFOX_LLM_API_URL` | _(par provider)_ | URL | Override de l'endpoint OpenAI-compat |
| `CAMOFOX_LLM_API_KEY` | _(vide)_ | string | Clé générique, prioritaire sur celles spécifiques |
| `CAMOFOX_LLM_MODEL` | `google/gemini-2.5-flash` | string | Modèle texte par défaut |
| `CAMOFOX_LLM_FALLBACK_MODEL` | `anthropic/claude-haiku-4.5` | string | Modèle de secours sur erreur primaire |
| `CAMOFOX_LLM_VISION_MODEL` | `google/gemini-2.5-flash` | string | Modèle vision (multimodal) |
| `CAMOFOX_LLM_MODEL_<PURPOSE>` | _(défaut)_ | string | Override par usage. Purposes : `SUMMARIZE`, `EXTRACT`, `ACT`, `OBSERVE`, `FIND_ELEMENT`, `VISION` |
| `CAMOFOX_LLM_MAX_TOKENS` | `10000` | int | `max_tokens` envoyé au provider |
| `CAMOFOX_LLM_TEMPERATURE` | `0` | float | Température. 0 = déterministe |
| `CAMOFOX_LLM_TIMEOUT` | `30000` | ms | Timeout par tentative |
| `CAMOFOX_LLM_JSON_FORMAT` | `true` | bool | Force `response_format: { type: "json_object" }` (sauf vision) |
| `CAMOFOX_LLM_PREFER_SAMPLING` | `false` | bool | Réservé : tente MCP sampling avant HTTP |

### Clés API par provider (fallback chain)

Le router cherche dans cet ordre :
1. `CAMOFOX_LLM_API_KEY` (générique, top priorité)
2. **OpenRouter** : `OPENROUTER_API_KEY` → `OPEN_ROUTER` → `CAMOFOX_SUMMARIZER_API_KEY` → yaml
3. **OpenAI** : `OPENAI_API_KEY` → yaml
4. **Anthropic** : `ANTHROPIC_API_KEY` → yaml
5. **Gemini** : `GEMINI_API_KEY` → `GOOGLE_API_KEY` → yaml

## Compatibilité legacy (smart-snapshot historique)

Conservées pour compatibilité avec les déploiements antérieurs :

| Variable legacy | Remplacée par | Note |
|---|---|---|
| `CAMOFOX_SUMMARIZER_API_URL` | `CAMOFOX_LLM_API_URL` | toujours lue |
| `CAMOFOX_SUMMARIZER_API_KEY` | `CAMOFOX_LLM_API_KEY` | toujours lue |
| `CAMOFOX_SUMMARIZER_MODEL` | `CAMOFOX_LLM_MODEL` | toujours lue |
| `CAMOFOX_SUMMARIZER_FALLBACK_MODEL` | `CAMOFOX_LLM_FALLBACK_MODEL` | toujours lue |
| `CAMOFOX_SUMMARIZER_MAX_TOKENS` | `CAMOFOX_LLM_MAX_TOKENS` | toujours lue |
| `CAMOFOX_SUMMARIZER_TEMPERATURE` | `CAMOFOX_LLM_TEMPERATURE` | toujours lue |
| `CAMOFOX_SUMMARIZER_TIMEOUT` | `CAMOFOX_LLM_TIMEOUT` | toujours lue |
| `CAMOFOX_SUMMARIZER_JSON_FORMAT` | `CAMOFOX_LLM_JSON_FORMAT` | toujours lue |
| `CAMOFOX_SMART_SNAPSHOT_ENABLED` | `CAMOFOX_LLM_ENABLED` | toujours lue |

## Standards

- **Booléens falsy** acceptés : `"false"`, `"0"`, `"no"`, `"n"`, `"off"` (case-insensitive). Tout autre string non vide = truthy.
- **Number parsing** : `parseInt` / `parseFloat` ; `NaN` → fallback au défaut documenté.
- **URL** : trailing `/` stripé automatiquement sur `CAMOFOX_LLM_API_URL`.
