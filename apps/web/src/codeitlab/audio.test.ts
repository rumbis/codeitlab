import { describe, expect, it, vi } from "vite-plus/test";

import { playCodeItLabSfx } from "./audio";

const mock = vi.hoisted(() => ({
  snapshot: {
    sfxEnabled: false,
    sfxVolume: 0.35,
    sfxEvents: { click: true, send: true, success: true, error: true, ambient: false },
  },
  contexts: 0,
}));

vi.mock(import("./effectsSettings"), async (original) => ({
  ...(await original()),
  getCodeItLabEffectsSnapshot: (() => mock.snapshot) as never,
}));

/** Minimal AudioContext stub: the module only needs these calls to not throw. */
function installAudioContext(): void {
  mock.contexts = 0;
  class StubContext {
    readonly currentTime = 0;
    readonly destination = {};
    readonly state = "running";
    constructor() {
      mock.contexts += 1;
    }
    createGain() {
      return {
        gain: {
          value: 0,
          setTargetAtTime: () => {},
          setValueAtTime: () => {},
          exponentialRampToValueAtTime: () => {},
        },
        connect: () => {},
        disconnect: () => {},
      };
    }
    createOscillator() {
      return {
        type: "sine",
        frequency: {
          setValueAtTime: () => {},
          exponentialRampToValueAtTime: () => {},
        },
        detune: { setValueAtTime: () => {} },
        connect: () => {},
        start: () => {},
        stop: () => {},
      };
    }
    createBiquadFilter() {
      return { type: "lowpass", frequency: { setValueAtTime: () => {} }, connect: () => {} };
    }
    createBufferSource() {
      return { buffer: null, connect: () => {}, start: () => {}, stop: () => {} };
    }
    resume() {
      return Promise.resolve();
    }
    close() {
      return Promise.resolve();
    }
  }
  // The engine bails out when `window` is missing, which is the case in the node test runner.
  vi.stubGlobal("window", {});
  vi.stubGlobal("AudioContext", StubContext);
}

describe("CodeItLab SFX", () => {
  it("creates no audio context while sound is off", () => {
    installAudioContext();
    mock.snapshot = { ...mock.snapshot, sfxEnabled: false };
    playCodeItLabSfx("click");
    expect(mock.contexts).toBe(0);
    vi.unstubAllGlobals();
  });

  it("plays once sound is enabled", () => {
    installAudioContext();
    mock.snapshot = { ...mock.snapshot, sfxEnabled: true };
    playCodeItLabSfx("send");
    expect(mock.contexts).toBe(1);
    vi.unstubAllGlobals();
  });
});
