# Réparation JSON tolérante

Module : [`src/llm/repair.ts`](../../src/llm/repair.ts) (91 LOC). Utilisé par le router pour parser les sorties LLM même quand elles ne sont pas du JSON strict.

## Pourquoi ?

Même avec `response_format: { type: "json_object" }`, certains modèles :
- enrobent la réponse dans une fence Markdown ` ```json … ``` `
- prefixent du texte explicatif (« Voici le JSON: { … } »)
- suffixent une signature
- mélangent du JSON valide avec du texte libre

Pour éviter de gâcher un appel coûteux au moindre écart, le router applique systématiquement le pipeline de repair avant de rejeter.

## `stripMarkdownFences(text): string`

Retire les fences ` ```json `, ` ```JSON `, ` ``` ` au début/fin :

```text
"```json\n{\"a\":1}\n```"  →  "{\"a\":1}"
"```\n[1,2,3]\n```"        →  "[1,2,3]"
"plain text"                →  "plain text"  (no-op)
```

Implémentation : regex `/^```(?:json)?\s*\n?/i` au début, `/\n?\s*```$/` à la fin.

## `parseJsonLenient(text): { ok: true; value: unknown } | { ok: false }`

Algorithme :

```text
1. tenter JSON.parse(text) directement
   → ok ? return { ok:true, value }

2. stripMarkdownFences(text)
   → tenter JSON.parse → ok ? return

3. trouver le premier {
   trouver le dernier } correspondant en équilibrant les accolades
   tenter JSON.parse de ce sous-string
   → ok ? return

4. trouver le premier [
   trouver le dernier ] correspondant
   tenter JSON.parse
   → ok ? return

5. return { ok: false }
```

L'équilibrage tient compte des **strings** (les `{` `}` à l'intérieur de `"..."` sont ignorés) et des **escapes** (`\"` ne ferme pas la string).

## Pipeline complet appliqué par le router

```ts
// Pseudocode router.ts
const content = response.choices[0].message.content;
let repaired = false;

try {
  return JSON.parse(content);
} catch { /* continue */ }

const stripped = stripMarkdownFences(content);
try {
  const result = JSON.parse(stripped);
  repaired = true;
  return result;
} catch { /* continue */ }

const lenient = parseJsonLenient(content);
if (lenient.ok) {
  repaired = true;
  return lenient.value;
}

throw new LLMTransportError(`Failed to parse JSON: ${content.slice(0, 200)}...`);
```

Si `repaired === true`, `counters.repairedCalls++` et la métrique `_meta.repaired: true` est exposée au tool, qui la propage dans sa réponse.

## Cas couverts (tests : [src/__tests__/llm-repair.test.ts](../../src/__tests__/llm-repair.test.ts))

| Input LLM | Output |
|---|---|
| `{"a":1}` | `{a:1}` |
| `` ```json\n{"a":1}\n``` `` | `{a:1}` |
| `` ```\n{"a":1}\n``` `` | `{a:1}` |
| `Voici le JSON: {"a":1}` | `{a:1}` |
| `{"a":1}\nFin.` | `{a:1}` |
| `Voici: {"a":1} et fin.` | `{a:1}` |
| `[1,2,3]` | `[1,2,3]` |
| `Liste : [1,2]` | `[1,2]` |
| `not json at all` | `{ok:false}` |
| `{"unclosed":` | `{ok:false}` |

## Limites connues

- Pas de support des objets multi-niveaux **mal indentés avec virgules trailing** : `{"a":1,}` → fail (JSON ne le permet pas).
- Pas de récupération de strings non-quotées : `{a:1}` → fail.
- Pas de support du YAML / TOML / autre format.

Pour étendre le tolérantisme (ex : virgules trailing), envisager d'utiliser un parser comme [`json5`](https://www.npmjs.com/package/json5) — mais le coût ajouté n'a pas été jugé justifié au moment de l'écriture (tous les modèles testés produisent du JSON propre ≥ 95 % du temps).

## Schéma post-repair

Une fois le JSON récupéré, **chaque tool sémantique** applique encore une **validation Zod** (`ExtractResultSchema`, `ActResultSchema`, `ObserveResultSchema`) avant de l'utiliser :

```ts
const validated = ExtractResultSchema.safeParse(result.json);
if (!validated.success) {
  // Best-effort : on retourne quand même avec confidence basse
  return okResult({
    data: result.json,
    confidence: 0.3,
    notes: "schema validation failed"
  });
}
```

Cette double protection (repair JSON + validation Zod) garantit que **rien ne plante** côté serveur même face à un LLM qui hallucine la structure.
