# Guide

This page covers day-to-day CamoFox MCP workflows.

## Basic Browser Flow

Most tasks follow this shape:

```text
server_status
create_tab
navigate or web_search
snapshot or smart_snapshot
click/type/scroll/extract
close_tab
```

Prefer `snapshot` or `smart_snapshot` before using interaction tools. They expose refs such as `e1` and `e2`, which are usually safer than guessing CSS selectors.

## Tabs

Create a tab before interacting with a page:

```text
create_tab({ "url": "https://example.com", "userId": "research" })
```

Use `list_tabs` to inspect active tabs and `close_tab` to free browser resources. Tabs are tracked in local MCP state and also exist in `camofox-browser`.

## Navigation

Use the simple navigation tools for known URLs:

```text
navigate({ "tabId": "...", "url": "https://example.com" })
go_back({ "tabId": "..." })
go_forward({ "tabId": "..." })
refresh({ "tabId": "..." })
```

Use `navigate_and_snapshot` when the next step is reading the page immediately after navigation.

## Refs vs Selectors

Use refs first:

```text
snapshot({ "tabId": "..." })
click({ "tabId": "...", "ref": "e4" })
type_text({ "tabId": "...", "ref": "e7", "text": "query" })
```

Use CSS selectors when refs are missing, stale, or incomplete on a modern SPA:

```text
camofox_wait_for_selector({ "tabId": "...", "selector": "input[name=q]" })
camofox_query_selector({ "tabId": "...", "selector": "main article" })
click({ "tabId": "...", "selector": "button[type=submit]" })
```

After any action that changes the page, take a fresh snapshot before reusing refs.

## Semantic Tools

When semantic tools are enabled, use them to reduce multi-step agent reasoning:

```text
observe({ "tabId": "...", "intent": "find the login form" })
act({ "tabId": "...", "intent": "click the sign in button" })
extract({ "tabId": "...", "query": "product names and prices", "schema": { ... } })
execute({ "tabId": "...", "plan": [ ... ] })
```

The semantic layer uses an external LLM configuration. If no key is configured, tools return a structured `LLM_DISABLED` result instead of crashing the server.

## Search

Use `web_search` when the task starts with discovery:

```text
web_search({ "tabId": "...", "query": "camoufox github", "engine": "google" })
```

Read the result with `snapshot`, then navigate or interact from the returned refs.

## Downloads and Resources

Use scoped extraction before downloading:

```text
extract_resources({ "tabId": "...", "selector": ".gallery", "types": ["images"] })
batch_download({ "tabId": "...", "selector": ".documents", "types": ["documents"], "extensions": ["pdf"] })
list_downloads({ "userId": "research" })
get_download({ "downloadId": "...", "includeContent": true })
```

Use `resolve_blobs` for `blob:` URLs that cannot be downloaded directly.

## Profiles and Sessions

Profiles store cookies on disk so agents can reuse trusted sessions:

```text
save_profile({ "tabId": "...", "profileId": "github-main" })
load_profile({ "tabId": "...", "profileId": "github-main" })
list_profiles({})
delete_profile({ "profileId": "github-main" })
```

Profile files can contain sensitive cookies. Store them accordingly.

## Related Topics

- [MCP Server](mcp-server.md)
- [Agents](agents.md)
- [Tools architecture](architecture/tools.md)
- [Browser client architecture](architecture/browser-client.md)
