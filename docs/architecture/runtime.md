# Runtime Architecture

The runtime layer starts the MCP server, chooses the transport, registers tools, and keeps local tab state bounded.

## Transport Tree

```text
src/index.ts
  -> loadConfig()
  -> if CAMOFOX_TRANSPORT=http: startHttpServer()
  -> else: StdioServerTransport

src/http.ts
  -> Express HTTP server
  -> streamable HTTP MCP endpoint
  -> rate limit
  -> per-request MCP server/transport handling
```

## Configuration

Runtime configuration comes from CLI flags and environment variables. Important values include:

- `CAMOFOX_URL`
- `CAMOFOX_API_KEY`
- `CAMOFOX_TRANSPORT`
- `CAMOFOX_HTTP_HOST`
- `CAMOFOX_HTTP_PORT`
- `CAMOFOX_HTTP_RATE_LIMIT`
- `CAMOFOX_TIMEOUT`
- `CAMOFOX_DEFAULT_USER_ID`
- `CAMOFOX_PROFILES_DIR`
- `CAMOFOX_AUTO_SAVE`

## State Model

`src/state.ts` tracks tab metadata in process memory:

- `tabId`
- `userId`
- `sessionKey`
- URL and title metadata
- visited URL history
- tool-call counters
- refs count
- task context and history

State is intentionally bounded with tab limits, TTL cleanup, and capped histories.

## Lifecycle

Normal task lifecycle:

```text
create_tab
  -> navigate / search
  -> observe / snapshot / interact
  -> save_profile when needed
close_tab
```

Process cleanup attempts to close tracked tabs on shutdown or fatal startup errors.

## Error Model

Tools return MCP content with structured JSON. Browser-server failures are normalized into application errors where possible, including connection failures, timeouts, API-key failures, profile failures, and tab lookup failures.

## Related Topics

- [MCP Server](../mcp-server.md)
- [Operations](../operations.md)
- [Browser client](browser-client.md)
