# Persistance des profils

Module : [`src/profiles.ts`](../../src/profiles.ts) (~275 LOC). Gère l'écriture/lecture atomique de fichiers JSON contenant les cookies et métadonnées d'une session.

## Format de fichier — schema v1

```ts
const ProfileSchema = z.object({
  version: z.literal(1),
  profileId: z.string(),
  userId: z.string(),
  cookies: z.array(ProfileCookieSchema),       // .passthrough() — accepte champs additionnels
  metadata: z.object({
    createdAt: z.string(),                     // ISO 8601
    updatedAt: z.string(),                     // ISO 8601
    lastUrl: z.string().optional().nullable(),
    description: z.string().optional().nullable(),
    cookieCount: z.number()
  })
});

const ProfileCookieSchema = z.object({
  name: z.string(),
  value: z.string(),
  domain: z.string(),
  path: z.string(),
  expires: z.number().optional(),
  httpOnly: z.boolean().optional(),
  secure: z.boolean().optional(),
  sameSite: z.string().optional()
}).passthrough();
```

### Exemple

```json
{
  "version": 1,
  "profileId": "linkedin-prod",
  "userId": "agent-1",
  "cookies": [
    { "name": "li_at", "value": "...", "domain": ".linkedin.com", "path": "/", "secure": true, "httpOnly": true },
    { "name": "JSESSIONID", "value": "...", "domain": ".linkedin.com", "path": "/", "secure": true }
  ],
  "metadata": {
    "createdAt": "2025-11-01T10:00:00.000Z",
    "updatedAt": "2025-11-22T14:30:00.000Z",
    "lastUrl": "https://www.linkedin.com/feed/",
    "description": "LinkedIn Sales Nav, refreshed 2025-11-22",
    "cookieCount": 2
  }
}
```

## Validation `profileId`

```ts
const PROFILE_ID_REGEX = /^[a-zA-Z0-9_][a-zA-Z0-9._-]{0,63}$/;

export function validateProfileId(profileId: string): void {
  if (!PROFILE_ID_REGEX.test(profileId)) {
    throw new AppError(
      "VALIDATION_ERROR",
      `Invalid profile ID "${profileId}". Use 1-64 chars: letters, numbers, dots, hyphens, underscores. Must start with alphanumeric or underscore.`
    );
  }
}
```

**Pourquoi ces contraintes ?**
- Évite les `path traversal` (`../`, `/etc/passwd`)
- Evite les caractères qui casseraient le file system (Windows : `<>:"|?*`)
- Le `_auto_<userId>` a son préfixe `_` accepté grâce au début `[a-zA-Z0-9_]`

## Permissions disque

```ts
export async function ensureProfilesDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);                                       // re-chmod si déjà existant
}

// Écriture du fichier profil
await writeFile(tmpPath, data, { encoding: "utf-8", mode: 0o600 });
```

- **Dossier** : `0o700` (rwx pour le user uniquement)
- **Fichier** : `0o600` (rw pour le user uniquement)

Crucial car les cookies stockés équivalent à des credentials authentifiés.

## Écriture atomique

```ts
export async function saveProfile(dir, profileId, userId, cookies, options) {
  validateProfileId(profileId);
  await ensureProfilesDir(dir);

  // Validate cookies via Zod (passthrough sur champs extra)
  const cookiesParsed = z.array(ProfileCookieSchema).safeParse(cookies);
  if (!cookiesParsed.success) throw new AppError("PROFILE_ERROR", ...);

  const filePath = profilePath(dir, profileId);

  // Mutex per-path → évite races sur saves concurrents
  return await getSaveProfileMutex(filePath).runExclusive(async () => {
    const tmpPath = `${filePath}.tmp`;

    // Préserver createdAt si profil pré-existant
    let createdAt = new Date().toISOString();
    try {
      const existing = await loadProfile(dir, profileId);
      createdAt = existing.metadata.createdAt;
    } catch { /* nouveau ou corrompu */ }

    const profile: Profile = {
      version: 1,
      profileId, userId,
      cookies: cookiesParsed.data,
      metadata: {
        createdAt,
        updatedAt: new Date().toISOString(),
        lastUrl: options?.lastUrl,
        description: options?.description,
        cookieCount: cookiesParsed.data.length
      }
    };

    // Atomic write: tmp → rename
    const data = JSON.stringify(profile, null, 2);
    await writeFile(tmpPath, data, { encoding: "utf-8", mode: 0o600 });
    await rename(tmpPath, filePath);

    return profile;
  });
}
```

**Garanties** :
1. **Atomicité** : `rename()` est atomique sur la même partition. Le fichier final n'est jamais visible dans un état partiel.
2. **Pas de race** : `Mutex` par chemin. Deux saves concurrents sur le **même** profil sont sérialisés.
3. **Saves sur profils différents en parallèle** : OK (mutex distincts).
4. **`createdAt` préservé** sur overwrite. Seul `updatedAt` change.

## Mutex implémentation

Map globale `Map<filePath, Mutex>` ([profiles.ts](../../src/profiles.ts)).

```ts
class Mutex {
  private locked = false;
  private readonly waiters: Array<() => void> = [];

  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try { return await fn(); }
    finally { this.release(); }
  }
  // ...
}

const saveProfileMutexByPath = new Map<string, Mutex>();
function getSaveProfileMutex(filePath: string): Mutex { /* lazy create */ }
```

⚠ **Pas de cleanup** : un mutex n'est pas remové après un save. C'est OK car la map ne croît qu'avec le nombre de profils distincts (borné par l'utilisation réelle).

## Lecture

```ts
export async function loadProfile(dir, profileId): Promise<Profile> {
  validateProfileId(profileId);
  const filePath = profilePath(dir, profileId);

  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch (error) {
    if (error.code === "ENOENT") throw new AppError("PROFILE_NOT_FOUND", ...);
    throw new AppError("PROFILE_ERROR", `Failed to read profile: ${error.message}`);
  }

  // Parse + Zod validate
  const parsed = ProfileSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) throw new AppError("PROFILE_ERROR", ...);
  return parsed.data;
}
```

## `withAutoTimeout<T>(promise, ms)`

Helper utilisé par tous les flows auto-save/auto-load :

```ts
export type AutoResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "timeout" }
  | { ok: false; reason: "error"; error: unknown };

export async function withAutoTimeout<T>(promise: Promise<T>, ms: number): Promise<AutoResult<T>>;
```

**Garantie** : le `setTimeout` est toujours `clearTimeout`-é dans un `finally` → pas de timer dangling.

Usage typique :

```ts
const r = await withAutoTimeout(saveProfile(...), 5000);
if (!r.ok) {
  // r.reason === "timeout" ou "error"
  // best-effort : on log et on continue
} else {
  // r.value disponible
}
```

## Listing

```ts
export async function listProfiles(dir): Promise<ProfileMetadata[]> {
  await ensureProfilesDir(dir);
  const files = await readdir(dir);
  const profiles = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const profile = await loadProfile(dir, file.slice(0, -5));
      profiles.push({
        profileId: profile.profileId,
        userId: profile.userId,
        ...profile.metadata
      });
    } catch { /* skip corrompu */ }
  }
  return profiles;
}
```

Les profils corrompus sont **silencieusement ignorés** dans le listing — pas d'arrêt sur premier fail.

## Suppression

```ts
export async function deleteProfile(dir, profileId): Promise<void> {
  validateProfileId(profileId);
  try {
    await unlink(profilePath(dir, profileId));
  } catch (error) {
    if (error.code === "ENOENT") throw new AppError("PROFILE_NOT_FOUND", ...);
    throw new AppError("PROFILE_ERROR", ...);
  }
}
```

⚠ Pas de soft-delete, pas de recyclage. La suppression est permanente.
