# Tools Architecture

CamoFox MCP registers tools through `server.tool(name, description, zodSchema, handler)`.

## Registration Tree

```text
createServer()
  -> core tools, always on
  -> semantic tools, if layers.semantic
  -> legacy tools, if layers.legacy
  -> prompts
```

## Profiles

| Profile | Default behavior |
| --- | --- |
| `full` | Core + semantic + legacy. This is the backward-compatible default. |
| `lean` | Core + semantic. This is better for agents that should see fewer tools. |
| `custom` | Core plus explicit layer flags. |

The active profile is selected with `CAMOFOX_PROFILE`. Individual layer flags can be toggled with variables such as `CAMOFOX_LAYER_SEMANTIC` and `CAMOFOX_LAYER_LEGACY`.

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
| Search | `web_search` |
| YouTube | `youtube_transcript` |
| Batch | `fill_form`, `type_and_submit`, `navigate_and_snapshot`, `scroll_and_snapshot`, `camofox_scroll_element_and_snapshot`, `batch_click` |
| Presets | `list_presets` |

## Tool Handler Pattern

Each tool should:

1. Validate input with Zod.
2. Resolve tracked tab state when a `tabId` is required.
3. Resolve `userId` from input or tracked tab state.
4. Call the browser client, profile store, or LLM router.
5. Update local state when the action changes tab metadata.
6. Return normalized MCP content.

## API-Key-Sensitive Tools

Some browser-server endpoints require an API key when the browser server is protected. These include JavaScript evaluation, selector inspection, rendered HTML access, selector waits, cookie import, and long-text fallbacks that use evaluation internally.

## Related Topics

- [Guide](../guide.md)
- [Agents](../agents.md)
- [Browser client](browser-client.md)
- [LLM layer](llm.md)
