import { describe, expect, it } from "vite-plus/test";

import { decodeCodeitlabEffects } from "./effectsSettings";

const DEFAULTS = {
  threeD: "medium",
  respectReducedMotion: true,
  maxFps: 30,
  sfxEnabled: true,
  sfxVolume: 0.35,
  sfxEvents: { click: true, send: true, success: true, error: true, ambient: false },
} as const;

describe("decodeCodeitlabEffects", () => {
  it("falls back to the defaults for anything that is not a record", () => {
    for (const value of [undefined, null, "high", 42, [], true]) {
      expect(decodeCodeitlabEffects(value)).toEqual(DEFAULTS);
    }
  });

  it("keeps valid choices and rejects unknown quality levels", () => {
    expect(decodeCodeitlabEffects({ threeD: "off" }).threeD).toBe("off");
    expect(decodeCodeitlabEffects({ threeD: "high" }).threeD).toBe("high");
    expect(decodeCodeitlabEffects({ threeD: "ultra" }).threeD).toBe("medium");
    expect(decodeCodeitlabEffects({ threeD: 3 }).threeD).toBe("medium");
  });

  it("clamps the frame cap to 15–60 and rounds it", () => {
    expect(decodeCodeitlabEffects({ maxFps: 120 }).maxFps).toBe(60);
    expect(decodeCodeitlabEffects({ maxFps: 1 }).maxFps).toBe(15);
    expect(decodeCodeitlabEffects({ maxFps: 29.6 }).maxFps).toBe(30);
    expect(decodeCodeitlabEffects({ maxFps: Number.NaN }).maxFps).toBe(30);
    expect(decodeCodeitlabEffects({ maxFps: "60" }).maxFps).toBe(30);
  });

  it("clamps the SFX volume to 0–1 and never trusts a non-number", () => {
    expect(decodeCodeitlabEffects({ sfxVolume: -2 }).sfxVolume).toBe(0);
    expect(decodeCodeitlabEffects({ sfxVolume: 4 }).sfxVolume).toBe(1);
    expect(decodeCodeitlabEffects({ sfxVolume: 0.5 }).sfxVolume).toBe(0.5);
    expect(decodeCodeitlabEffects({ sfxVolume: "loud" }).sfxVolume).toBe(0.35);
  });

  it("fills per-event switches from the defaults and drops unknown keys", () => {
    expect(
      decodeCodeitlabEffects({ sfxEvents: { click: false, ambient: true } }).sfxEvents,
    ).toEqual({
      click: false,
      send: true,
      success: true,
      error: true,
      ambient: true,
    });
    expect(
      decodeCodeitlabEffects({ sfxEvents: { click: "no", unknown: true } as never }).sfxEvents,
    ).toEqual(DEFAULTS.sfxEvents);
  });

  it("treats a non-boolean switch as unset", () => {
    expect(decodeCodeitlabEffects({ respectReducedMotion: "yes" }).respectReducedMotion).toBe(true);
    expect(decodeCodeitlabEffects({ sfxEnabled: 0 }).sfxEnabled).toBe(true);
    expect(decodeCodeitlabEffects({ respectReducedMotion: false }).respectReducedMotion).toBe(
      false,
    );
  });
});
