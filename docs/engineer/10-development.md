# Développement

## Stack

- **TypeScript** strict mode (`tsconfig.json`)
- **ESM** — `"type": "module"` dans `package.json`
- **Vitest** pour les tests unitaires
- **Zod** pour le runtime validation
- **MCP SDK** `@modelcontextprotocol/sdk@1.26.0`

## Structure

```
camofox-mcp/
├── src/
│   ├── index.ts                  # Bin entrypoint (CLI)
│   ├── server.ts                 # Bootstrap McpServer + tools register
│   ├── client.ts                 # CamofoxClient (HTTP wrapper)
│   ├── http.ts                   # Express-like HTTP transport
│   ├── state.ts                  # Tab state Map + sweep
│   ├── profiles.ts               # Persistance JSON profils
│   ├── config.ts                 # Resolution config (env + yaml + cli)
│   ├── layers.ts                 # Layer / flags resolver
│   ├── prompts.ts                # 6 prompts MCP
│   ├── errors.ts                 # AppError + helpers
│   ├── types.ts                  # Types publiques (TabInfo, etc.)
│   ├── llm/
│   │   ├── router.ts             # Routeur appels LLM
│   │   ├── config.ts             # LLMConfig + resolution
│   │   └── repair.ts             # parseJsonLenient
│   ├── prompts/                  # *.md system prompts (copiés vers dist/)
│   ├── tools/                    # 16 fichiers, 47 tools
│   └── __tests__/                # 18 fichiers de tests
├── dist/                         # Build output (TS → JS)
├── docs/
│   └── engineer/                 # Cette doc
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## Scripts npm

`package.json` :

```jsonc
{
  "scripts": {
    "build": "tsc && cp -r src/prompts dist/prompts",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint src",
    "prepublishOnly": "npm run build && npm test",
    "start": "node dist/index.js",
    "start:http": "node dist/index.js --http"
  }
}
```

`prepublishOnly` garantit qu'on ne publie pas une version non testée. CI / release doit passer par `npm publish` (qui déclenche prepublishOnly).

## Build

```bash
npm run build
```

Sortie dans `dist/` :
- Tous les `.ts` compilés en `.js` ESM
- Les `src/prompts/*.md` copiés tels quels (chargés à runtime)
- `dist/index.js` est le binaire (`#!/usr/bin/env node` + `bin` field dans package.json)

⚠ **Ne pas oublier `cp -r src/prompts dist/prompts`** — sans ça, les prompts `agent-system-*` ne se chargeront pas, le serveur démarre quand même mais avec des prompts fallback.

## Tests

```bash
npm test                        # one-shot
npm run test:watch              # mode watch
npx vitest run src/__tests__/llm-repair.test.ts    # un seul fichier
```

### Fichiers de tests (extrait)

| Fichier | Couverture |
|---|---|
| `client.test.ts` | HTTP client + auto-retry + zod schemas |
| `state.test.ts` | TTL sweep, MAX_TABS, taskHistory cap |
| `profiles.test.ts` | Atomic write, mutex, regex validation |
| `layers.test.ts` | Profil resolution (lean/full/custom) |
| `llm-router.test.ts` | callLLMJson, fallback, telemetry |
| `llm-repair.test.ts` | parseJsonLenient, stripMarkdownFences |
| `errors.test.ts` | AppError, normalizeError, toErrorResult |
| `tools/click.test.ts` | Cascade des 5 stratégies |
| `tools/snapshot.test.ts` | Modes plein/scoped, banners |
| `tools/extract.test.ts` | Schema validation + fallback |
| `prompts.test.ts` | Chargement des `agent-system-*.md` |
| `config.test.ts` | env > yaml > defaults |
| `auto-save.test.ts` | Hooks create_tab / close_tab |
| `e2e/...` | Tests d'intégration (skippés sans browser) |

### Conventions de tests

- **Mocking de `fetch`** via `vi.fn()` (pas de MSW, pas de nock — la surface est petite)
- **Pas de tests live** par défaut. Les tests E2E sont gardés derrière un flag d'env
- **Mocking de `process.env`** via `vi.stubEnv()` au lieu de patch direct

```ts
// Pattern typique
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("loadProfile", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("returns PROFILE_NOT_FOUND when file is missing", async () => {
    await expect(loadProfile(tmpDir, "nonexistent")).rejects.toMatchObject({
      code: "PROFILE_NOT_FOUND"
    });
  });
});
```

## Conventions de style

- `noImplicitAny: true`, `strict: true`
- ESM uniquement — pas de `require()`. Imports avec `.js` extension obligatoire (TS resolved en ESM) :

```ts
import { CamofoxClient } from "./client.js";  // ✅ correct
import { CamofoxClient } from "./client";      // ❌ ne fonctionne pas
```

- **Export nommé** uniquement (pas de default export)
- **Async / await** — pas de `.then()` chaînés
- **Erreurs** via `AppError` dans les couches métiers, JS native dans les détails
- **Validation** Zod au boundary (entrée tool, sortie HTTP)

## Versioning

SemVer strict. La version actuelle est dans `package.json` (ex : `1.13.1`).

Pour le release :

```bash
npm version patch       # bump + tag git
npm publish             # prepublishOnly s'exécute
git push --follow-tags  # ⚠ confirmer avec le mainteneur
```

`CHANGELOG.md` doit être à jour à chaque bump non-trivial. Format Keep a Changelog.

## Contribuer

1. Fork + clone
2. `npm install` (Node 20+)
3. `npm test` doit passer avant tout commit
4. Linter sur les fichiers modifiés
5. PR avec description claire + tests pour les nouveaux comportements

## Debug local

### Mode stdio (défaut)

```bash
npm run build && node dist/index.js
# → écoute stdin/stdout, parle JSON-RPC MCP
```

Le test interactif via `mcp` CLI est recommandé :

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

### Mode HTTP

```bash
node dist/index.js --http --port 3000
# → POST http://127.0.0.1:3000/mcp/v1
```

Test rapide :
```bash
curl -X POST http://127.0.0.1:3000/mcp/v1 \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

### Avec un debugger

```bash
node --inspect-brk dist/index.js --http
# Ouvrir chrome://inspect, attach
```

## Dépendances

| Dépendance | Usage |
|---|---|
| `@modelcontextprotocol/sdk` | SDK MCP — `McpServer`, `StdioServerTransport`, `StreamableHTTPServerTransport` |
| `zod` | Validation runtime |
| `camofox-browser` | peer dep — le serveur browser que le client wrap |

Aucune autre dépendance runtime. Volontairement minimaliste.

DevDeps :
- `typescript`, `vitest`, `@types/node`, `eslint`, `prettier`, `@vitest/coverage-v8`

## Roadmap technique (non-engagement)

- OpenTelemetry export
- Mode stateful HTTP (sessions multi-requêtes vraies)
- Authentification JWT / mTLS native
- Cache distribué (Redis) pour `extractCache`/`actCache`/`observeCache`
- Endpoint `/admin/stats` natif
- Profile encryption at rest (libsodium)
