# Tools — Core (L0, toujours actifs)

Couvre : health, tabs, navigation, sessions, profiles, downloads, presets, youtube.

## Health — [tools/health.ts](../../src/tools/health.ts)

### `server_status`
Vérifie la santé du serveur `camofox-browser` et le compte de tabs trackés.

```ts
schema: {} // pas d'arguments
```

**Retour** :
```jsonc
{
  "ok": true,
  "running": true,
  "browserConnected": true,
  "version": "2.x.x",
  "consecutiveFailures": 0,
  "activeOps": 0,
  "activeTabCount": 3   // côté camofox-mcp
}
```

### `stop_browser`
Demande l'arrêt gracieux du serveur `camofox-browser`. Le serveur redémarrera automatiquement au prochain tool call (auto-start).

```ts
schema: {}
```

**Retour** : `{ ok: true, stopped: true }`.

⚠ Tous les tabs sont invalidés. À utiliser pour les rotations de credentials, déploiements, ou récupération après crash.

---

## Tabs — [tools/tabs.ts](../../src/tools/tabs.ts)

### `create_tab`
Crée un nouveau tab côté browser, tracke-le côté `camofox-mcp`, et **optionnellement** auto-load le profil `_auto_<userId>` s'il existe.

```ts
{
  url: z.string().url().optional(),                  // navigation immédiate
  userId: z.string().min(1).optional(),              // défaut: config.defaultUserId
  preset: z.string().min(1).optional()               // ex: "fr-FR" — geo preset camofox-browser
}
```

**Comportement** :
1. `client.createTab(userId, preset)` → `{ tabId }` côté browser
2. `sessionKey = randomUUID()`
3. **Si `config.autoSave === true`** :
   - tente `loadProfile("_auto_<userId>")` (best-effort, withAutoTimeout 5s)
   - si profil trouvé : `client.importCookies(userId, profile.cookies, tabId)` puis `navigate(profile.metadata.lastUrl)` si pas d'`url` explicite
4. Si `url` fourni : `client.navigate(tabId, url, userId)` (override de l'auto-restore)
5. `trackTab(tabId, userId, sessionKey, finalUrl)`

**Retour** :
```jsonc
{
  "tabId": "<opaque>",
  "sessionKey": "<uuid>",
  "url": "<final url after auto-restore + manual nav>",
  "userId": "<resolved>",
  "autoLoaded": true,            // true si profile auto-loadé
  "autoLoadedProfile": "_auto_<userId>"
}
```

### `close_tab`
Ferme un tab et supprime son tracking. Auto-save vers `_auto_<userId>` si `config.autoSave`.

```ts
{ tabId: z.string().min(1) }
```

**Comportement** :
1. `tracked = getTrackedTab(tabId)` (throw TAB_NOT_FOUND si absent)
2. **Si autoSave** : `exportCookies` + `saveProfile("_auto_<userId>", ...)` (withAutoTimeout 5s, best-effort)
3. `client.closeTab(tabId, tracked.userId)`
4. `removeTrackedTab(tabId)`

**Retour** : `{ closed: true, autoSaved: boolean }`.

### `list_tabs`
Liste les tabs trackés (optionnellement filtrés par `userId`).

```ts
{ userId: z.string().min(1).optional() }
```

**Retour** : `{ count, tabs: TabInfoPublic[] }` (sans `taskHistory`).

---

## Navigation — [tools/navigation.ts](../../src/tools/navigation.ts)

### `navigate`
```ts
{
  tabId: z.string().min(1),
  url: z.string().url()
}
```

`client.navigate` → met à jour `tracked.url` + `visitedUrls`. Pas de re-snapshot automatique.

### `go_back` / `go_forward`
```ts
{ tabId: z.string().min(1) }
```

Effectue la navigation puis **prend automatiquement un snapshot** pour rafraîchir les refs (`refsCount` mis à jour). C'est différent de `navigate` qui n'auto-snapshote pas.

### `refresh`
```ts
{ tabId: z.string().min(1) }
```

Recharge la page. Pas de re-snapshot auto.

---

## Sessions — [tools/session.ts](../../src/tools/session.ts)

### `import_cookies`
Importe des cookies dans la session du `userId` cible.

```ts
{
  userId: z.string().min(1),
  cookies: z.string().min(1),    // JSON string d'un array
  tabId: z.string().optional()    // recommandé pour cibler la bonne session preset
}
```

Le client chunk les imports à **500 cookies par requête** ([client.ts](../../src/client.ts)).

### `get_stats`
```ts
{ tabId: z.string().min(1) }
```

**Retour** :
```jsonc
{
  "visitedUrls": ["url1", "url2", ...],   // cap 50
  "toolCalls": 42,
  "refsCount": 17,
  "sessionKey": "<uuid>",
  "remote": { /* stats côté camofox-browser */ }
}
```

### `camofox_close_session`
Ferme TOUS les tabs d'un userId. Auto-save best-effort si `autoSave`.

```ts
{ tabId: z.string() }   // n'importe quel tab du userId
```

### `toggle_display`
Bascule entre headless/headed/virtual. ⚠ **Tous les tabs du userId sont invalidés** car le contexte browser redémarre.

```ts
{
  userId: z.string().min(1),
  headless: z.union([z.boolean(), z.literal("virtual")])
}
```

**Retour** inclut `vncUrl` quand mode `virtual` (à ouvrir pour debug visuel).

### `set_task_context` / `get_task_context`

Stocke un descripteur de tâche sur le tab (cap 500 chars). Utilisé pour :
- injection de bannière `current_task` dans les snapshots scoped
- héuristiques `diagnose_failure`

```ts
// set_task_context
{ tabId, task: z.string().max(500) }    // task: "" → clear

// get_task_context
{ tabId }
// → { currentTask, lastAction, taskHistory[10], lastSnapshotHash }
```

### `diagnose_failure`
Diagnostic rule-based **sans LLM**. À appeler **après** un click/navigate qui n'a pas eu l'effet escompté, **avant** retry.

```ts
{ tabId: z.string().min(1) }
```

Hints émis :
- `open_dialog (<selector>) — capture it via snapshot_dialog and dismiss before retrying`
- `last click used force fallback but was NOT verified — re-issue with verify:true`
- `standard click chain — if state did not change, re-issue with force:true and verify:true (likely Radix controlled component)`
- `multiple consecutive click attempts on this tab — STOP retrying the same element. Re-snapshot or call snapshot_dialog`
- `no obvious blocker. Take a fresh snapshot with current_task and inspect new_elements (* markers)`

---

## Profiles — [tools/profiles.ts](../../src/tools/profiles.ts)

### `save_profile`
```ts
{
  tabId: z.string().min(1),
  profileId: z.string().min(1),       // regex: /^[a-zA-Z0-9_][a-zA-Z0-9._-]{0,63}$/
  description: z.string().optional()
}
```

Exporte les cookies du tab et écrit `~/.camofox-mcp/profiles/<profileId>.json` (atomic, mode 0o600). Schéma v1 — voir [07-profiles/persistence.md](../07-profiles/persistence.md).

### `load_profile`
```ts
{ profileId: z.string().min(1), tabId: z.string().min(1) }
```

Lit le profil sur disque, importe les cookies dans la session du tab. Si le `profile.userId !== tracked.userId`, un `warning` est inclus dans la réponse.

### `list_profiles`
```ts
schema: {}
```

Retourne `{ profilesDir, count, profiles: ProfileMetadata[] }`.

### `delete_profile`
```ts
{ profileId: z.string().min(1) }
```

`unlink` le fichier. ⚠ Permanent.

---

## Downloads — [tools/downloads.ts](../../src/tools/downloads.ts)

### `list_downloads`
Filtres tous optionnels :

```ts
{
  tabId: optional,        // si fourni, scope au tab ; sinon scope au userId
  userId: optional,
  status: "pending" | "completed" | "failed" | "canceled",
  extension: "pdf,zip,jpg",  // CSV
  mimeType: "image/" | "application/pdf",
  minSize: int, maxSize: int,
  sort: "createdAt:asc" | "createdAt:desc",
  limit: int (default 50),
  offset: int (default 0)
}
```

### `get_download`
```ts
{
  downloadId: z.string().min(1),
  includeContent: z.boolean().default(false),
  userId: z.string().optional()
}
```

**Comportement** :
- Si `mimeType.startsWith("image/")` ET `status === "completed"` ET `size <= 10 MB` (`MAX_INLINE_IMAGE_BYTES`) → renvoie `[text(meta), image(base64)]`
- Sinon image → renvoie `okResult({...meta, note: "..."})` sans contenu inline
- Si `includeContent: true` ET non-image ET `size <= 256 KB` (`MAX_INLINE_NON_IMAGE_BYTES`) → renvoie `{...meta, content: "<base64>"}`
- Sinon → renvoie meta + `note` expliquant pourquoi le contenu est omis

### `delete_download`
```ts
{ downloadId: z.string().min(1), userId: z.string().optional() }
```

Suppression disque + registry côté browser.

---

## Presets — [tools/presets.ts](../../src/tools/presets.ts)

### `list_presets`
Liste les preset **géo** disponibles côté `camofox-browser` (locale + timezone + géolocalisation). Tolère un 404 (browser sans presets) en retournant `count: 0`.

```ts
schema: {}
// → { count, presets: [{ name, locale, timezone, geolocation? }] }
```

---

## YouTube — [tools/youtube.ts](../../src/tools/youtube.ts)

### `youtube_transcript`
Aucun tab requis (le browser side fait l'extraction).

```ts
{
  url: z.string(),
  languages: z.array(z.string()).optional()    // défaut: ["en"]
}
// → { transcript: [{ text, start, duration }, ...] }
```
