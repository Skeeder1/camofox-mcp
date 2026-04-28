# Documentation d'ingénieur — camofox-mcp

> Référence technique exhaustive du serveur MCP `camofox-mcp` (v1.13.x). Cette doc s'adresse aux contributeurs, mainteneurs et intégrateurs qui doivent **modifier**, **étendre** ou **opérer** le serveur — pas aux utilisateurs finaux (voir [../getting-started.md](../getting-started.md) et [../tool-reference/](../tool-reference/) pour ça).

## Comment lire cette documentation

| Si vous voulez… | Commencez par |
|---|---|
| Comprendre l'architecture globale | [01-architecture/overview.md](01-architecture/overview.md) |
| Configurer le serveur en prod | [02-configuration/environment-variables.md](02-configuration/environment-variables.md) |
| Comprendre stdio vs HTTP | [03-runtime/transports.md](03-runtime/transports.md) |
| Ajouter un nouveau tool MCP | [05-tools/README.md](05-tools/README.md) puis [01-architecture/components.md](01-architecture/components.md) |
| Modifier la couche LLM | [04-llm/router.md](04-llm/router.md) |
| Déboguer un crash / une fuite de tabs | [03-runtime/state-model.md](03-runtime/state-model.md) + [03-runtime/lifecycle.md](03-runtime/lifecycle.md) |
| Auditer la sécurité | [09-operations/security.md](09-operations/security.md) |

## Plan complet

### 1. Architecture
- [01-architecture/overview.md](01-architecture/overview.md) — vue 5 couches, principes de conception
- [01-architecture/components.md](01-architecture/components.md) — chaque fichier source et son rôle
- [01-architecture/data-flow.md](01-architecture/data-flow.md) — flux d'une requête MCP de bout en bout

### 2. Configuration
- [02-configuration/environment-variables.md](02-configuration/environment-variables.md)
- [02-configuration/cli-and-yaml.md](02-configuration/cli-and-yaml.md)
- [02-configuration/layers-profiles.md](02-configuration/layers-profiles.md)

### 3. Runtime
- [03-runtime/transports.md](03-runtime/transports.md)
- [03-runtime/state-model.md](03-runtime/state-model.md)
- [03-runtime/error-model.md](03-runtime/error-model.md)
- [03-runtime/lifecycle.md](03-runtime/lifecycle.md)

### 4. Couche LLM
- [04-llm/router.md](04-llm/router.md)
- [04-llm/configuration.md](04-llm/configuration.md)
- [04-llm/json-repair.md](04-llm/json-repair.md)

### 5. Tools (47)
- [05-tools/README.md](05-tools/README.md) — index + matrice de couches
- [05-tools/core.md](05-tools/core.md)
- [05-tools/interaction.md](05-tools/interaction.md)
- [05-tools/observation.md](05-tools/observation.md)
- [05-tools/semantic.md](05-tools/semantic.md)
- [05-tools/batch-search.md](05-tools/batch-search.md)

### 6. Client HTTP
- [06-client/http-client.md](06-client/http-client.md)
- [06-client/error-mapping.md](06-client/error-mapping.md)

### 7. Profils
- [07-profiles/persistence.md](07-profiles/persistence.md)
- [07-profiles/auto-save.md](07-profiles/auto-save.md)

### 8. Prompts MCP
- [08-prompts.md](08-prompts.md)

### 9. Opérations
- [09-operations/security.md](09-operations/security.md)
- [09-operations/observability.md](09-operations/observability.md)

### 10. Développement
- [10-development.md](10-development.md)

### 11. Référence
- [11-reference/types.md](11-reference/types.md)
- [11-reference/error-codes.md](11-reference/error-codes.md)
- [11-reference/env-vars.md](11-reference/env-vars.md)

## Conventions

- **Liens vers le code** : tous les liens `[fichier.ts:N](../../src/fichier.ts#LN)` pointent vers la source.
- **Schémas Zod** : reproduits littéralement depuis le code, pas reformulés.
- **Diagrammes** : Mermaid quand pertinent.
- **Identifiants techniques** (noms de tools, env vars, types) : en anglais. Prose : français.
- **Versionnement** : cette doc reflète l'état de [package.json](../../package.json) v1.13.x.
