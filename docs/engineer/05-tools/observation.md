# Tools — Observation (LEGACY)

Tools de lecture / inspection de la page. Fichier : [src/tools/observation.ts](../../src/tools/observation.ts) (441 LOC).

## `snapshot` — la primitive centrale

C'est le tool le plus utilisé. Retourne l'arbre d'accessibilité (ARIA tree) de la page sous forme YAML, avec des refs `e1`, `e2`, … qui peuvent être passés à `click`, `type_text`, etc.

```ts
{
  tabId: z.string().min(1),
  offset: z.number().optional(),                       // pagination
  focus_selector: z.string().min(1).optional(),        // scope sub-tree
  max_lines: z.number().int().min(10).max(5000).optional(),
  roles_filter: z.array(z.string()).optional(),        // ["button","checkbox",...]
  current_task: z.string().max(200).optional(),        // banner injection
  last_action: z.string().max(200).optional()
}
```

### Modes

#### Mode plein (sans scope)

```text
GET /tabs/<tabId>/snapshot?userId=...&offset=<N>
```

Retourne tout l'arbre. **Pagination** via `offset` quand `hasMore: true`. Le serveur propage `nextOffset` dans la réponse.

#### Mode scoped (avec `focus_selector`)

```text
POST /tabs/<tabId>/snapshot
body: { userId, focusSelector, maxLines, rolesFilter, currentTask, lastAction }
```

Retourne uniquement le sous-arbre du sélecteur. Idéal pour focus sur un dialogue, une carte, un formulaire spécifique. **Ignore `offset`**.

### Bannières task / action

Quand `current_task` ou `last_action` sont fournis, le YAML retourné est préfixé :

```yaml
yaml-banner:
  task: "apply LeBonCoin filters: Renault, 2018-2022"
  last_action: "clicked filter button (force)"
---
<arbre ARIA normal>
```

Cela aide le LLM consommateur à rester focus sur l'objectif quand il reçoit le snapshot dans son contexte.

### `roles_filter`

Garde uniquement les nœuds dont le `role` correspond à un des rôles demandés. **Les ancêtres sont préservés** pour conserver la hiérarchie. Exemples utiles :

```ts
roles_filter: ["button", "link"]                       // navigation seulement
roles_filter: ["textbox", "combobox", "button"]        // remplir un formulaire
roles_filter: ["dialog", "alertdialog"]                // capturer une modale
```

### Réponse

```jsonc
{
  "url": "...",
  "snapshot": "<YAML>",
  "refsCount": 42,
  "truncated": false,
  "totalChars": 12345,
  "hasMore": false,
  "nextOffset": null,
  "scoped": false,
  "newElementsCount": 3                                // refs marqués "*" car nouveaux depuis le dernier snapshot
}
```

Les **`newElementsCount`** correspondent aux refs marqués `*` dans le YAML — c'est ce qui a changé depuis le dernier snapshot pris sur ce tab. Implémenté via `lastSnapshotHash` côté state.

## `snapshot_dialog`

Variante dédiée aux modales. Cherche `[role="dialog"][data-state="open"]`, `[role="alertdialog"][data-state="open"]`, etc. (Radix-aware).

```ts
{ tabId: z.string().min(1) }
// → {
//   url, snapshot: <YAML> | null, refsCount,
//   selector: "[role=dialog][data-state=open]",
//   dialogVisible: boolean
// }
```

Si aucun dialogue ouvert, `snapshot: null` + `dialogVisible: false` (pas une erreur — appelable spéculativement).

## `camofox_get_page_html`

Récupère le HTML rendu (post-hydration). À utiliser quand les refs ARIA ne sont pas suffisants (SPA avec custom components qui n'exposent pas leur rôle).

```ts
{
  tabId: z.string().min(1),
  selector: z.string().min(1).optional()              // outerHTML d'un seul élément si fourni
}
// → { html: "<...>" }
```

⚠ **Requiert `CAMOFOX_API_KEY`** (passe par `evaluate`).

## `camofox_query_selector`

Inspection ciblée du DOM live.

```ts
{
  tabId, selector,
  attribute: z.string().min(1).optional()             // si fourni, retourne juste cet attribut
}
```

Sans `attribute` :
```jsonc
{
  "tagName": "BUTTON",
  "id": "submit-btn",
  "className": "btn btn-primary",
  "text": "Envoyer",
  "rect": { "x": 100, "y": 200, "width": 80, "height": 32 },
  "visible": true,
  "attributes": { "data-state": "ready" }
}
```

Avec `attribute: "data-state"` → `"ready"`.

⚠ Requiert `CAMOFOX_API_KEY`.

## `screenshot`

```ts
{
  tabId,
  fullPage: z.boolean().optional(),                   // défaut false (viewport)
  type: z.enum(["png", "jpeg"]).optional(),           // défaut png
  quality: z.number().int().min(1).max(100).optional(),  // jpeg seulement
  clip: z.object({
    x: z.number().min(0),
    y: z.number().min(0),
    width: z.number().positive(),
    height: z.number().positive()
  }).optional()
}
```

Réponse : `imageResult(base64)` ou `binaryResult(base64, "image/jpeg")` selon le type.

### Vision-cost reduction

Pour les agents qui consomment du vision token :
- Préférer **`type: "jpeg" + quality: 60`** (~ 5× plus petit que PNG)
- **Mieux : `clip` sur la zone d'intérêt** — les coordonnées viennent du `rect` retourné par `query_selector` ou par les bounding boxes du snapshot.

```ts
// Exemple : screenshot d'un seul bouton
const el = await query_selector({ tabId, selector: "#submit" });
const ss = await screenshot({ tabId, type: "jpeg", quality: 70, clip: el.rect });
```

## `get_links`

```ts
{
  tabId,
  scope: z.string().min(1).optional(),                // CSS selector du conteneur
  extension: z.string().min(1).optional(),            // "pdf,zip" CSV
  downloadOnly: z.boolean().optional()                // que les <a download>
}
// → [{ text, href }, ...]
```

Utile pour la découverte de navigation, le mapping de site, l'extraction de liens téléchargeables.

## `camofox_wait_for_text`

Polling de la présence d'un texte sur la page (cherche dans le snapshot, pas dans le DOM brut).

```ts
{
  tabId,
  text: z.string(),
  timeout: z.number().optional()                      // défaut 10000
}
```

Implémentation : poll `snapshot()` toutes les **500 ms** jusqu'à `timeout`, retourne dès que `snapshot.toLowerCase().includes(text.toLowerCase())`.

## `camofox_wait_for_selector`

Attend qu'un sélecteur CSS soit présent dans le DOM live. Pour les SPA dont l'hydration tarde.

```ts
{
  tabId,
  selector: z.string().min(1),
  timeout: z.number().int().positive().default(10000)
}
```

Implémentation : poll `evaluate("document.querySelector(...) !== null")` toutes les 500 ms jusqu'à `timeout`. ⚠ Requiert `CAMOFOX_API_KEY`.

Une fois le sélecteur trouvé, **préférer les refs ARIA** pour l'interaction si disponibles (re-snapshot d'abord) — les sélecteurs CSS sont moins stables.

## Stratégie d'enchaînement recommandée

```text
1. navigate(url)
2. (attendre l'hydration si nécessaire) wait_for_selector(".main-content")
3. snapshot(current_task: "...")
   → identifier les refs pertinents
4. (si SPA suspecte) get_page_html() pour vérifier la structure réelle
5. (si modale apparue) snapshot_dialog()
6. interaction (click, type_text, ...)
7. snapshot()
   → vérifier newElementsCount et refsCount
```
