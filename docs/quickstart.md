# Quickstart

Use this page to install CamoFox MCP, connect it to `camofox-browser`, and verify the first browser workflow.

## Requirements

- Node.js 18 or newer.
- A running `camofox-browser` server.
- An MCP-compatible client.
- `CAMOFOX_API_KEY` only when the browser server requires authentication.

## Start CamoFox Browser

```bash
npx camofox-browser@latest
```

Verify it responds:

```bash
curl -fsS http://localhost:9377/health
```

## Stdio Setup

Use stdio for local desktop MCP clients.

```json
{
  "mcpServers": {
    "camofox": {
      "command": "npx",
      "args": ["-y", "camofox-mcp@latest"],
      "env": {
        "CAMOFOX_URL": "http://localhost:9377"
      }
    }
  }
}
```

If the browser server requires authentication, add the same `CAMOFOX_API_KEY` expected by that server.

## HTTP Setup

Use streamable HTTP for clients that connect to a local or remote MCP URL.

```bash
CAMOFOX_TRANSPORT=http npx -y camofox-mcp@latest
```

The default endpoint is:

```text
http://localhost:3000/mcp
```

Use a custom port or host when needed:

```bash
CAMOFOX_TRANSPORT=http CAMOFOX_HTTP_PORT=8080 CAMOFOX_HTTP_HOST=127.0.0.1 npx -y camofox-mcp@latest
```

## Docker Setup

Start the browser server:

```bash
docker run -d -p 9377:9377 --name camofox-browser ghcr.io/redf0x1/camofox-browser:latest
```

Start CamoFox MCP in HTTP mode:

```bash
docker run -p 3000:3000 --rm \
  -e CAMOFOX_TRANSPORT=http \
  -e CAMOFOX_URL=http://host.docker.internal:9377 \
  ghcr.io/redf0x1/camofox-mcp:latest node dist/http.js
```

## First Verification

Ask your MCP client to run:

```text
Verify CamoFox MCP:
1. Call server_status.
2. Call create_tab with url https://example.com.
3. Call snapshot and confirm "Example Domain" is visible.
4. Call close_tab.
Report each step as pass or fail.
```

## Local Development

```bash
npm install
npm run build
npm run dev
```

For HTTP development:

```bash
npm run build
CAMOFOX_TRANSPORT=http node dist/http.js
```

## Related Topics

- [Guide](guide.md)
- [MCP Server](mcp-server.md)
- [Operations](operations.md)
- [Runtime architecture](architecture/runtime.md)
