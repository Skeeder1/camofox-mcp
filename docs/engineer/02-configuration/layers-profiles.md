# Layers & profils

Le système de couches est un mécanisme de gating qui détermine **quels tools sont enregistrés** sur le `McpServer`. Il vit dans [`src/layers.ts`](../../src/layers.ts) et est consommé par [`src/server.ts`](../../src/server.ts).

## Les 7 flags

| Flag | Type | Effet quand `true` | Tools concernés |
|---|---|---|---|
| `core` | bool | _(constant: toujours `true`)_ | health, tabs, navigation, sessions, profiles, downloads |
| `semantic` | bool | Active L1 sémantique | `extract`, `observe`, `act`, `find_element_by_prompt`, `execute` |
| `stealth` | bool | _(réservé)_ | — |
| `vision` | bool | _(réservé — vision activée via LLM separately)_ | — |
| `cache` | bool | _(réservé)_ | — |
| `network` | bool | _(réservé)_ | — |
| `legacy` | bool | Active la suite historique de tools | interaction granulaire, observation détaillée, smart-snapshot, extraction, search, youtube, batch, presets |

## Profils prédéfinis

```ts
// src/layers.ts
const PROFILES = {
  lean:   { core: true, semantic: true,  stealth: false, vision: false, cache: false, network: false, legacy: false },
  full:   { core: true, semantic: true,  stealth: false, vision: false, cache: false, network: false, legacy: true  },
  custom: { core: true, semantic: false, stealth: false, vision: false, cache: false, network: false, legacy: false },
};
```

- **`full`** (défaut) — tous les tools, comportement historique
- **`lean`** — seulement L0 + sémantique (≈ 11 tools, ~70 % de réduction du surface area)
- **`custom`** — base minimale, à compléter avec des overrides

## Ordre d'enregistrement ([server.ts](../../src/server.ts))

```text
1. always:  registerHealthTools, registerTabsTools, registerNavigationTools,
            registerSessionTools, registerDownloadTools, registerProfileTools
2. if semantic: registerSemanticTools
3. if legacy:
     registerInteractionTools (inclut camofox_press_key)
     registerObservationTools
     registerSmartSnapshotTools
     registerExtractionTools
     registerSearchTools
     registerYouTubeTools
     registerBatchTools
     registerPresetTools
4. always:  registerPrompts
```

L'ordre matters côté MCP : la SDK liste les tools dans l'ordre d'appel à `server.tool()`, et certains clients affichent dans cet ordre.

## Override par variable d'environnement

Chaque flag a un override env qui **gagne** sur le profil :

```bash
# Profil "lean" mais on réactive les tools legacy
export CAMOFOX_LAYER_PROFILE=lean
export CAMOFOX_LAYER_LEGACY=true
```

Logique de résolution ([`applyOverride`](../../src/layers.ts)) :

```
si env truthy   → true
si env falsy    → false  (false, 0, no, n, off — case-insensitive)
si yaml truthy  → true
si yaml falsy   → false
sinon           → default profil
```

**Conséquence importante** : un `unset` côté env ne peut pas re-désactiver une couche activée par le yaml. Il faut explicitement écrire `CAMOFOX_LAYER_LEGACY=false`.

## Override par YAML

```yaml
# ~/.camofox-mcp/config.yaml
layer_profile: custom
layers_semantic: true
layers_legacy: false
```

Le préfixe est `layers_<flag>` pour les overrides individuels et `layer_profile` pour le choix du profil.

## Choix recommandés

| Cas d'usage | Profil | Overrides |
|---|---|---|
| Agent autonome moderne | `lean` | — |
| Workflow scripté token-efficient | `lean` | — |
| Migration progressive depuis legacy | `full` | — |
| Inspection / dev / debugging | `full` | — |
| Custom build (whitelist explicite) | `custom` | activer flags un par un |
| Sub-agent contraint à un seul flux | `custom` | `layers_semantic: true` uniquement |

## Impact sur le déploiement

- `lean` réduit fortement le **token budget** consommé par la liste des tools côté client MCP (chaque tool ≈ 100-300 tokens dans le list).
- `custom` permet de bâtir des bundles spécialisés (ex. agent "search-only", agent "form-fill-only").
- Le LLM router est **indépendant** des layers : un profil `lean` reste capable d'utiliser le LLM via les tools sémantiques.

## Reproduction d'un bundle "tool-set léger" historique

Pour reproduire le comportement d'avant le système de couches :

```bash
export CAMOFOX_LAYER_PROFILE=full
# (équivalent au défaut implicite)
```

Pour le profil minimal "agent autonome" recommandé :

```bash
export CAMOFOX_LAYER_PROFILE=lean
```
