# Sécurité

`camofox-mcp` est un serveur **non authentifié par défaut** dont la surface RCE est non triviale (`evaluate_js`). Cette section documente les considérations à prendre.

## Threat model

| Acteur | Vecteur | Impact |
|---|---|---|
| Voisin local | Bind `0.0.0.0:3000` sans firewall | RCE via `evaluate_js`, exfiltration cookies |
| Attaquant réseau | API exposée sur Internet | RCE, vol de session bancaires/sociales/pro stockées dans profils |
| Code dans la page | `evaluate_js("document.cookie")` non scopé | Vol de cookies cross-domain (le browser est partagé par userId) |
| Process local non-trusté | Lecture `~/.camofox-mcp/profiles/` | Vol direct des cookies sérialisés |

## Hardening recommandé

### 1. Bind sur loopback uniquement

Par défaut, le serveur HTTP bind `0.0.0.0:3000`. **À changer** :

```bash
camofox-mcp --http --port 3000 --host 127.0.0.1
```

Côté code : [src/server.ts](../../src/server.ts) crée le `httpServer.listen(port, host)` avec le `host` du config. Vérifier que le déploiement fournit bien `127.0.0.1` ou `::1`.

### 2. Reverse proxy avec authentification

Pour tout déploiement multi-tenant ou exposé Internet :

```nginx
server {
  listen 443 ssl;
  server_name camofox.example.com;

  ssl_certificate     ...;
  ssl_certificate_key ...;

  location / {
    auth_request /auth;                 # délégué à un service JWT/OAuth
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
  }

  location = /auth {
    internal;
    proxy_pass http://auth-service/verify;
  }
}
```

`camofox-mcp` reste sur loopback. **Le proxy fait l'authn / authz**.

### 3. Rate-limit applicatif

Par défaut **60 req/min/IP** (`CAMOFOX_RATE_LIMIT_MAX=60`). À durcir selon le throughput attendu :

```bash
export CAMOFOX_RATE_LIMIT_MAX=120
export CAMOFOX_RATE_LIMIT_WINDOW=60000   # 1min
```

⚠ Le rate-limit s'applique **par IP** (cf. [src/http.ts](../../src/http.ts)) — derrière un reverse proxy, il faut utiliser un autre mécanisme (rate-limit du proxy lui-même).

### 4. Permissions disque

`camofox-mcp` impose `0o600` sur les profils et `0o700` sur le dossier. Pour vérifier :

```bash
ls -la ~/.camofox-mcp/
# drwx------  2 user user    profiles
# -rw-------  1 user user    profiles/_auto_default.json
```

Si `umask` du processus parent est trop permissive, les modes peuvent être réinforcés mais **`chmod` n'est pas atomique avec la création** sur certains FS — l'implémentation fait un `mkdir + chmod 0o700` séparé.

### 5. Désactiver `evaluate_js` quand inutile

Le tool `camofox_evaluate_js` est la principale surface RCE. Si tu n'en as pas besoin :

```bash
export CAMOFOX_LAYER_LEGACY=false   # désactive tous les tools L_LEGACY (dont evaluate_js)
# Ou plus précisément :
camofox-mcp --layer lean            # ne charge que L0 + L1 sémantique
```

`evaluate_js` ne fait pas partie de `lean` ni de `semantic`. Profil `full` (défaut) l'inclut.

### 6. Restriction côté `camofox-browser`

Si `camofox-browser` est lancé avec `CAMOFOX_API_KEY=...` côté browser, alors **toutes** les requêtes vers les endpoints sensibles (`evaluate`, `query_selector`, `import_cookies`, `get_page_html`, `wait_for_selector`) doivent porter `x-api-key` + `Authorization: Bearer`. Le client MCP attache automatiquement la clé venant de `CAMOFOX_API_KEY` côté MCP — donc bien partager la même clé entre les deux processus.

### 7. Logs LLM

`smart_snapshot` écrit chaque appel dans `~/.camofox-mcp/logs/smart-snapshot/` avec le **prompt complet** et la **réponse** LLM. Si le prompt contient des secrets (cookies, mots de passe en clair injectés par mégarde dans les snapshots), ils seront persistés.

Mitigation :
- Ne pas log les snapshots de pages bancaires, mailbox, etc.
- Mettre en place une rotation : `find ~/.camofox-mcp/logs -mtime +7 -delete`
- Ne pas activer `smart_snapshot` quand on travaille avec des données sensibles

### 8. Redaction des configs LLM

Les logs ne doivent **jamais** exposer `apiKey` en clair. `redactedLLMConfig()` ([src/llm/config.ts](../../src/llm/config.ts)) doit être utilisé partout :

```ts
console.error("[startup] llm config", redactedLLMConfig(cfg));
// → { ..., apiKey: "***" }
```

Vérifier que **tous** les `console.log/.error` qui touchent la config passent par ce helper. Une revue rapide grep `apiKey` dans le source est recommandée régulièrement.

## Cookies / profils

Les profils (`~/.camofox-mcp/profiles/*.json`) contiennent **les cookies httpOnly** d'origine — équivalent à des credentials authentifiés vers le site cible. Toute personne avec lecture du fichier peut **se connecter sans passer par le login** (jusqu'à expiration côté serveur du site).

Recommandations :
- Ne pas backuper le dossier sans chiffrement (chiffrer via `age`, `gpg`, ou stockage chiffré niveau FS)
- Ne pas committer dans Git (`~/.camofox-mcp/` n'est pas dans le repo, mais bien le dire dans la doc)
- Pour les credentials critiques (banques, prod admin) : utiliser des `userId` éphémères, **désactiver `CAMOFOX_AUTO_SAVE`**, et `delete_profile` à la fin de la session

## CORS

`src/http.ts` met **`Access-Control-Allow-Origin: *`** par défaut (échappatoire navigateur pour MCP Inspector). En production exposée Internet : restreindre via le reverse proxy.

## Surface RCE — détail par tool

| Tool | RCE potentielle | Mitigation |
|---|---|---|
| `camofox_evaluate_js` | **Oui — total** dans la page browser | Désactiver via layers, ou exiger `CAMOFOX_API_KEY` |
| `camofox_query_selector` | Lecture DOM, pas d'écriture | `CAMOFOX_API_KEY` recommandée |
| `camofox_get_page_html` | Lecture HTML rendu | `CAMOFOX_API_KEY` recommandée |
| `import_cookies` | Injection cookies arbitraires (CSRF, session fixation côté browser) | `CAMOFOX_API_KEY` recommandée |
| `type_text` (long >400) | Fallback `evaluate` → idem evaluate_js | idem |
| `web_search` | Navigue selon engine choisi | OK (URLs construites côté browser) |

## Recommandations de déploiement par scénario

### Local agent dev (machine perso)
- Bind 127.0.0.1 par défaut ✅
- Pas de `CAMOFOX_API_KEY` (overhead inutile)
- Profils dans home, mode 0600

### Multi-user prod (serveur partagé / cloud)
- Reverse proxy + JWT/mTLS
- `CAMOFOX_API_KEY` partagée mcp ↔ browser
- Profils sur volume chiffré
- Logs rotatés
- `CAMOFOX_LAYER_LEGACY=false` si l'agent peut s'en passer (réduit surface)
- Monitoring du `get_stats` pour détecter les anomalies (toolCalls explosifs, etc.)

### CI / sandbox éphémère
- Container isolé
- Pas de profils persistants → `--auto-save false`
- Headless, pas de VNC
- Network policy stricte (no-egress sauf domaines whitelistés)
