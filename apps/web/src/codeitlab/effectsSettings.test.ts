import { describe, expect, it } from "vite-plus/test";

import { decodeCodeItLabEffects } from "./effectsSettings";

const DEFAULTS = {
  threeD: "medium",
  respectReducedMotion: true,
  maxFps: 30,
  sfxEnabled: false,
  sfxVolume: 0.35,
  sfxEvents: { click: true, send: true, success: true, error: true, ambient: false },
} as const;

describe("decodeCodeItLabEffects", () => {
  it("falls back to the defaults for anything that is not a record", () => {
    for (const value of [undefined, null, "high", 42, [], true]) {
      expect(decodeCodeItLabEffects(value)).toEqual(DEFAULTS);
    }
  });

  it("keeps valid choices and rejects unknown quality levels", () => {
    expect(decodeCodeItLabEffects({ threeD: "off" }).threeD).toBe("off");
    expect(decodeCodeItLabEffects({ threeD: "high" }).threeD).toBe("high");
    expect(decodeCodeItLabEffects({ threeD: "ultra" }).threeD).toBe("medium");
    expect(decodeCodeItLabEffects({ threeD: 3 }).threeD).toBe("medium");
  });

  it("clamps the frame cap to 15–60 and rounds it", () => {
    expect(decodeCodeItLabEffects({ maxFps: 120 }).maxFps).toBe(60);
    expect(decodeCodeItLabEffects({ maxFps: 1 }).maxFps).toBe(15);
    expect(decodeCodeItLabEffects({ maxFps: 29.6 }).maxFps).toBe(30);
    expect(decodeCodeItLabEffects({ maxFps: Number.NaN }).maxFps).toBe(30);
    expect(decodeCodeItLabEffects({ maxFps: "60" }).maxFps).toBe(30);
  });

  it("clamps the SFX volume to 0–1 and never trusts a non-number", () => {
    expect(decodeCodeItLabEffects({ sfxVolume: -2 }).sfxVolume).toBe(0);
    expect(decodeCodeItLabEffects({ sfxVolume: 4 }).sfxVolume).toBe(1);
    expect(decodeCodeItLabEffects({ sfxVolume: 0.5 }).sfxVolume).toBe(0.5);
    expect(decodeCodeItLabEffects({ sfxVolume: "loud" }).sfxVolume).toBe(0.35);
  });

  it("fills per-event switches from the defaults and drops unknown keys", () => {
    expect(
      decodeCodeItLabEffects({ sfxEvents: { click: false, ambient: true } }).sfxEvents,
    ).toEqual({
      click: false,
      send: true,
      success: true,
      error: true,
      ambient: true,
    });
    expect(
      decodeCodeItLabEffects({ sfxEvents: { click: "no", unknown: true } as never }).sfxEvents,
    ).toEqual(DEFAULTS.sfxEvents);
  });

  it("keeps sound off until the user enables it", () => {
    expect(decodeCodeItLabEffects({}).sfxEnabled).toBe(false);
    expect(decodeCodeItLabEffects({ sfxEnabled: true }).sfxEnabled).toBe(true);
  });

  it("treats a non-boolean switch as unset", () => {
    expect(decodeCodeItLabEffects({ respectReducedMotion: "yes" }).respectReducedMotion).toBe(true);
    expect(decodeCodeItLabEffects({ sfxEnabled: 0 }).sfxEnabled).toBe(false);
    expect(decodeCodeItLabEffects({ respectReducedMotion: false }).respectReducedMotion).toBe(
      false,
    );
  });
});
