# Configuration de la couche LLM

Module : [`src/llm/config.ts`](../../src/llm/config.ts) (184 LOC). Centralise la résolution config pour le router.

## `interface LLMConfig`

```ts
export interface LLMConfig {
  enabled: boolean;            // Master switch
  provider: "openrouter" | "openai" | "anthropic" | "gemini" | "custom";
  apiUrl: string;              // Endpoint OpenAI-compat (sans trailing /)
  apiKey: string | undefined;  // Bearer token
  defaultModel: string;        // Modèle texte par défaut
  fallbackModel: string | undefined;
  visionModel: string;
  perPurposeModels: Partial<Record<string, string>>;
  maxTokens: number;
  temperature: number;
  timeoutMs: number;
  jsonFormat: boolean;         // Force response_format: json_object
  preferSampling: boolean;     // Réservé : MCP sampling avant HTTP
}
```

## Résolution

`loadLLMConfig(env, yaml): LLMConfig` lit dans cet ordre :

1. **Env vars** (`CAMOFOX_LLM_*`, `OPEN_ROUTER`, `CAMOFOX_SUMMARIZER_*` legacy)
2. **YAML** (`~/.camofox-mcp/config.yaml`, parser ligne par ligne)
3. **Défauts hardcodés**

Détails complets des env vars : [02-configuration/environment-variables.md](../02-configuration/environment-variables.md#couche-llm-srcllmconfigts).

## Provider → URL par défaut

```ts
function defaultApiUrl(provider): string {
  switch (provider) {
    case "openrouter": return "https://openrouter.ai/api/v1";
    case "openai":     return "https://api.openai.com/v1";
    case "anthropic":  return "https://api.anthropic.com/v1";  // ⚠ via wrapper OpenRouter recommended
    case "gemini":     return "https://generativelanguage.googleapis.com/v1beta/openai";
    default:           return "https://openrouter.ai/api/v1";
  }
}
```

⚠ Anthropic en natif n'expose pas exactement le format OpenAI-compat — préférer `provider: openrouter` avec `model: anthropic/claude-haiku-4.5`.

## Choix de la clé API

```ts
function pickApiKey(env, yaml, provider): string | undefined {
  // 1. Générique top-priorité
  const generic = env.CAMOFOX_LLM_API_KEY ?? yaml.llm_api_key;
  if (generic) return generic;

  switch (provider) {
    case "openrouter":
      return env.OPENROUTER_API_KEY
          ?? env.OPEN_ROUTER                          // convention projet
          ?? env.CAMOFOX_SUMMARIZER_API_KEY           // legacy
          ?? yaml.openrouter_api_key
          ?? yaml.summarizer_api_key;
    case "openai":     return env.OPENAI_API_KEY     ?? yaml.openai_api_key;
    case "anthropic":  return env.ANTHROPIC_API_KEY  ?? yaml.anthropic_api_key;
    case "gemini":     return env.GEMINI_API_KEY     ?? env.GOOGLE_API_KEY ?? yaml.gemini_api_key;
    default:           return env.CAMOFOX_LLM_API_KEY ?? yaml.llm_api_key;
  }
}
```

## Per-purpose models

Override par usage :

```yaml
# ~/.camofox-mcp/config.yaml
llm_model_extract: anthropic/claude-3.5-sonnet     # extraction longue → modèle puissant
llm_model_act: google/gemini-2.5-flash             # action courte → modèle rapide
llm_model_observe: google/gemini-2.5-flash
llm_model_find_element: google/gemini-2.5-flash
llm_model_summarize: google/gemini-2.5-flash       # smart_snapshot
llm_model_vision: google/gemini-2.5-flash          # vision
```

Ou par env :

```bash
export CAMOFOX_LLM_MODEL_EXTRACT="anthropic/claude-3.5-sonnet"
```

## Defaults hardcodés

| Champ | Défaut |
|---|---|
| `enabled` | `true` |
| `provider` | `openrouter` |
| `apiUrl` | `defaultApiUrl(provider)` |
| `apiKey` | _(undefined si rien fourni)_ |
| `defaultModel` | `google/gemini-2.5-flash` |
| `fallbackModel` | `anthropic/claude-haiku-4.5` |
| `visionModel` | `google/gemini-2.5-flash` |
| `perPurposeModels` | `{}` |
| `maxTokens` | `10000` |
| `temperature` | `0` |
| `timeoutMs` | `30000` |
| `jsonFormat` | `true` |
| `preferSampling` | `false` |

## Détection "enabled"

Le master switch `enabled` est résolu via :

```ts
const enabled = !isFalsy(
  env.CAMOFOX_LLM_ENABLED
  ?? yaml.llm_enabled
  ?? env.CAMOFOX_SMART_SNAPSHOT_ENABLED   // legacy
  ?? yaml.summarizer_enabled               // legacy
  ?? "true"
);
```

Si `enabled === false`, **tous** les tools LLM-aware retournent immédiatement :

```jsonc
{ "error": "LLM_DISABLED: LLM is disabled (CAMOFOX_LLM_ENABLED=false)" }
```

Si `enabled === true` mais `apiKey` absente :

```jsonc
{ "error": "LLM_DISABLED: no API key configured. Set OPEN_ROUTER, CAMOFOX_LLM_API_KEY, or the provider-specific env var." }
```

## `redactedLLMConfig(c)`

Helper pour les logs : redact `apiKey` avant impression.

```ts
export function redactedLLMConfig(c: LLMConfig): Record<string, unknown> {
  return { ...c, apiKey: c.apiKey ? "***" : undefined };
}
```

À utiliser systématiquement quand on log la config (ex : `console.error(redactedLLMConfig(cfg))`).

## Recettes de configuration

### OpenRouter (recommandé, défaut)

```bash
export OPEN_ROUTER="sk-or-v1-..."
# Tout le reste est par défaut
```

### OpenAI direct

```bash
export CAMOFOX_LLM_PROVIDER=openai
export OPENAI_API_KEY="sk-..."
export CAMOFOX_LLM_MODEL="gpt-4o-mini"
export CAMOFOX_LLM_FALLBACK_MODEL="gpt-4o"
```

### Gemini direct (via endpoint OpenAI-compat de Google)

```bash
export CAMOFOX_LLM_PROVIDER=gemini
export GEMINI_API_KEY="AIza..."
export CAMOFOX_LLM_MODEL="gemini-2.5-flash"
```

### Proxy custom local (LiteLLM, OpenRouter self-hosted, etc.)

```bash
export CAMOFOX_LLM_PROVIDER=custom
export CAMOFOX_LLM_API_URL="http://localhost:4000/v1"
export CAMOFOX_LLM_API_KEY="sk-anything"
export CAMOFOX_LLM_MODEL="llama-3.3-70b"
```
