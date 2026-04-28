# Tools — Interaction (LEGACY)

Tools de bas niveau pour interagir avec la page. Tous nécessitent un `tabId` (et donc un tab préalablement créé). Activés quand `flags.legacy: true` (profil `full` par défaut).

Fichier : [src/tools/interaction.ts](../../src/tools/interaction.ts) (321 LOC).

## `click` — 5 stratégies en cascade

Le tool central pour interagir. Couvre les boutons HTML, liens, mais aussi les composants Radix / shadcn / headless-ui qui résistent au clic standard.

```ts
{
  tabId: z.string().min(1),
  ref: z.string().optional(),                          // ref ARIA depuis snapshot
  selector: z.string().optional(),                     // CSS fallback
  // Au moins ref OU selector requis (refine).
  description: z.string().optional(),                  // pour task history

  strategy: z.enum(["locator", "force", "mouse", "jsdispatch", "keyboard-space"]).optional(),
  retries: z.number().int().min(0).max(5).default(3),
  verify: z.boolean().default(false),                  // attend un changement DOM/state
  pre_wait_ms: z.number().int().min(0).max(5000).optional(),
  post_wait_ms: z.number().int().min(0).max(5000).optional()
}
```

### Les 5 stratégies

| Stratégie | Mécanisme | Utilité |
|---|---|---|
| `locator` (défaut) | `page.locator(...).click()` Playwright standard | 99 % des cas. Auto-scroll, auto-wait actionability. |
| `force` | `locator.click({ force: true })` | Bypass actionability checks. Pour éléments couverts/disabled visuellement mais cliquables. |
| `mouse` | `page.mouse.click(x, y)` après `boundingBox()` | Bypass de tout le système de locator. Utile quand le ref est correct mais l'élément n'est pas "interactable" Playwright. |
| `jsdispatch` | `el.dispatchEvent(new MouseEvent("click", {bubbles:true}))` | Ignore les pointer-events:none, overlays. Mais ne déclenche pas tous les handlers React/Vue. |
| `keyboard-space` | `el.focus()` + `keyboard.press("Space")` | Pour les boutons custom (`role="button"` non-button HTML) qui répondent à Space mais pas au click programmatique. Particulièrement efficace sur Radix Switch/Checkbox. |

### Cascade automatique

Si `strategy` non fournie, le tool tente automatiquement la séquence :

```text
locator → (échec) → force → (échec) → mouse → (échec) → jsdispatch → (échec) → keyboard-space
```

Le mode `verify: true` attend après chaque tentative un changement (URL, hash, refsCount, ou texte cible) avant de considérer la tentative réussie. Si rien ne change, on passe à la stratégie suivante.

### Réponse

```jsonc
{
  "clicked": true,
  "strategy": "locator",        // celle qui a réussi
  "verified": true,             // si verify=true et changement constaté
  "retries_used": 0,
  "description": "..."          // tel que fourni
}
```

`recordTabAction()` enregistre `"click <ref/selector> (strategy)<verified|>"` dans `taskHistory` — c'est ce que `diagnose_failure` analyse pour ses heuristiques.

## `type_text`

```ts
{
  tabId, ref?, selector?, text: z.string()
}
```

**Comportement** : `client.smartTypeText(...)`.

`smartTypeText` ([client.ts](../../src/client.ts)) :
- Si `text.length <= LONG_TEXT_THRESHOLD (400)` → `client.typeText` standard (Playwright `keyboard.type`)
- Sinon → fallback `evaluate()` qui assigne `el.value = text` directement (rapide, mais ne déclenche pas les events `input` / `change` sauf trigger manuel par le browser side)

⚠ Le fallback long-text **nécessite `CAMOFOX_API_KEY`** car il passe par `evaluate`.

## `scroll`

```ts
{
  tabId,
  direction: z.enum(["up", "down", "left", "right"]),
  amount: z.number().positive().default(500)
}
```

Scroll la fenêtre de `amount` pixels.

## `camofox_scroll_element`

Scroll un élément spécifique (utile pour les listes virtualisées, modales internes).

```ts
{
  tabId, ref?, selector?,
  deltaX: z.number().optional(),
  deltaY: z.number().optional(),
  scrollTo: z.object({ top: z.number().optional(), left: z.number().optional() }).optional()
}
// → { ok, scrollPosition: {scrollTop, scrollLeft, scrollHeight, clientHeight, scrollWidth, clientWidth} }
```

Mode delta (`deltaX/Y`) **ou** mode absolu (`scrollTo`).

## `camofox_evaluate_js`

```ts
{
  tabId,
  expression: z.string().min(1),                      // JS code à eval
  timeout: z.number().int().min(100).max(30000).optional()  // défaut 5000
}
// → { ok, result, resultType, truncated, error?, errorType? }
```

⚠ **Requiert `CAMOFOX_API_KEY`**. Surface RCE — voir [09-operations/security.md](../09-operations/security.md).

Truncation auto si la sérialisation du résultat dépasse une limite côté browser (~8 KB).

## `camofox_hover`

```ts
{ tabId, ref?, selector? }
```

Déclenche `mouseenter` + `mouseover`. Utile pour les tooltips, menus contextuels, dropdowns "hover".

## `camofox_wait_for`

```ts
{
  tabId,
  state: z.enum(["domcontentloaded", "networkidle", "load"]).optional(),
  timeout: z.number().optional()                      // défaut 10000
}
```

Attend un état de chargement de la page. Distinct de `wait_for_selector` (DOM-element) et `wait_for_text` (présence de texte).

## `camofox_press_key`

```ts
{ tabId, key: z.string().min(1) }
```

Envoie une touche au focus actuel. Format Playwright : `"Enter"`, `"Tab"`, `"Escape"`, `"ArrowDown"`, `"Control+c"`, `"Shift+Tab"`, etc.

Cas d'usage typiques :
- Soumettre un formulaire (`Enter`)
- Naviguer dans un autocomplete (`ArrowDown`, `Enter`)
- Fermer une modale (`Escape`)
- Sélectionner tout (`Control+a`)

## Bonnes pratiques d'enchaînement

```text
1. snapshot()                             → identifier le ref e<N>
2. click(ref:"e5")                        → tentative locator
3. (si échec apparent) diagnose_failure() → hint "Radix → force+verify"
4. click(ref:"e5", strategy:"force", verify:true)
5. snapshot()                             → confirmer le changement (refsCount, new_elements)
```

Le combo `verify: true` + cascade auto + `diagnose_failure` couvre la majorité des sites SPA modernes sans avoir à recourir à `evaluate_js` ou `query_selector`.
