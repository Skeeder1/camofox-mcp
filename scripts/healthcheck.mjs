#!/usr/bin/env node
/**
 * Probe a running camofox-mcp server and report whether it is actually usable.
 *
 * `systemctl is-active` only proves a process exists. This stack has two layers
 * and either can fail while the other looks fine:
 *
 *   camofox-mcp (:8101)  ->  camofox-browser (:9377)  ->  Camoufox
 *
 * The adapter can answer MCP perfectly while the browser server behind it is
 * gone, in which case every navigation fails and nothing restarts. So this
 * checks both: the MCP contract (initialize + tools/list), then the
 * `server_status` tool, which reports whether the browser is reachable.
 *
 * Exit codes are shaped for systemd:
 *   0  healthy
 *   1  MCP reachable but broken, or browser server unreachable
 *   2  MCP not reachable at all
 *
 *   node scripts/healthcheck.mjs
 *   node scripts/healthcheck.mjs --url http://127.0.0.1:8101/mcp --quiet
 *   node scripts/healthcheck.mjs --allow-browser-down   # adapter-only check
 */

const args = process.argv.slice(2);
const getFlag = (name) => args.includes(name);
const getOpt = (name, fallback) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const URL_ = getOpt("--url", "http://127.0.0.1:8101/mcp");
const TIMEOUT = Number(getOpt("--timeout", "15000"));
const QUIET = getFlag("--quiet");
const ALLOW_BROWSER_DOWN = getFlag("--allow-browser-down");
const PROTOCOL_VERSION = "2025-06-18";

const say = (msg) => { if (!QUIET) console.log(msg); };
const fail = (code, msg) => { console.error(msg); process.exit(code); };

let sessionId = null;
let nextId = 0;

async function rpc(method, params) {
  const isNotification = method.startsWith("notifications/");
  const body = { jsonrpc: "2.0", method, ...(params ? { params } : {}) };
  if (!isNotification) body.id = ++nextId;

  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;

  const res = await fetch(URL_, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!sessionId) sessionId = res.headers.get("mcp-session-id");
  if (isNotification) return null;

  const text = await res.text();
  // Streamable HTTP answers as SSE frames; the last data: line is the message.
  const line = text.split("\n").reverse().find((l) => l.startsWith("data: "));
  return JSON.parse(line ? line.slice(6) : text);
}

try {
  const init = await rpc("initialize", {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "healthcheck", version: "1.0" },
  });
  if (!init?.result) fail(1, `BAD_HANDSHAKE ${URL_}: ${JSON.stringify(init)}`);
  const info = init.result.serverInfo ?? {};
  say(`server   : ${info.name} ${info.version}`);

  await rpc("notifications/initialized");

  const listing = await rpc("tools/list");
  const tools = (listing?.result?.tools ?? []).map((t) => t.name);
  if (tools.length === 0) fail(1, "NO_TOOLS: server listed zero tools");
  say(`tools    : ${tools.length}`);

  // The adapter is fine. Now check the browser server behind it, which is where
  // navigation actually happens and which fails independently.
  if (!tools.includes("server_status")) {
    say("browser  : not checked (server_status not exposed by this layer profile)");
    say("status   : healthy");
    process.exit(0);
  }

  const status = await rpc("tools/call", { name: "server_status", arguments: {} });
  const raw = status?.result?.content?.find((c) => c.type === "text")?.text ?? "{}";
  let parsed = {};
  try { parsed = JSON.parse(raw); } catch { /* keep {} and fall through */ }

  const reachable = parsed.reachable ?? parsed.running ?? false;
  say(`browser  : reachable=${reachable} version=${parsed.version ?? "?"} tabs=${parsed.activeTabCount ?? "?"}`);

  if (!reachable && !ALLOW_BROWSER_DOWN) {
    fail(1, `BROWSER_UNREACHABLE: camofox-browser is not answering (${raw.slice(0, 200)})`);
  }

  say("status   : healthy");
  process.exit(0);
} catch (err) {
  const transport = err?.name === "TimeoutError" || err?.cause?.code === "ECONNREFUSED";
  fail(transport ? 2 : 1, `${transport ? "UNREACHABLE" : "ERROR"} ${URL_}: ${err.message}`);
}
