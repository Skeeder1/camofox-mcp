/**
 * Layer configuration — defines which tool families are registered with the
 * MCP server.
 *
 * Profiles:
 *   - lean: minimal tool surface optimized for LLM agents (L0 + L1)
 *   - full: every tool registered (legacy behavior, default for back-compat)
 *   - custom: explicit per-layer flags
 *
 * Each layer can be force-toggled by an env var (highest priority) or by a
 * key in ~/.camofox-mcp/config.yaml (e.g. `layers_semantic: true`).
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type Profile = "lean" | "full" | "custom";

export interface LayerFlags {
  /** L0 — always on. core navigation, snapshot, screenshot. */
  core: true;
  /** L1 — semantic LLM-aware tools: extract, act, observe, execute. */
  semantic: boolean;
  /** L2 — stealth helpers: human_motion, human_typing, detect_challenge. */
  stealth: boolean;
  /** L3 — vision: SoM, vision_extract, omniparser. */
  vision: boolean;
  /** L4 — action_cache (Stagehand-style replay). */
  cache: boolean;
  /** L5 — pure-network helpers: http_request via curl_cffi, proxy pools. */
  network: boolean;
  /** Legacy 35 tools — currently registered as a block. */
  legacy: boolean;
}

export interface LayersConfig {
  profile: Profile;
  flags: LayerFlags;
}

const YAML_CONFIG_PATH = join(homedir(), ".camofox-mcp", "config.yaml");

function isFalsy(value: string | undefined): boolean {
  if (!value) return true;
  return ["false", "0", "no", "n", "off"].includes(value.trim().toLowerCase());
}

function isTruthy(value: string | undefined): boolean {
  if (!value) return false;
  return ["true", "1", "yes", "y", "on"].includes(value.trim().toLowerCase());
}

function loadYamlConfig(path: string = YAML_CONFIG_PATH): Record<string, string> {
  try {
    const text = readFileSync(path, "utf-8");
    const result: Record<string, string> = {};
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const colon = line.indexOf(":");
      if (colon === -1) continue;
      const key = line.slice(0, colon).trim();
      const value = line.slice(colon + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
      if (key) result[key] = value;
    }
    return result;
  } catch {
    return {};
  }
}

function profileDefaults(profile: Profile): LayerFlags {
  switch (profile) {
    case "lean":
      return {
        core: true,
        semantic: true,
        stealth: false,
        vision: false,
        cache: false,
        network: false,
        legacy: false,
      };
    case "full":
      return {
        core: true,
        semantic: true,
        stealth: false,
        vision: false,
        cache: false,
        network: false,
        legacy: true,
      };
    case "custom":
      return {
        core: true,
        semantic: true,
        stealth: false,
        vision: false,
        cache: false,
        network: false,
        legacy: true,
      };
  }
}

function pickProfile(value: string | undefined): Profile {
  const v = (value ?? "").trim().toLowerCase();
  if (v === "lean" || v === "full" || v === "custom") return v;
  // Default = full for backwards compat. Every existing tool keeps working.
  return "full";
}

function applyOverride(
  current: boolean,
  envValue: string | undefined,
  yamlValue: string | undefined,
): boolean {
  if (isTruthy(envValue)) return true;
  if (envValue !== undefined && isFalsy(envValue) && envValue !== "") return false;
  if (isTruthy(yamlValue)) return true;
  if (yamlValue !== undefined && isFalsy(yamlValue) && yamlValue !== "") return false;
  return current;
}

export function loadLayersConfig(
  env: NodeJS.ProcessEnv = process.env,
  yaml: Record<string, string> = loadYamlConfig(),
): LayersConfig {
  const profile = pickProfile(env.CAMOFOX_PROFILE ?? yaml.profile);
  const defaults = profileDefaults(profile);

  const flags: LayerFlags = {
    core: true,
    semantic: applyOverride(defaults.semantic, env.CAMOFOX_LAYER_SEMANTIC, yaml.layers_semantic),
    stealth: applyOverride(defaults.stealth, env.CAMOFOX_LAYER_STEALTH, yaml.layers_stealth),
    vision: applyOverride(defaults.vision, env.CAMOFOX_LAYER_VISION, yaml.layers_vision),
    cache: applyOverride(defaults.cache, env.CAMOFOX_LAYER_CACHE, yaml.layers_cache),
    network: applyOverride(defaults.network, env.CAMOFOX_LAYER_NETWORK, yaml.layers_network),
    legacy: applyOverride(defaults.legacy, env.CAMOFOX_LAYER_LEGACY, yaml.layers_legacy),
  };

  return { profile, flags };
}
