# CamoFox MCP

CamoFox MCP is an anti-detection browser automation server for MCP-compatible AI agents. It connects clients such as Claude Desktop, VS Code, Cursor, and OpenClaw to a running `camofox-browser` server.

The project is an MCP adapter. Browser execution, Camoufox fingerprinting, downloads, and live DOM operations are handled by `camofox-browser`; this package validates MCP tool calls, tracks tab state, manages profiles, and forwards browser operations over HTTP.

## Capabilities

- Stdio and streamable HTTP MCP transports.
- Anti-detection browser tabs backed by CamoFox Browser and Camoufox.
- Tool layers for lean agent surfaces or full backward-compatible tool access.
- Navigation, interaction, observation, screenshots, downloads, profiles, search, semantic actions, and structured extraction.
- Snapshot-first workflows using accessibility refs, with CSS selector fallbacks for modern SPAs.
- Session persistence through cookie profiles and optional auto-save.

## Quick Install

Start the browser server:

```bash
npx camofox-browser@latest
```

Add CamoFox MCP to a stdio MCP client:

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

For HTTP-capable clients:

```bash
CAMOFOX_TRANSPORT=http npx -y camofox-mcp@latest
```

The HTTP endpoint is `http://localhost:3000/mcp` by default.

## Verify

Check the browser server:

```bash
curl -fsS http://localhost:9377/health
```

Then ask your MCP client to run:

```text
Call server_status, create a tab for https://example.com, take a snapshot, then close the tab.
```

## Documentation

- [Documentation hub](docs/README.md)
- [Quickstart](docs/quickstart.md)
- [Guide](docs/guide.md)
- [MCP server](docs/mcp-server.md)
- [Agents](docs/agents.md)
- [Architecture](docs/architecture/index.md)
- [Operations](docs/operations.md)

Agents should start with [docs/llms.txt](docs/llms.txt), then read [Agents](docs/agents.md) and [MCP server](docs/mcp-server.md).

## Development

```bash
npm install
npm run build
npm test
```

Run locally with stdio:

```bash
npm run dev
```

Run locally with HTTP transport:

```bash
npm run build
CAMOFOX_TRANSPORT=http node dist/http.js
```

## Security

CamoFox MCP is a browser control surface. Keep HTTP transport on `127.0.0.1` unless the deployment environment provides access controls. Treat cookies, saved profiles, downloads, browser-server API keys, and LLM provider keys as sensitive data.

## License

MIT. See [LICENSE](LICENSE).
