import { describe, it, expect } from "vitest";

import { loadLayersConfig } from "../layers.js";

describe("layers — loadLayersConfig", () => {
  it("defaults to full profile when nothing is set", () => {
    const cfg = loadLayersConfig({} as NodeJS.ProcessEnv, {});
    expect(cfg.profile).toBe("full");
    expect(cfg.flags.core).toBe(true);
    expect(cfg.flags.legacy).toBe(true);
    expect(cfg.flags.semantic).toBe(true);
    expect(cfg.flags.stealth).toBe(false);
    expect(cfg.flags.vision).toBe(false);
  });

  it("lean profile disables legacy + heavy layers", () => {
    const cfg = loadLayersConfig({ CAMOFOX_PROFILE: "lean" } as NodeJS.ProcessEnv, {});
    expect(cfg.profile).toBe("lean");
    expect(cfg.flags.legacy).toBe(false);
    expect(cfg.flags.semantic).toBe(true);
    expect(cfg.flags.cache).toBe(false);
  });

  it("YAML profile is honored when env is empty", () => {
    const cfg = loadLayersConfig({} as NodeJS.ProcessEnv, { profile: "lean" });
    expect(cfg.profile).toBe("lean");
  });

  it("env profile overrides YAML profile", () => {
    const cfg = loadLayersConfig({ CAMOFOX_PROFILE: "full" } as NodeJS.ProcessEnv, {
      profile: "lean",
    });
    expect(cfg.profile).toBe("full");
  });

  it("env layer flag overrides profile default", () => {
    const cfg = loadLayersConfig(
      { CAMOFOX_PROFILE: "lean", CAMOFOX_LAYER_VISION: "true" } as NodeJS.ProcessEnv,
      {},
    );
    expect(cfg.flags.vision).toBe(true);
  });

  it("env layer flag can disable a profile default", () => {
    const cfg = loadLayersConfig(
      { CAMOFOX_PROFILE: "full", CAMOFOX_LAYER_LEGACY: "false" } as NodeJS.ProcessEnv,
      {},
    );
    expect(cfg.flags.legacy).toBe(false);
  });

  it("YAML layer flag works", () => {
    const cfg = loadLayersConfig({} as NodeJS.ProcessEnv, {
      profile: "lean",
      layers_vision: "true",
    });
    expect(cfg.flags.vision).toBe(true);
  });

  it("invalid profile falls back to full", () => {
    const cfg = loadLayersConfig({ CAMOFOX_PROFILE: "wibble" } as NodeJS.ProcessEnv, {});
    expect(cfg.profile).toBe("full");
  });

  it("custom profile starts from same baseline as full", () => {
    const cfg = loadLayersConfig({ CAMOFOX_PROFILE: "custom" } as NodeJS.ProcessEnv, {});
    expect(cfg.profile).toBe("custom");
    expect(cfg.flags.core).toBe(true);
  });

  it("core layer is always true", () => {
    const cfg = loadLayersConfig(
      { CAMOFOX_PROFILE: "lean" } as NodeJS.ProcessEnv,
      {},
    );
    expect(cfg.flags.core).toBe(true);
  });
});
