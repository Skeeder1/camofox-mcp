# MCP Server

CamoFox MCP registers browser automation tools for MCP clients and forwards tool calls to `camofox-browser`.

## Transports

Stdio is the default and fits local MCP clients:

```bash
npx -y camofox-mcp@latest
```

Streamable HTTP is enabled with:

```bash
CAMOFOX_TRANSPORT=http npx -y camofox-mcp@latest
```

Default HTTP settings:

| Setting | Default |
| --- | --- |
| Endpoint | `http://localhost:3000/mcp` |
| Host | `127.0.0.1` |
| Port | `3000` |
| Rate limit | `60` requests per minute |

Keep HTTP bound to loopback unless a reverse proxy, firewall, and authentication model are in place.

## Tool Layers

The server uses layers to control how many tools are exposed.

| Layer | Purpose |
| --- | --- |
| Core | Health, tabs, navigation, sessions, profiles, and downloads. Always on. |
| Semantic | `extract`, `observe`, `act`, `find_element_by_prompt`, and `execute`. |
| Legacy | Granular interaction, observation, extraction, search, batch, presets, YouTube, and smart snapshot tools. |

Profiles:

| Profile | Tools exposed |
| --- | --- |
| `full` | Core + semantic + legacy. Backward-compatible default. |
| `lean` | Core + semantic. Smaller tool surface for agents. |
| `custom` | Core plus explicit per-layer flags. |

Set the profile with:

```bash
CAMOFOX_PROFILE=lean npx -y camofox-mcp@latest
```

Layer flags include `CAMOFOX_LAYER_SEMANTIC`, `CAMOFOX_LAYER_LEGACY`, `CAMOFOX_LAYER_STEALTH`, `CAMOFOX_LAYER_VISION`, `CAMOFOX_LAYER_CACHE`, and `CAMOFOX_LAYER_NETWORK`. Reserved layers may exist in configuration before tools are implemented for them.

## Tool Groups

The current source registers up to 57 tools in the full profile.

| Group | Tools |
| --- | --- |
| Health | `server_status`, `stop_browser` |
| Tabs | `create_tab`, `close_tab`, `list_tabs` |
| Navigation | `navigate`, `go_back`, `go_forward`, `refresh` |
| Sessions | `import_cookies`, `get_stats`, `camofox_close_session`, `toggle_display`, `set_task_context`, `get_task_context`, `diagnose_failure` |
| Profiles | `save_profile`, `load_profile`, `list_profiles`, `delete_profile` |
| Downloads | `list_downloads`, `get_download`, `delete_download` |
| Semantic | `extract`, `observe`, `act`, `find_element_by_prompt`, `execute` |
| Interaction | `click`, `type_text`, `scroll`, `camofox_scroll_element`, `camofox_evaluate_js`, `camofox_hover`, `camofox_wait_for`, `camofox_press_key` |
| Observation | `snapshot`, `snapshot_dialog`, `camofox_get_page_html`, `camofox_query_selector`, `screenshot`, `get_links`, `camofox_wait_for_text`, `camofox_wait_for_selector` |
| Smart snapshot | `smart_snapshot` |
| Extraction | `extract_resources`, `batch_download`, `resolve_blobs` |
| Search and media | `web_search`, `youtube_transcript` |
| Batch | `fill_form`, `type_and_submit`, `navigate_and_snapshot`, `scroll_and_snapshot`, `camofox_scroll_element_and_snapshot`, `batch_click` |
| Presets | `list_presets` |

## Lifecycle

Use explicit cleanup:

```text
server_status
create_tab
navigate or web_search
snapshot / observe / extract
interact
save_profile when persistence is needed
close_tab
```

Use `camofox_close_session` when all tabs for a logical user session should be closed together.

## Security

- Treat CamoFox MCP as a browser control surface.
- Keep HTTP transport local by default.
- Use `CAMOFOX_API_KEY` when the browser server enforces authentication.
- Treat profile files, cookies, downloads, and API keys as sensitive.
- Avoid exposing `camofox-browser` or MCP HTTP endpoints directly to untrusted networks.
- Use `lean` profile when an agent should have a smaller tool surface.

## Related Topics

- [Quickstart](quickstart.md)
- [Agents](agents.md)
- [Runtime architecture](architecture/runtime.md)
- [Tools architecture](architecture/tools.md)
