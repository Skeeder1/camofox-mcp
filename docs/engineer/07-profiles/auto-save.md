# Auto-save / auto-load

Le serveur supporte un mécanisme **automatique** de persistance de session par `userId` via le profil dédié `_auto_<userId>`. Activé par défaut (`CAMOFOX_AUTO_SAVE=true`).

## Préfixe `_auto_`

Convention : pour tout `userId`, le profil auto correspondant est `_auto_<userId>`. Le préfixe `_` est validé par la regex `PROFILE_ID_REGEX` qui accepte les IDs commençant par `_`. Aucun namespace séparé sur disque — c'est juste un fichier `.json` ordinaire dans `~/.camofox-mcp/profiles/`.

```
~/.camofox-mcp/profiles/
├── _auto_default.json          ← auto pour userId "default"
├── _auto_agent-1.json          ← auto pour userId "agent-1"
├── linkedin-prod.json          ← profil utilisateur explicite
└── github-personal.json
```

## Hook 1 : `create_tab` → auto-load

[tools/tabs.ts](../../src/tools/tabs.ts) :

```ts
async (input) => {
  const parsed = ...;
  const userId = parsed.userId ?? deps.config.defaultUserId;
  const tabResp = await deps.client.createTab(userId, parsed.preset);
  const tabId = tabResp.tabId;
  const sessionKey = randomUUID();

  let autoLoaded = false;
  let autoLoadedProfile: string | undefined;
  let restoredUrl: string | undefined;

  if (deps.config.autoSave) {
    const autoProfileId = `_auto_${userId}`;
    const r = await withAutoTimeout(
      (async () => {
        try {
          const profile = await loadProfile(deps.config.profilesDir, autoProfileId);
          await deps.client.importCookies(userId, profile.cookies, tabId);
          return { profileId: profile.profileId, lastUrl: profile.metadata.lastUrl };
        } catch (err) {
          // PROFILE_NOT_FOUND est attendu pour les nouveaux userIds → silencieux
          return null;
        }
      })(),
      AUTO_PROFILE_TIMEOUT_MS  // 5_000
    );
    if (r.ok && r.value) {
      autoLoaded = true;
      autoLoadedProfile = r.value.profileId;
      restoredUrl = r.value.lastUrl ?? undefined;
    }
  }

  // Si url fourni explicitement OU si on a une lastUrl à restaurer
  const target = parsed.url ?? restoredUrl;
  if (target) await deps.client.navigate(tabId, target, userId);

  trackTab(tabId, userId, sessionKey, target ?? "about:blank");
  return okResult({ tabId, sessionKey, url: target ?? "about:blank", userId, autoLoaded, autoLoadedProfile });
}
```

**Cas d'erreur** :
- Profil absent (premier `create_tab` pour ce `userId`) → `PROFILE_NOT_FOUND` capturé, on continue normalement
- `loadProfile` corrompu → erreur capturée, on continue
- Timeout 5s → on continue (l'auto-load est best-effort)
- `importCookies` échoue → log seulement (à confirmer côté code), on continue

## Hook 2 : `close_tab` → auto-save

```ts
async (input) => {
  const tracked = getTrackedTab(parsed.tabId);
  let autoSaved = false;

  if (deps.config.autoSave) {
    const r = await withAutoTimeout(
      (async () => {
        const cookies = await deps.client.exportCookies(parsed.tabId, tracked.userId);
        if (cookies.length === 0) return false;
        const autoProfileId = `_auto_${tracked.userId}`;
        await saveProfile(deps.config.profilesDir, autoProfileId, tracked.userId, cookies, {
          description: "Auto-saved session",
          lastUrl: tracked.url
        });
        return true;
      })(),
      AUTO_PROFILE_TIMEOUT_MS  // 5_000
    );
    autoSaved = r.ok ? r.value : false;
  }

  await deps.client.closeTab(parsed.tabId, tracked.userId);
  removeTrackedTab(parsed.tabId);
  return okResult({ closed: true, autoSaved });
}
```

## Hook 3 : `camofox_close_session` → auto-save (multi-tabs)

Quand on ferme toute la session d'un userId (donc plusieurs tabs), l'auto-save n'est exécuté **qu'une fois** sur le premier tab disponible :

```ts
const allTabs = getAllTrackedTabs().filter(t => t.userId === tracked.userId);
const tabForExport = allTabs.find(t => t.tabId === parsed.tabId) ?? allTabs[0];
const cookies = await deps.client.exportCookies(tabForExport.tabId, tracked.userId);
if (cookies.length > 0) {
  await saveProfile(profilesDir, `_auto_${tracked.userId}`, tracked.userId, cookies, {
    description: "Auto-saved session",
    lastUrl: tabForExport.url
  });
}
```

C'est suffisant car les cookies sont **partagés au niveau userId** côté `camofox-browser` (pas par tab). Exporter d'un seul tab est canonique.

## Désactivation

```bash
export CAMOFOX_AUTO_SAVE=false
# ou
camofox-mcp --auto-save false
```

Quand désactivé :
- `create_tab` ne tente pas de loader
- `close_tab` / `close_session` ne tente pas de saver
- L'utilisateur doit gérer manuellement via `save_profile` / `load_profile`

## Garanties d'auto-save

✅ **Garantie** :
- L'auto-save est appelé sur un `close_tab` réussi
- En cas de timeout / erreur du save, le `close_tab` réussit quand même (best-effort)
- Atomic write — pas de profil corrompu après crash mid-save

❌ **Non garanti** :
- Auto-save **n'est PAS** déclenché si le process crash sans appeler `close_tab`
- Auto-save **n'est PAS** déclenché par le sweep TTL (les tabs expirés ne sauvent pas leurs cookies)
- Auto-save sur SIGINT/SIGTERM **n'est PAS** explicite — `gracefulShutdown` appelle `closeTab` mais pas le tool wrapper avec auto-save. Les profils ne sont donc **pas garantis sauvés** au shutdown gracieux.

⚠ **Conséquence** : pour un long-running agent, déclencher des `close_tab` périodiques explicites pour matérialiser l'état si une session vit plusieurs heures.

## Multi-userId

Chaque userId a son propre `_auto_<userId>.json`. Pas de collision possible entre agents distincts qui partagent la même installation.

## Limites

- Pas de versionnement / history des saves auto. Chaque save écrase le précédent.
- Pas de purge auto des profils expirés. Si un cookie a expiré, il sera quand même réimporté à la prochaine session — il faudra que le browser le rejette (cookies avec `expires` past).
- Le `lastUrl` est restauré aveuglément. Pour des sites avec des URLs de session courte (`?ts=...`, tokens à usage unique), envisager `description` + URL canonique manuelle plutôt que de se fier à l'auto-restore.
