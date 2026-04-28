# Tools — Batch / Search / Extraction (LEGACY)

Workflows multi-étapes regroupés en un seul tool call pour réduire le nombre de round-trips MCP.

Fichiers :
- [tools/batch.ts](../../src/tools/batch.ts) (348 LOC)
- [tools/search.ts](../../src/tools/search.ts) (64 LOC)
- [tools/extraction.ts](../../src/tools/extraction.ts) (161 LOC)

---

## Batch — [tools/batch.ts](../../src/tools/batch.ts)

### `fill_form`
Remplit plusieurs champs en un appel. Optionnellement clique un bouton submit après.

```ts
{
  tabId,
  fields: z.array(z.object({
    ref: z.string().optional(),
    selector: z.string().optional(),
    text: z.string()
  })).min(1).max(20),
  submit: z.object({
    ref: z.string().optional(),
    selector: z.string().optional()
  }).optional()
}
```

**Comportement** :
- Itère séquentiellement (`smartTypeText` pour chaque champ)
- Si un champ échoue : **abort** immédiat, retourne `success: false` avec les champs traités
- Après le dernier champ, si `submit` fourni : `client.click(submit)` puis `submitted: true`

**Réponse** :
```jsonc
{
  "success": true,
  "filled": 3,
  "total": 3,
  "results": [
    { "index": 0, "ref": "e5", "success": true },
    { "index": 1, "selector": "input[name=email]", "success": true },
    { "index": 2, "ref": "e10", "success": true }
  ],
  "submitted": true
}
```

### `type_and_submit`
Tape un texte et appuie sur une touche (défaut Enter). Pour les barres de recherche.

```ts
{
  tabId,
  ref?, selector?, text: z.string(),
  key: z.string().min(1).default("Enter")
}
// → { typed: true, keyPressed: "Enter" }
```

### `navigate_and_snapshot`
`navigate` + `waitForReady` + (optionnel) `waitForText` + `snapshot` en un seul tool call.

```ts
{
  tabId, url: z.string().url(),
  waitForText: z.string().optional(),
  timeout: z.number().positive().default(10000)
}
// → { url, title, snapshot, refsCount }
```

Économise 2-3 round-trips MCP par rapport à la séquence manuelle.

### `scroll_and_snapshot`
Scroll + délai + snapshot. Utile pour révéler du contenu lazy-loaded.

```ts
{
  tabId,
  direction: z.enum(["up", "down"]),
  amount: z.number().positive().default(500),
  waitMs: z.number().nonnegative().default(500)        // défaut 500ms d'attente après scroll
}
```

---

## Search — [tools/search.ts](../../src/tools/search.ts)

### `web_search`
Recherche via 14 moteurs supportés par `camofox-browser` (macros `@<engine>_search`).

```ts
{
  tabId,
  query: z.string().min(1),
  engine: z.enum([
    "google", "youtube", "amazon", "bing", "duckduckgo",
    "reddit", "github", "stackoverflow", "wikipedia",
    "twitter", "linkedin", "facebook", "instagram", "tiktok"
  ]).optional()                                         // défaut "google"
}
```

**Comportement** :
1. `client.navigateMacro(tabId, "@<engine>_search", query, userId)` — la macro côté browser construit l'URL appropriée et navigue
2. `client.snapshot(tabId, userId)` — capture les résultats inline

**Réponse** :
```jsonc
{ "url": "https://www.google.com/search?q=...", "snapshot": "<YAML ARIA>" }
```

Pour parser les résultats structurés, enchaîner avec `extract` ou faire un parsing CSS via `query_selector`.

---

## Extraction — [tools/extraction.ts](../../src/tools/extraction.ts)

Extraction de ressources (images, liens, médias, documents) depuis un conteneur DOM précis.

### `extract_resources`

```ts
{
  tabId,
  userId: z.string().optional(),
  selector: z.string().optional(),         // CSS du conteneur, ex: ".message:nth-child(3)"
  ref: z.string().optional(),              // OU ref ARIA depuis snapshot
  // refine: au moins selector OU ref

  types: z.array(z.enum([
    "images", "links", "media", "documents",
    "image", "link", "document"            // singuliers acceptés (back-compat)
  ])).optional(),                          // défaut: tous

  extensions: z.array(z.string()).optional(),  // ["pdf", "jpg", "png"]
  resolveBlobs: z.boolean().default(false),    // résoudre blob: → data:
  triggerLazyLoad: z.boolean().default(false), // scroll auto pour révéler les lazy
  maxDepth: z.number().int().positive().default(5)
}
```

**Réponse** : objet `{ images: [...], links: [...], media: [...], documents: [...] }` avec URLs et métadonnées (taille, mimeType, alt, etc. — dépend du browser).

### `batch_download`
`extract_resources` + téléchargement de toutes les ressources extraites.

```ts
{
  tabId, userId?, selector?, ref?,
  types?, extensions?,
  resolveBlobs: z.boolean().default(true),
  concurrency: z.number().int().positive().default(5),
  maxFiles: z.number().int().positive().default(50)
}
```

Les fichiers sont enregistrés dans le download manager du browser → consultables via `list_downloads` / `get_download` ([core.md#downloads](core.md#downloads--toolsdownloadsts)).

### `resolve_blobs`
Convertit des `blob:` URLs (objets browser temporaires : Telegram Web, WhatsApp Web, Discord, etc.) en data URIs base64 téléchargeables.

```ts
{
  tabId, userId?,
  urls: z.array(z.string().min(1)).min(1)
}
// → { resolved: [{ url, dataUri, mimeType, size }, ...] }
```

Indispensable pour scraper les médias des chats web qui n'utilisent que des blobs.

---

## Pipeline d'extraction typique

```text
1. snapshot(focus_selector: ".chat-messages")
2. (optionnel) extract avec schéma JSON pour récupérer les métadonnées
3. extract_resources(selector: ".message:nth-child(N)", types: ["images"], resolveBlobs: true)
4. batch_download(...)  OU  resolve_blobs(...) si tu as déjà les URLs
5. list_downloads(extension: "jpg", sort: "createdAt:desc")
6. get_download(downloadId)  → image rendered or base64
```

## Performance & limites

| Tool | Coût | Notes |
|---|---|---|
| `fill_form` | 1 + N round-trips browser (1 par champ) | OK pour < 20 champs |
| `navigate_and_snapshot` | 3 round-trips | OK si `timeout` ajusté |
| `extract_resources` | 1 round-trip | Dépend de la taille du conteneur |
| `batch_download` | 1 + concurrency sur N fichiers | Préfère `concurrency: 5-10` |
| `web_search` | 2 round-trips (navigate macro + snapshot) | Moteurs avec captcha → fallback `toggle_display` |

Pour les workflows qui dépassent ce que les batch tools couvrent, utiliser **`execute`** ([semantic.md#execute](semantic.md#execute)) qui permet une séquence typée arbitraire.
