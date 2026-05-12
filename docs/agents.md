# Agents

This page gives AI agents a small decision map for CamoFox MCP.

## Entry Tree

```text
Need setup help
  -> quickstart.md
  -> operations.md

Need to browse a site
  -> guide.md
  -> mcp-server.md

Need to decide tools
  -> agents.md
  -> architecture/tools.md

Need internals
  -> architecture/index.md
  -> architecture/runtime.md
```

## Tool Selection

| Need | Prefer |
| --- | --- |
| Check whether the browser is available | `server_status` |
| Open an isolated browser context | `create_tab` |
| Read page content cheaply | `snapshot` or `smart_snapshot` |
| Discover possible actions | `observe` when semantic tools are enabled, otherwise `snapshot` |
| Click or type visible controls | `click`, `type_text`, or `act` |
| Handle dynamic content | `camofox_wait_for`, `camofox_wait_for_text`, `camofox_wait_for_selector` |
| Work around missing refs | CSS selectors with `camofox_query_selector` or `camofox_get_page_html` |
| Extract structured data | `extract` with a schema when semantic tools are enabled |
| Download files or media | `extract_resources`, `batch_download`, `list_downloads`, `get_download` |
| Reuse authenticated state | `save_profile`, `load_profile`, `import_cookies` |

## Playbooks

Basic browsing:

```text
server_status
create_tab(url)
snapshot
click or type_text
snapshot
close_tab
```

Search and extract:

```text
create_tab(userId)
web_search(query, engine)
snapshot
extract(query, schema)
close_tab
```

SPA fallback:

```text
navigate
camofox_wait_for
snapshot
camofox_wait_for_selector
camofox_query_selector
click(selector) or type_text(selector)
snapshot
```

Download workflow:

```text
create_tab(url)
snapshot
extract_resources(selector or ref)
batch_download(selector or ref)
list_downloads
get_download
close_tab
```

Session reuse:

```text
create_tab(userId)
load_profile(profileId, tabId)
navigate
snapshot
save_profile(tabId, profileId)
close_tab
```

## Cleanup Rules

- Close every tab opened with `create_tab`.
- Use `camofox_close_session` for whole-session cleanup.
- Save profiles only when persistence is required.
- Take a fresh snapshot after navigation, clicks, form submissions, scrolls, or hydration waits.
- Do not reuse refs across page changes.

## Safety Rules

- Profiles and cookies can contain authenticated sessions.
- Downloads may contain sensitive files.
- `camofox_evaluate_js`, DOM query tools, and cookie import may require `CAMOFOX_API_KEY`.
- Confirm user intent before interacting with authenticated, private, payment, admin, or destructive pages.
- Respect laws, site terms, rate limits, account policies, and privacy constraints.

## Related Topics

- [MCP Server](mcp-server.md)
- [Guide](guide.md)
- [Tools architecture](architecture/tools.md)
- [LLM architecture](architecture/llm.md)
