# Cycle de vie du process

## Démarrage

### Stdio

```text
┌───────────────────────────────────────────────────────────────┐
│ 1. Le client MCP spawn `node dist/index.js` (ou `npx camofox-mcp`)
│ 2. index.ts: loadConfig(argv, env)
│ 3. createServer(config):
│    a. instancie CamofoxClient(config)
│    b. registerHealthTools, ...Tabs..., ...Navigation...
│    c. if flags.semantic → registerSemanticTools
│    d. if flags.legacy → register {Interaction, Observation, ...}
│    e. registerPrompts (6)
│ 4. setupCleanup(client) — sweep timer + SIGINT/SIGTERM handlers
│ 5. new StdioServerTransport()
│ 6. await server.connect(transport) — handshake MCP, send tool list
└───────────────────────────────────────────────────────────────┘
```

### HTTP

```text
1-4. (idem stdio)
5. startHttpServer(config):
   a. express() + helmet + cors + json
   b. POST /mcp: (req,res) => {
        const server = createServer(config);   // PER REQUEST
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined         // stateless
        });
        res.on("close", () => { transport.close(); server.close(); });
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
      }
   c. app.listen(port, host)
```

⚠ **Note importante HTTP** : un nouveau `McpServer` est créé **à chaque requête HTTP**. Le state des tabs (`Map` au niveau module dans [state.ts](../../src/state.ts)) **persiste** car il vit dans le module, pas dans le server. Mais `setupCleanup()` est appelé une fois au lancement HTTP, pas par requête.

## Auto-start de `camofox-browser`

À la première requête vers `camofox-browser` :

```text
client.fetch(/health) → ECONNREFUSED
  ↓ catch
ensureRunning():
  spawn("node", browserServerPath, { detached: true, stdio: "ignore" })
  loop 30 fois × 500ms (= 15s max):
    fetch(/health)
    if 200 → break
  if timeout → throw CONNECTION_REFUSED
client.fetch(<original>) — retry × 1
```

Le `browserServerPath` est résolu via `require.resolve("camofox-browser/bin/camofox-browser.js")` (peer dependency).

## Fonctionnement steady-state

Pour chaque tool call :

```
1. Transport reçoit tools/call
2. McpServer dispatche au handler enregistré
3. Handler:
   a. Zod parse l'input (throw ZodError → VALIDATION_ERROR)
   b. getTrackedTab(tabId) (throw TAB_NOT_FOUND si absent — sauf create_tab)
   c. délègue au CamofoxClient (HTTP)
   d. update state (incrementToolCall, updateTabUrl, recordTabAction)
   e. okResult({...})
4. Transport renvoie la réponse JSON-RPC
```

En parallèle, **chaque minute**, le sweeper passe la `Map<tabId, TabInfo>` :

```
sweep:
  for [tabId, info] of trackedTabs:
    if (now - info.lastUsedAt > TAB_TTL_MS):
      client.closeTab(tabId, info.userId).catch(() => {})
      trackedTabs.delete(tabId)
```

## Arrêt gracieux

### Stdio

Le client ferme stdin → EOF → la SDK propage l'événement → `server.close()` → cleanup.

### HTTP

`SIGINT` ou `SIGTERM` reçu :

```ts
async function gracefulShutdown() {
  setTimeout(() => process.exit(1), 5_000).unref();   // hard timeout
  for (const [tabId, info] of getAllTrackedTabs()) {
    await client.closeTab(tabId, info.userId).catch(() => {});
  }
  process.exit(0);
}
```

**5 secondes max** pour fermer tous les tabs trackés. Au-delà, le process exit avec code 1. Les tabs côté `camofox-browser` qui n'auront pas eu le temps d'être fermés seront sweepés par le browser server lui-même (TTL séparé côté browser).

## Cas d'erreur au démarrage ([src/index.ts](../../src/index.ts))

```ts
try {
  await server.connect(transport);
} catch (err) {
  // Best-effort: clean up any tabs already tracked before the failure
  for (const tabId of listTrackedTabs().map(t => t.tabId)) {
    await client.closeTab(tabId, ...).catch(() => {});
  }
  console.error("Fatal:", err);
  process.exit(1);
}
```

Cas typiques :
- `camofox-browser` non installé → `MODULE_NOT_FOUND` lors du resolve → exit 1
- Port HTTP déjà utilisé → `EADDRINUSE` → exit 1
- API key invalide en mode auto-start → exit 1 après timeout 15s

## Hot-reload / signal handling

| Signal | Action |
|---|---|
| `SIGINT` (Ctrl-C) | gracefulShutdown |
| `SIGTERM` (k8s, docker stop) | gracefulShutdown |
| `SIGHUP` | non handlé — comportement par défaut Node (exit) |
| `SIGUSR1`, `SIGUSR2` | non handlés |

Pas de mécanisme de reload de config à chaud. Tout changement de `~/.camofox-mcp/config.yaml` ou d'env nécessite un restart.

## Empreinte mémoire

| Élément | Ordre de grandeur |
|---|---|
| Process Node + SDK MCP | ~70-90 MB |
| Map de tabs (100 max) | ~1-5 MB |
| Caches sémantiques (3 × 50 entries × 5s TTL) | ~1-2 MB |
| Smart-snapshot cache | ~500 KB |
| Total typique | **< 100 MB** |

Aucune fuite connue. Le sweep + le cap MAX_TABS bornent strictement la mémoire.
