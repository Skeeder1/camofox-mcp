# CLI & fichier YAML

## Arguments CLI

Parsés par [`loadConfig(argv, env)`](../../src/config.ts) — pas de framework, parsing manuel `--flag value`.

| Flag | Type | Défaut | Mapping env |
|---|---|---|---|
| `--camofox-url <url>` | string | `http://localhost:9377` | `CAMOFOX_URL` |
| `--api-key <key>` | string | _(vide)_ | `CAMOFOX_API_KEY` |
| `--default-user-id <id>` | string | `default` | `CAMOFOX_DEFAULT_USER_ID` |
| `--profiles-dir <path>` | path | `~/.camofox-mcp/profiles` | `CAMOFOX_PROFILES_DIR` |
| `--timeout <ms>` | int | `30000` | `CAMOFOX_TIMEOUT` |
| `--auto-save <bool>` | bool | `true` | `CAMOFOX_AUTO_SAVE` |
| `--transport <stdio\|http>` | string | `stdio` | `CAMOFOX_TRANSPORT` |
| `--http-port <int>` | int | `3000` | `CAMOFOX_HTTP_PORT` |
| `--http-host <host>` | string | `127.0.0.1` | `CAMOFOX_HTTP_HOST` |
| `--http-rate-limit <int>` | int | `60` | `CAMOFOX_HTTP_RATE_LIMIT` |

**Priorité** : CLI > env > défaut. Tout flag inconnu est ignoré silencieusement.

### Exemple stdio

```bash
camofox-mcp \
  --camofox-url http://localhost:9377 \
  --api-key $CAMOFOX_API_KEY \
  --default-user-id agent-1 \
  --profiles-dir /var/lib/camofox/profiles
```

### Exemple HTTP

```bash
camofox-mcp \
  --transport http \
  --http-host 127.0.0.1 \
  --http-port 3000 \
  --http-rate-limit 120
```

## Fichier YAML

Chemin : `~/.camofox-mcp/config.yaml`. Format **plat** key:value (pas de YAML imbriqué — voir parser ci-dessous).

```yaml
# ── Layers ──
layer_profile: lean
layers_semantic: true
layers_legacy: false

# ── LLM ──
llm_provider: openrouter
llm_model: google/gemini-2.5-flash
llm_fallback_model: anthropic/claude-haiku-4.5
llm_max_tokens: 8000
llm_temperature: 0
llm_timeout: 25000
llm_json_format: true

# Per-purpose models
llm_model_extract: anthropic/claude-3.5-sonnet
llm_model_act: google/gemini-2.5-flash
llm_model_observe: google/gemini-2.5-flash

# Clés API (alternative aux env vars)
llm_api_key: sk-or-v1-xxxx
# ou par provider :
# openrouter_api_key: sk-or-v1-xxxx
# openai_api_key: sk-xxxx
# anthropic_api_key: sk-ant-xxxx
# gemini_api_key: AIza-xxxx
```

### Parser implémenté ([llm/config.ts:54-72](../../src/llm/config.ts#L54), [layers.ts](../../src/layers.ts))

```text
pour chaque ligne :
  trim
  si vide ou commence par # → skip
  trouve le premier ':'
  key   = avant trim
  value = après trim, déquoté ('xxx' ou "xxx" → xxx)
```

**Conséquences :**
- Pas de support des arrays / objets imbriqués / multi-line
- Une seule entrée par clé (la dernière gagne en cas de duplicate — comportement `Record<string, string>`)
- Indentation ignorée

## Résolution finale (priorité)

Pour **tout** paramètre :

```
1. CLI argument          (config.ts uniquement)
2. Env var               (CAMOFOX_*, OPEN_ROUTER, etc.)
3. ~/.camofox-mcp/config.yaml
4. Hardcoded default
```

Pour les flags de couche, la résolution est plus subtile : **env truthy** > **env falsy** > **yaml truthy** > **yaml falsy** > défaut. Ça permet à un opérateur d'**activer** une couche désactivée par yaml, sans avoir à éditer le yaml ([layers.ts:applyOverride](../../src/layers.ts)).

## Permissions disque

À la création, le dossier `~/.camofox-mcp/` est traité avec :
- `mkdir { recursive: true, mode: 0o700 }` puis `chmod 0o700` ([profiles.ts:ensureProfilesDir](../../src/profiles.ts))
- Fichiers profil écrits en `mode: 0o600`

Le YAML de config n'est PAS créé automatiquement par le serveur — c'est à l'opérateur de le poser avec les permissions souhaitées.
