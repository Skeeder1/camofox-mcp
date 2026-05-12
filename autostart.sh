#!/bin/bash
# camofox-mcp-wrapper.sh
# Auto-starts camofox-browser if not running, then launches the MCP server.
# A background watchdog stops the browser after IDLE_TIMEOUT seconds of no activity.
#
# Usage: called by Hermes mcp_servers config

HEALTH_URL="http://localhost:9377/health"
BROWSER_DIR="/home/openclaw/mcp/camofox-browser"
MCP_BIN="/home/openclaw/mcp/camofox-mcp/dist/index.js"
BROWSER_LOG="/tmp/camofox-browser.log"
ACTIVITY_FILE="/tmp/camofox-last-activity"
IDLE_TIMEOUT=600  # 10 minutes

# ── Start browser if not running ──
start_browser() {
    if curl -sf "$HEALTH_URL" > /dev/null 2>&1; then
        return 0
    fi
    cd "$BROWSER_DIR"
    CAMOFOX_PORT=9377 nohup npm start > "$BROWSER_LOG" 2>&1 &
    disown
    for i in $(seq 1 30); do
        if curl -sf "$HEALTH_URL" > /dev/null 2>&1; then
            return 0
        fi
        sleep 1
    done
    echo "WARNING: camofox-browser failed to start" >&2
    return 1
}

# ── Stop browser ──
stop_browser() {
    PID=$(lsof -ti:9377 2>/dev/null)
    if [ -n "$PID" ]; then
        kill $PID 2>/dev/null
        sleep 2
        kill -9 $PID 2>/dev/null
    fi
}

# ── Idle watchdog (background) ──
idle_watchdog() {
    while true; do
        sleep 60
        if [ ! -f "$ACTIVITY_FILE" ]; then
            # Activity file gone = MCP server stopped
            stop_browser
            break
        fi
        local last=$(stat -c %Y "$ACTIVITY_FILE" 2>/dev/null || echo 0)
        local now=$(date +%s)
        local idle=$((now - last))
        if [ "$idle" -gt "$IDLE_TIMEOUT" ]; then
            stop_browser
            rm -f "$ACTIVITY_FILE"
            break
        fi
    done
}

# ── Main ──
start_browser
touch "$ACTIVITY_FILE"
idle_watchdog &
WATCHDOG_PID=$!
disown

# Start the MCP server (blocks until Hermes closes it)
node "$MCP_BIN"
MCP_EXIT=$?

# Cleanup
kill $WATCHDOG_PID 2>/dev/null
rm -f "$ACTIVITY_FILE"
# Don't stop browser here — the watchdog or manual stop handles it
exit $MCP_EXIT
