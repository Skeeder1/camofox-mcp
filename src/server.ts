import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createRequire } from "node:module";

import { CamofoxClient } from "./client.js";
import type { Config } from "./types.js";
import { registerBatchTools } from "./tools/batch.js";
import { registerHealthTools } from "./tools/health.js";
import { registerInteractionTools, registerPressKeyTool } from "./tools/interaction.js";
import { registerNavigationTools } from "./tools/navigation.js";
import { registerObservationTools } from "./tools/observation.js";
import { registerSmartSnapshotTools } from "./tools/smart-snapshot.js";
import { registerDownloadTools } from "./tools/downloads.js";
import { registerExtractionTools } from "./tools/extraction.js";
import { registerPresetTools } from "./tools/presets.js";
import { registerProfileTools } from "./tools/profiles.js";
import { registerSearchTools } from "./tools/search.js";
import { registerSemanticTools } from "./tools/semantic.js";
import { registerSessionTools } from "./tools/session.js";
import { registerTabsTools } from "./tools/tabs.js";
import { registerYouTubeTools } from "./tools/youtube.js";
import { registerPrompts } from "./prompts.js";
import { loadLayersConfig } from "./layers.js";

const require = createRequire(import.meta.url);
const pkg: { version: string } = require("../package.json");

export interface ToolDeps {
  client: CamofoxClient;
  config: Config;
}

export function createServer(config: Config): { server: McpServer; client: CamofoxClient } {
  const client = new CamofoxClient(config);

  const server = new McpServer({
    name: "camofox-mcp",
    version: pkg.version
  });

  const deps: ToolDeps = { client, config };

  const layers = loadLayersConfig();

  // L0 CORE — always on (health, tabs, navigation, sessions, downloads)
  registerHealthTools(server, deps);
  registerTabsTools(server, deps);
  registerNavigationTools(server, deps);
  registerSessionTools(server, deps);
  registerDownloadTools(server, deps);
  registerProfileTools(server, deps);

  // L1 SEMANTIC — extract, observe, act, find_element_by_prompt, execute
  if (layers.flags.semantic) {
    registerSemanticTools(server, deps);
  }

  // L_LEGACY — original snapshot/click/type/etc. tools (kept for back-compat)
  if (layers.flags.legacy) {
    registerInteractionTools(server, deps);
    registerPressKeyTool(server, deps);
    registerObservationTools(server, deps);
    registerSmartSnapshotTools(server, deps);
    registerExtractionTools(server, deps);
    registerSearchTools(server, deps);
    registerYouTubeTools(server, deps);
    registerBatchTools(server, deps);
    registerPresetTools(server, deps);
  }

  registerPrompts(server, deps);

  return { server, client };
}
