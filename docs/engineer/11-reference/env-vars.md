# Référence — Variables d'environnement

Index transverse de toutes les variables d'environnement reconnues par `camofox-mcp`. La doc détaillée est dans [02-configuration/environment-variables.md](../02-configuration/environment-variables.md) — cette page sert d'index rapide.

## Général

| Variable | Défaut | Effet |
|---|---|---|
| `CAMOFOX_URL` | `http://127.0.0.1:8080` | URL du serveur `camofox-browser` |
| `CAMOFOX_API_KEY` | _(none)_ | Bearer token pour les tools privilégiés |
| `CAMOFOX_TIMEOUT` | `30000` | Timeout HTTP (ms) du client |
| `CAMOFOX_DEFAULT_USER_ID` | `default` | userId fallback |

## HTTP transport

| Variable | Défaut | Effet |
|---|---|---|
| `CAMOFOX_HTTP` | `false` | Si `true`, démarre en HTTP au lieu de stdio |
| `CAMOFOX_PORT` | `3000` | Port HTTP |
| `CAMOFOX_HOST` | `0.0.0.0` | ⚠ Bind. **Mettre `127.0.0.1` en prod loopback** |
| `CAMOFOX_RATE_LIMIT_MAX` | `60` | Requêtes max par fenêtre |
| `CAMOFOX_RATE_LIMIT_WINDOW` | `60000` | Fenêtre rate-limit (ms) |

## State

| Variable | Défaut | Effet |
|---|---|---|
| `CAMOFOX_TAB_TTL_MS` | `1800000` (30min) | TTL des tabs inactifs |
| `CAMOFOX_MAX_TABS` | `100` | Cap d'occupation tabs |
| `CAMOFOX_TAB_SWEEP_INTERVAL_MS` | `60000` | Période du balayeur de tabs |
| `CAMOFOX_AUTO_SAVE` | `true` | Active hooks auto-save / auto-load |

## Profils

| Variable | Défaut | Effet |
|---|---|---|
| `CAMOFOX_PROFILES_DIR` | `~/.camofox-mcp/profiles` | Dossier des profils JSON |

## Layers

| Variable | Défaut | Effet |
|---|---|---|
| `CAMOFOX_LAYER` | `full` | `lean` / `full` / `custom` |
| `CAMOFOX_LAYER_HEALTH` | (héritée du profil) | Override flag `health` |
| `CAMOFOX_LAYER_TABS` | (héritée du profil) | Override flag `tabs` |
| `CAMOFOX_LAYER_NAVIGATION` | (héritée du profil) | Override flag `navigation` |
| `CAMOFOX_LAYER_SESSION` | (héritée du profil) | Override flag `session` |
| `CAMOFOX_LAYER_SEMANTIC` | (héritée du profil) | Override flag `semantic` |
| `CAMOFOX_LAYER_LEGACY` | (héritée du profil) | Override flag `legacy` |

Détails : [02-configuration/layers-profiles.md](../02-configuration/layers-profiles.md).

## LLM — global

| Variable | Défaut | Effet |
|---|---|---|
| `CAMOFOX_LLM_ENABLED` | `true` | Master switch |
| `CAMOFOX_LLM_PROVIDER` | `openrouter` | `openrouter` / `openai` / `anthropic` / `gemini` / `custom` |
| `CAMOFOX_LLM_API_URL` | _(selon provider)_ | Override URL |
| `CAMOFOX_LLM_API_KEY` | _(none)_ | API key générique (priorité absolue) |
| `CAMOFOX_LLM_MODEL` | `google/gemini-2.5-flash` | Modèle par défaut |
| `CAMOFOX_LLM_FALLBACK_MODEL` | `anthropic/claude-haiku-4.5` | Modèle de fallback |
| `CAMOFOX_LLM_VISION_MODEL` | `google/gemini-2.5-flash` | Modèle multimodal |
| `CAMOFOX_LLM_MAX_TOKENS` | `10000` | max_tokens par appel |
| `CAMOFOX_LLM_TEMPERATURE` | `0` | temperature |
| `CAMOFOX_LLM_TIMEOUT` | `30000` | Timeout LLM (ms) |
| `CAMOFOX_LLM_JSON_FORMAT` | `true` | response_format json_object |

## LLM — clés API par provider

| Variable | Provider | Priorité dans la résolution |
|---|---|---|
| `OPENROUTER_API_KEY` | openrouter | 1 |
| `OPEN_ROUTER` | openrouter | 2 (convention projet) |
| `OPENAI_API_KEY` | openai | 1 |
| `ANTHROPIC_API_KEY` | anthropic | 1 |
| `GEMINI_API_KEY` | gemini | 1 |
| `GOOGLE_API_KEY` | gemini | 2 |

## LLM — per-purpose models

| Variable | Effet |
|---|---|
| `CAMOFOX_LLM_MODEL_EXTRACT` | Modèle pour `extract` |
| `CAMOFOX_LLM_MODEL_OBSERVE` | Modèle pour `observe` |
| `CAMOFOX_LLM_MODEL_ACT` | Modèle pour `act` / `find_element_by_prompt` |
| `CAMOFOX_LLM_MODEL_SUMMARIZE` | Modèle pour `smart_snapshot` |
| `CAMOFOX_LLM_MODEL_VISION` | Modèle multimodal (override de `VISION_MODEL`) |
| `CAMOFOX_LLM_MODEL_FIND_ELEMENT` | Modèle pour `find_element_by_prompt` (override) |

## Legacy / compatibilité

Variables historiques encore reconnues pour ne pas casser les déploiements existants :

| Variable | Remplacée par | Toujours active ? |
|---|---|---|
| `CAMOFOX_SUMMARIZER_API_KEY` | `CAMOFOX_LLM_API_KEY` | Oui (priorité plus basse) |
| `CAMOFOX_SUMMARIZER_MODEL` | `CAMOFOX_LLM_MODEL` | Oui |
| `CAMOFOX_SUMMARIZER_API_URL` | `CAMOFOX_LLM_API_URL` | Oui |
| `CAMOFOX_SUMMARIZER_ENABLED` | `CAMOFOX_LLM_ENABLED` | Oui |
| `CAMOFOX_SMART_SNAPSHOT_ENABLED` | `CAMOFOX_LLM_ENABLED` | Oui |

## Vérification rapide de la config résolue

```bash
camofox-mcp --print-config         # CLI flag (si implémenté ; sinon lire le startup log stderr)
```

Le startup log ([src/index.ts](../../src/index.ts)) affiche typiquement :
```
[startup] config { http:false, port:3000, layer:"full", flags:{...}, llm:{provider:"openrouter", apiUrl:"https://...", apiKey:"***", defaultModel:"...", ...} }
```

API key toujours redacted via [`redactedLLMConfig()`](../../src/llm/config.ts).

## Précédence générale

```text
CLI flag  >  env var (specific)  >  env var (legacy)  >  yaml  >  default hardcodé
```

Pour les API keys LLM :

```text
CAMOFOX_LLM_API_KEY  >  yaml.llm_api_key  >  <provider-specific env>  >  yaml.<provider>_api_key
```

Pour OpenRouter en particulier :

```text
CAMOFOX_LLM_API_KEY
  > yaml.llm_api_key
  > OPENROUTER_API_KEY
  > OPEN_ROUTER
  > CAMOFOX_SUMMARIZER_API_KEY (legacy)
  > yaml.openrouter_api_key
  > yaml.summarizer_api_key (legacy)
```

## Voir aussi

- [02-configuration/environment-variables.md](../02-configuration/environment-variables.md) — détails complets avec exemples
- [02-configuration/cli-and-yaml.md](../02-configuration/cli-and-yaml.md) — équivalents CLI et YAML
- [04-llm/configuration.md](../04-llm/configuration.md) — comportement spécifique LLM
- [09-operations/security.md](../09-operations/security.md) — recommandations env pour la prod
