# Prompts MCP

Module : [`src/prompts.ts`](../../src/prompts.ts). Le serveur enregistre 6 prompts MCP via `server.prompt(name, schema, handler)`. Ils sont consultables via `prompts/list` et `prompts/get` côté SDK MCP.

## Inventaire

| Nom | Source | Arguments | Rôle |
|---|---|---|---|
| `setup-verify` | inline | aucun | Checklist de vérif post-install |
| `troubleshoot` | inline | `symptom?: string` | Guide de debug avec branchements selon symptôme |
| `quick-start` | inline | `task?: string` | Démarrage rapide pour un agent novice |
| `agent-system-lean` | `dist/prompts/agent-system-lean.md` | aucun | System prompt pour profil `lean` (semantic only) |
| `agent-system-full` | `dist/prompts/agent-system-full.md` | aucun | System prompt pour profil `full` (legacy + semantic) |
| `agent-system-recovery` | `dist/prompts/agent-system-recovery.md` | aucun | Sub-prompt à inject quand un click/action a échoué |

## Chargement

Les 3 prompts `agent-system-*` sont **chargés au démarrage** depuis `dist/prompts/*.md` (copies des `src/prompts/*.md` à la build) :

```ts
const promptsDir = path.join(__dirname, "prompts");
const leanPrompt = await readFile(path.join(promptsDir, "agent-system-lean.md"), "utf-8");
// ...
```

Si la lecture échoue (fichier manquant), le prompt enregistré contient un fallback minimal.

## Détails — `setup-verify`

Pas d'arguments. Génère un message qui :
1. Suggère d'appeler `server_status` pour vérifier que le browser est UP
2. Suggère `create_tab` puis `navigate("https://example.com")` puis `snapshot`
3. Suggère `list_profiles` pour vérifier l'accès disque
4. Suggère un `extract` simple pour vérifier la couche LLM
5. Liste les variables d'env critiques à set : `OPEN_ROUTER`, éventuellement `CAMOFOX_API_KEY`

## Détails — `troubleshoot`

Argument optionnel `symptom`. Branchements (extraits) :
- `symptom === "click ne fonctionne pas"` → suggère `verify:true`, cascade `force/jsdispatch/keyboard-space`, `diagnose_failure`
- `symptom === "LLM ne répond pas"` → check `CAMOFOX_LLM_ENABLED`, `OPEN_ROUTER`, latence réseau
- `symptom === "tab perdu"` → vérifier TTL, `list_tabs`, recréer
- `symptom === undefined` → version générique avec arbre de décision

## Détails — `quick-start`

Argument optionnel `task` (description en langage naturel). Génère :
1. Étape 1 : create_tab
2. Étape 2 : navigate vers le site pertinent (suggéré selon la task)
3. Étape 3 : snapshot avec `current_task: <task>`
4. Étape 4 : recommande `act` ou `extract` selon la formulation
5. Étape 5 : pattern de récupération (try/catch + diagnose_failure)

## Système — `agent-system-lean.md`

Prompt système prêt-à-l'emploi pour un LLM qui consomme le profil `lean` (uniquement L0 + sémantique). Caractéristiques :
- Insiste sur `extract` / `act` / `observe` plutôt que sur des refs ARIA
- N'évoque pas `click` / `type_text` (non disponibles en lean)
- Encourage l'usage de `find_element_by_prompt` quand un ref précis est nécessaire

## Système — `agent-system-full.md`

Prompt système pour profil `full` (défaut). Couvre :
- Le workflow canonique : snapshot → act/click → snapshot → vérifier `newElementsCount`
- Quand préférer `act` (haut niveau, autonome) vs `click` direct (déterministe, économique)
- L'usage de `verify:true` et `diagnose_failure`
- Les patterns `extract` avec schéma JSON

## Système — `agent-system-recovery.md`

Sub-prompt à injecter par l'orchestrateur **après** une erreur ou un click non vérifié. Couvre :
- `diagnose_failure` en premier
- Re-snapshot avant de retry
- Stratégies alternatives (force, mouse, keyboard-space)
- Quand abandonner et `toggle_display: virtual` pour debug humain

## Utilisation côté agent

```ts
// Côté client MCP
const { messages } = await mcp.getPrompt("agent-system-full");
const systemPrompt = messages.find(m => m.role === "system")?.content;
// → injecté dans le system prompt du LLM principal
```

```ts
const { messages } = await mcp.getPrompt("troubleshoot", { symptom: "click ne fonctionne pas" });
// → guide pas à pas pour debug
```

## Tests

[src/__tests__/prompts.test.ts](../../src/__tests__/prompts.test.ts) vérifie :
- Les 3 fichiers `agent-system-*.md` sont bien copiés dans `dist/prompts/` après build
- Le contenu chargé n'est pas vide
- Les arguments optionnels sont correctement validés (Zod)
- Le serveur expose bien les 6 prompts via `prompts/list`
