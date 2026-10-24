import { getCodeitlabEffectsSnapshot } from "./effectsSettings";

/**
 * WebAudio-synthesised CodeitLab SFX. No binary assets: every sound is an
 * oscillator envelope through one master gain. The engine stays inert until a
 * user gesture creates/resumes the AudioContext (browser autoplay policy), and
 * every play call re-reads the persisted Effects settings so the panel's mute
 * and volume controls apply immediately.
 */
export type CodeitlabSfxName = "click" | "send" | "success" | "error";

const THROTTLE_MS: Readonly<Record<CodeitlabSfxName, number>> = {
  click: 45,
  send: 120,
  success: 250,
  error: 250,
};

let context: AudioContext | null = null;
let master: GainNode | null = null;
let unlocked = false;
let ambient: AmbientHandle | null = null;
const lastPlayedAt = new Map<CodeitlabSfxName, number>();

interface AmbientHandle {
  readonly stop: () => void;
}

function audioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (context !== null) return context;
  if (typeof globalThis.AudioContext !== "function") return null;
  try {
    context = new globalThis.AudioContext();
  } catch {
    return null;
  }
  master = context.createGain();
  master.gain.value = getCodeitlabEffectsSnapshot().sfxVolume;
  master.connect(context.destination);
  return context;
}

function applyMasterVolume(): void {
  if (context === null || master === null) return;
  const { sfxVolume } = getCodeitlabEffectsSnapshot();
  master.gain.setTargetAtTime(sfxVolume, context.currentTime, 0.03);
}

interface ToneSpec {
  readonly type: OscillatorType;
  readonly frequency: number;
  readonly endFrequency?: number;
  readonly duration: number;
  readonly gain: number;
  readonly delay?: number;
  readonly filterFrequency?: number;
  readonly detune?: number;
}

function scheduleTone(ctx: AudioContext, destination: AudioNode, spec: ToneSpec): void {
  const start = ctx.currentTime + (spec.delay ?? 0);
  const oscillator = ctx.createOscillator();
  oscillator.type = spec.type;
  oscillator.frequency.setValueAtTime(spec.frequency, start);
  if (spec.endFrequency !== undefined) {
    oscillator.frequency.exponentialRampToValueAtTime(spec.endFrequency, start + spec.duration);
  }
  if (spec.detune !== undefined) oscillator.detune.setValueAtTime(spec.detune, start);
  const envelope = ctx.createGain();
  envelope.gain.setValueAtTime(0.0001, start);
  envelope.gain.exponentialRampToValueAtTime(spec.gain, start + 0.008);
  envelope.gain.exponentialRampToValueAtTime(0.0001, start + spec.duration);
  let tail: AudioNode = envelope;
  if (spec.filterFrequency !== undefined) {
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(spec.filterFrequency, start);
    envelope.connect(filter);
    tail = filter;
  }
  oscillator.connect(envelope);
  tail.connect(destination);
  oscillator.start(start);
  oscillator.stop(start + spec.duration + 0.02);
}

function synth(name: CodeitlabSfxName, ctx: AudioContext, out: AudioNode): void {
  switch (name) {
    case "click":
      scheduleTone(ctx, out, {
        type: "triangle",
        frequency: 1320,
        endFrequency: 880,
        duration: 0.045,
        gain: 0.08,
      });
      return;
    case "send":
      scheduleTone(ctx, out, {
        type: "sine",
        frequency: 520,
        endFrequency: 780,
        duration: 0.11,
        gain: 0.1,
      });
      scheduleTone(ctx, out, {
        type: "sine",
        frequency: 780,
        endFrequency: 1040,
        duration: 0.09,
        gain: 0.06,
        delay: 0.05,
      });
      return;
    case "success":
      for (const [index, frequency] of [659.25, 830.61, 987.77].entries()) {
        scheduleTone(ctx, out, {
          type: "sine",
          frequency,
          duration: 0.16,
          gain: 0.07,
          delay: index * 0.055,
        });
      }
      return;
    case "error":
      scheduleTone(ctx, out, {
        type: "sawtooth",
        frequency: 220,
        endFrequency: 116,
        duration: 0.24,
        gain: 0.07,
        filterFrequency: 620,
      });
      scheduleTone(ctx, out, {
        type: "sawtooth",
        frequency: 233,
        endFrequency: 123,
        duration: 0.24,
        gain: 0.05,
        detune: 9,
        filterFrequency: 520,
      });
      return;
  }
}

/** Must be called from a user gesture before any sound can play. */
export function unlockCodeitlabAudio(): void {
  const ctx = audioContext();
  if (ctx === null) return;
  unlocked = true;
  if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
  syncCodeitlabAmbient();
}

export function playCodeitlabSfx(name: CodeitlabSfxName): void {
  const settings = getCodeitlabEffectsSnapshot();
  if (!settings.sfxEnabled || !settings.sfxEvents[name]) return;
  const now = Date.now();
  if (now - (lastPlayedAt.get(name) ?? 0) < THROTTLE_MS[name]) return;
  lastPlayedAt.set(name, now);
  const ctx = audioContext();
  if (ctx === null || master === null) return;
  if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
  applyMasterVolume();
  synth(name, ctx, master);
}

/** Preview ignores the per-event toggles so the Effects page can audition a sound. */
export function previewCodeitlabSfx(name: CodeitlabSfxName): void {
  const ctx = audioContext();
  if (ctx === null || master === null) return;
  unlocked = true;
  if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
  applyMasterVolume();
  synth(name, ctx, master);
}

export function stopCodeitlabAmbient(): void {
  const handle = ambient;
  ambient = null;
  handle?.stop();
}

/** Starts or stops the ambient hum to match the persisted Effects settings. */
export function syncCodeitlabAmbient(): void {
  const settings = getCodeitlabEffectsSnapshot();
  const shouldPlay = settings.sfxEnabled && settings.sfxEvents.ambient;
  if (!shouldPlay || !unlocked) {
    stopCodeitlabAmbient();
    return;
  }
  if (ambient !== null) {
    applyMasterVolume();
    return;
  }
  const ctx = audioContext();
  if (ctx === null || master === null) return;
  const now = ctx.currentTime;
  const hum = ctx.createGain();
  hum.gain.setValueAtTime(0.0001, now);
  hum.gain.exponentialRampToValueAtTime(0.02, now + 1.2);
  const lowpass = ctx.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.value = 320;
  hum.connect(lowpass);
  lowpass.connect(master);

  const oscillators = [
    { frequency: 55, detune: -4 },
    { frequency: 82.5, detune: 5 },
    { frequency: 110, detune: -9 },
  ].map(({ frequency, detune }) => {
    const oscillator = ctx.createOscillator();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    oscillator.detune.value = detune;
    oscillator.connect(hum);
    oscillator.start(now);
    return oscillator;
  });

  // A very slow breathing gain keeps the hum from sounding like a stuck test
  // tone without adding per-frame JS work: the LFO runs on the audio thread.
  const lfo = ctx.createOscillator();
  lfo.type = "sine";
  lfo.frequency.value = 0.05;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0.006;
  lfo.connect(lfoGain);
  lfoGain.connect(hum.gain);
  lfo.start(now);

  ambient = {
    stop: () => {
      const stopAt = ctx.currentTime + 0.25;
      hum.gain.cancelScheduledValues(ctx.currentTime);
      hum.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.08);
      for (const oscillator of oscillators) oscillator.stop(stopAt);
      lfo.stop(stopAt);
      window.setTimeout(() => {
        hum.disconnect();
        lowpass.disconnect();
      }, 400);
    },
  };
}

/** Ambient hum is meaningless while the tab is hidden. */
export function setCodeitlabAudioVisible(visible: boolean): void {
  if (!visible) {
    stopCodeitlabAmbient();
    return;
  }
  syncCodeitlabAmbient();
}
