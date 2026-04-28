# Transports MCP

Deux transports sont supportés. Choix piloté par `CAMOFOX_TRANSPORT` / `--transport`.

## stdio (défaut)

**Fichier** : [src/index.ts](../../src/index.ts).
**Use case** : intégration avec un client MCP local (Claude Desktop, VS Code MCP extension, Cursor, OpenClaw desktop, Cline…).
**Protocole** : JSON-RPC 2.0 sur stdin/stdout, framing line-delimited.

```ts
// src/index.ts (résumé)
const config = loadConfig(process.argv.slice(2), process.env);
if (config.transport === "http") {
  await startHttpServer(config);
  return;
}
const server = createServer(config);
const transport = new StdioServerTransport();
await server.connect(transport);
```

**Caractéristiques** :
- Un seul process par client MCP (le client spawn `camofox-mcp` lui-même).
- Pas de port, pas de réseau, pas de rate limit nécessaire.
- L'arrêt du client → stdin EOF → SIGPIPE → cleanup ([state.ts:setupCleanup](../../src/state.ts)).
- Logs sur **stderr uniquement** (stdout est réservé au protocole).

**Configuration côté client** (exemple Claude Desktop / VS Code) :

```json
{
  "servers": {
    "camofox": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "camofox-mcp@latest"],
      "env": {
        "CAMOFOX_URL": "http://localhost:9377",
        "OPEN_ROUTER": "sk-or-v1-..."
      }
    }
  }
}
```

## HTTP (StreamableHTTP)

**Fichier** : [src/http.ts](../../src/http.ts).
**Use case** : déploiement comme service central (Docker, K8s, sub-agent distant), accès depuis OpenClaw remote, multi-clients.
**Protocole** : JSON-RPC 2.0 over `POST /mcp` avec streaming SSE pour les notifications.

### Architecture stateless

```ts
// src/http.ts (extrait essentiel)
app.post("/mcp", async (req, res) => {
  const server = createServer(config);             // NEW per request
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined                  // stateless
  });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});
```

**Conséquences** :
- Aucune session HTTP n'est conservée → scaling horizontal trivial.
- L'état applicatif (tracked tabs, profils sur disque) **persiste** dans le process tant qu'il tourne, indépendamment des connexions HTTP.
- Plusieurs clients peuvent partager le même process et donc voir les mêmes `tabId`.

### Routes

| Méthode | Path | Réponse |
|---|---|---|
| `POST` | `/mcp` | Dispatch JSON-RPC |
| `GET` | `/mcp` | `405 Method Not Allowed` |
| `DELETE` | `/mcp` | `405 Method Not Allowed` |
| `GET` | `/health` | _(non implémenté côté camofox-mcp ; le `/health` est sur camofox-browser)_ |

### Middlewares

```ts
app.use(helmet());                    // headers de sécurité standards
app.use(cors());                      // CORS open par défaut — adapter selon déploiement
app.use(express.json({ limit: "..." }));
app.use("/mcp", rateLimit({
  windowMs: 60_000,
  max: config.httpRateLimit           // 60/min/IP par défaut
}));
```

### Sécurité — points d'attention

⚠ **Le serveur HTTP n'a PAS d'auth intégrée.** Conséquences :

| Surface | Risque | Mitigation |
|---|---|---|
| Tools `evaluate`, `query_selector`, `get_page_html` | RCE dans le navigateur (script JS arbitraire) | NE PAS exposer le port à internet. Reverse proxy + auth (mTLS, JWT, basic) en amont |
| Tools `import_cookies`, `save_profile` | exfiltration / injection de cookies | idem |
| `host: 0.0.0.0` | Accès réseau public | toujours `127.0.0.1` ou bind sur réseau privé |
| Rate limit par défaut 60/min | DoS facile | ajuster `CAMOFOX_HTTP_RATE_LIMIT` ou utiliser un WAF |

Le `CAMOFOX_API_KEY` est pour l'auth **vers** `camofox-browser`, pas pour l'auth **vers** `camofox-mcp` (qui n'en a pas).

### Configuration client (OpenClaw remote)

```json
{
  "servers": {
    "camofox": {
      "type": "http",
      "url": "http://camofox-mcp.internal:3000/mcp"
    }
  }
}
```

### Comparaison

| Critère | stdio | HTTP |
|---|---|---|
| Déploiement | local, par-client | central, multi-client |
| Latence | ≈ 0 ms (IPC) | RTT réseau |
| Auth | implicite (process owner) | aucune intégrée — à fournir |
| Scaling | 1 process / client | N clients / process, scale horizontal |
| Logs | stderr du process spawn | stdout du serveur |
| Cleanup | EOF → SIGPIPE | `res.close` + sweep |
| Recommandé pour | desktop MCP | infra serveur, OpenClaw, dev partagé |
