# Deploy — systemd units for a reliable CamoFox MCP server

This stack is two processes, and either can fail while the other looks fine:

```
camofox-mcp (:8101)  ->  camofox-browser (:9377)  ->  Camoufox (Firefox)
```

`systemctl is-active` only proves the adapter's PID exists. It stays green when
the browser server behind it has died, and every navigation fails.

| Unit | Purpose |
| --- | --- |
| `camofox-mcp.service` | the adapter, with browser warmup, auth and the `lean` tool profile |
| `camofox-healthcheck.timer` | probes the MCP contract **and** the browser, restarts on real failure |

## Install

Adjust the paths (they assume `/opt/camofox-mcp` and `/opt/camofox-browser`),
set real secrets, then:

```bash
cp deploy/*.service deploy/*.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now camofox-mcp.service camofox-healthcheck.timer
sudo loginctl enable-linger "$USER"     # survive logout
```

## Check

```bash
node scripts/healthcheck.mjs               # 0 healthy, 1 broken, 2 unreachable
node scripts/healthcheck.mjs --allow-browser-down   # adapter only
systemctl --user list-timers 'camofox-*'
```
