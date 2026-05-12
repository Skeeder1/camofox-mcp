# Browser Client Architecture

`src/client.ts` is the boundary between MCP tools and `camofox-browser`.

## Client Tree

```text
Tool handler
  -> CamofoxClient
  -> fetch request to CAMOFOX_URL
  -> response validation / conversion
  -> AppError mapping
  -> MCP result
```

## Responsibilities

The browser client:

- Sends HTTP requests to the browser server.
- Adds API-key headers when configured.
- Applies request timeouts.
- Maps connection, timeout, HTTP, and API-key failures into consistent errors.
- Provides typed methods used by tool handlers.
- Supports auto-start behavior when `CAMOFOX_BROWSER_SERVER_PATH` is configured.

## Browser Server Boundary

`camofox-browser` owns:

- Browser contexts and tabs.
- Camoufox anti-detection behavior.
- DOM interaction.
- Screenshot generation.
- Download registry and files.
- Cookie import/export endpoints.
- Browser-level session behavior.

CamoFox MCP owns:

- MCP tool registration.
- Input validation.
- Local tab metadata.
- Profile persistence.
- LLM-assisted semantic routing.
- MCP output formatting.

## Profiles

Profiles are saved cookie bundles stored under `CAMOFOX_PROFILES_DIR`. The profile store validates profile IDs, writes files atomically, and uses restrictive file permissions where possible.

Auto-save uses internal profile names for logical users when `CAMOFOX_AUTO_SAVE` is enabled. Manual profile tools are still available for named sessions.

## Downloads

Download tools expose browser-server download records. Agents should list downloads before retrieving content and should request inline content only when needed.

## Related Topics

- [Guide](../guide.md)
- [Operations](../operations.md)
- [Tools architecture](tools.md)
