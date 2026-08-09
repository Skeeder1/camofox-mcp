# Operations

This page covers configuration, testing, Docker, troubleshooting, and release checks.

## Configuration

Common environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `CAMOFOX_URL` | `http://localhost:9377` | Browser server URL. |
| `CAMOFOX_API_KEY` | none | Browser server authentication key when required. |
| `CAMOFOX_TIMEOUT` | `30000` | Browser server request timeout in milliseconds. |
| `CAMOFOX_DEFAULT_USER_ID` | `default` | Default logical user/session identifier. |
| `CAMOFOX_PROFILES_DIR` | `~/.camofox-mcp/profiles` | Saved profile directory. |
| `CAMOFOX_AUTO_SAVE` | `true` | Auto-load and auto-save profile behavior. |
| `CAMOFOX_TRANSPORT` | `stdio` | `stdio` or `http`. |
| `CAMOFOX_HTTP_HOST` | `127.0.0.1` | HTTP bind address. |
| `CAMOFOX_HTTP_PORT` | `3000` | HTTP port. |
| `CAMOFOX_HTTP_RATE_LIMIT` | `60` | HTTP requests per minute. |
| `CAMOFOX_PROFILE` | `full` | Tool profile: `full`, `lean`, or `custom`. |

Semantic and smart-snapshot tools use `CAMOFOX_LLM_*` configuration. Legacy `CAMOFOX_SUMMARIZER_*` variables are still honored by the LLM config layer.

## Build and Test

```bash
npm install
npm run build
npm test
```

For targeted checks:

```bash
npx vitest run src/__tests__/config.test.ts
npx vitest run src/__tests__/llm-config.test.ts
npx vitest run src/__tests__/prompts.test.ts
```

## Docker

Browser server:

```bash
docker run -d -p 9377:9377 --name camofox-browser ghcr.io/redf0x1/camofox-browser:latest
```

MCP HTTP server:

```bash
docker run -p 3000:3000 --rm \
  -e CAMOFOX_TRANSPORT=http \
  -e CAMOFOX_URL=http://host.docker.internal:9377 \
  ghcr.io/redf0x1/camofox-mcp:latest node dist/http.js
```

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Browser connection refused | Start `camofox-browser` and verify `CAMOFOX_URL`. |
| MCP HTTP endpoint unreachable | Check `CAMOFOX_HTTP_HOST`, `CAMOFOX_HTTP_PORT`, firewall, and container port mappings. |
| Tool requires API key | Set `CAMOFOX_API_KEY` consistently for the browser server and MCP process. |
| Refs do not work | Take a fresh `snapshot`; use selectors when refs are incomplete. |
| SPA content is missing | Use `camofox_wait_for`, `camofox_wait_for_text`, or `camofox_wait_for_selector`. |
| Semantic tools return `LLM_DISABLED` | Configure `CAMOFOX_LLM_API_KEY`, provider, model, and endpoint. |
| Too many tools in the client | Set `CAMOFOX_PROFILE=lean`. |

## Release Checks

- Run `npm run build`.
- Run `npm test` or the affected targeted tests.
- Check that README links point to active docs.
- Check that `server.json` version and tool metadata match `package.json` and source.
- Run stale-doc searches for old counts, placeholders, and removed folders.

## Related Topics

- [Quickstart](quickstart.md)
- [MCP Server](mcp-server.md)
- [Architecture](architecture/index.md)

## Unattended reliability

`systemctl is-active` only proves the adapter PID exists. The browser server
behind it fails independently: the MCP handshake keeps succeeding, `tools/list`
keeps returning every tool, and every navigation fails.

```bash
node scripts/healthcheck.mjs                      # 0 healthy, 1 broken, 2 unreachable
node scripts/healthcheck.mjs --allow-browser-down # adapter-only
```

Ready-made systemd units are in [`deploy/`](../deploy/) — see
[`deploy/README.md`](../deploy/README.md). The healthcheck timer probes both
layers and restarts the server only on a genuine failure.
