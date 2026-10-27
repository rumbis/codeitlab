import { useAtomValue } from "@effect/atom-react";
import {
  DEFAULT_CODEITLAB_SETTINGS,
  type CodeItLabEffectsSettings,
  type CodeItLabSettings,
  type CodeItLabSfxEventSettings,
  type EnvironmentId,
} from "@codeitlab/contracts";
import { useEffect, useRef, useSyncExternalStore } from "react";

import { primaryEnvironmentIdAtom } from "../state/primaryEnvironment";
import { primaryServerSettingsAtom, serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";

/**
 * Client copy of the Effects block. The server copy is authoritative once an
 * environment is connected, but the panel and the 3D/SFX runtime must work
 * before the first settings stream arrives and on servers that do not expose
 * the CodeItLab settings yet, so the local copy is the render source and the
 * server copy is mirrored into it on connect.
 */
const STORAGE_KEY = "codeitlab:effects:v1";
const DIRTY_KEY = "codeitlab:effects-local-dirty:v1";

const DEFAULT_EFFECTS = DEFAULT_CODEITLAB_SETTINGS.effects;

type EffectsQuality = CodeItLabEffectsSettings["threeD"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeQuality(value: unknown): EffectsQuality {
  return value === "off" || value === "low" || value === "medium" || value === "high"
    ? value
    : DEFAULT_EFFECTS.threeD;
}

function decodeSfxEvents(value: unknown): CodeItLabSfxEventSettings {
  if (!isRecord(value)) return DEFAULT_EFFECTS.sfxEvents;
  return {
    click: typeof value.click === "boolean" ? value.click : DEFAULT_EFFECTS.sfxEvents.click,
    send: typeof value.send === "boolean" ? value.send : DEFAULT_EFFECTS.sfxEvents.send,
    success: typeof value.success === "boolean" ? value.success : DEFAULT_EFFECTS.sfxEvents.success,
    error: typeof value.error === "boolean" ? value.error : DEFAULT_EFFECTS.sfxEvents.error,
    ambient: typeof value.ambient === "boolean" ? value.ambient : DEFAULT_EFFECTS.sfxEvents.ambient,
  };
}

export function decodeCodeItLabEffects(value: unknown): CodeItLabEffectsSettings {
  if (!isRecord(value)) return DEFAULT_EFFECTS;
  return {
    threeD: decodeQuality(value.threeD),
    respectReducedMotion:
      typeof value.respectReducedMotion === "boolean"
        ? value.respectReducedMotion
        : DEFAULT_EFFECTS.respectReducedMotion,
    maxFps:
      typeof value.maxFps === "number" && Number.isFinite(value.maxFps)
        ? Math.min(Math.max(Math.round(value.maxFps), 15), 60)
        : DEFAULT_EFFECTS.maxFps,
    sfxEnabled:
      typeof value.sfxEnabled === "boolean" ? value.sfxEnabled : DEFAULT_EFFECTS.sfxEnabled,
    sfxVolume:
      typeof value.sfxVolume === "number" && Number.isFinite(value.sfxVolume)
        ? Math.min(Math.max(value.sfxVolume, 0), 1)
        : DEFAULT_EFFECTS.sfxVolume,
    sfxEvents: decodeSfxEvents(value.sfxEvents),
  };
}

function readStoredJson(key: string): unknown {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

function hasLocalEdits(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(DIRTY_KEY) === "1";
  } catch {
    return false;
  }
}

let snapshot: CodeItLabEffectsSettings | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function getCodeItLabEffectsSnapshot(): CodeItLabEffectsSettings {
  if (snapshot === null) {
    snapshot = decodeCodeItLabEffects(readStoredJson(STORAGE_KEY));
  }
  return snapshot;
}

function persist(next: CodeItLabEffectsSettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.localStorage.setItem(DIRTY_KEY, "1");
  } catch {
    // Private browsing or a full quota: the in-memory snapshot still works.
  }
}

function replaceSnapshot(next: CodeItLabEffectsSettings): void {
  snapshot = next;
  emit();
}

export function updateCodeItLabEffects(
  patch: Partial<CodeItLabEffectsSettings>,
): CodeItLabEffectsSettings {
  const current = getCodeItLabEffectsSnapshot();
  const next = decodeCodeItLabEffects({ ...current, ...patch });
  persist(next);
  replaceSnapshot(next);
  return next;
}

/** Mirrors the environment's saved Effects block into the client copy. */
export function adoptCodeItLabEffects(value: unknown): void {
  const next = decodeCodeItLabEffects(value);
  const current = getCodeItLabEffectsSnapshot();
  if (JSON.stringify(current) === JSON.stringify(next)) return;
  replaceSnapshot(next);
}

export function subscribeCodeItLabEffects(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useCodeItLabEffectsSettings(): CodeItLabEffectsSettings {
  return useSyncExternalStore(
    subscribeCodeItLabEffects,
    getCodeItLabEffectsSnapshot,
    getCodeItLabEffectsSnapshot,
  );
}

/** True when the user has touched Effects on this device. */
export function codeitlabEffectsHaveLocalEdits(): boolean {
  return hasLocalEdits();
}

/**
 * Adopts the connected environment's saved Effects once per environment. A
 * device with local edits keeps them: offline tweaks must not be reverted by
 * the first settings snapshot that arrives after reconnecting.
 */
export function useCodeItLabEffectsAdoption(): void {
  const environmentId = useAtomValue(primaryEnvironmentIdAtom);
  const serverEffects = useAtomValue(primaryServerSettingsAtom).codeitlab.effects;
  const adoptedFor = useRef<EnvironmentId | null>(null);
  useEffect(() => {
    if (environmentId === null) {
      adoptedFor.current = null;
      return;
    }
    if (adoptedFor.current === environmentId) return;
    adoptedFor.current = environmentId;
    if (hasLocalEdits()) return;
    adoptCodeItLabEffects(serverEffects);
  }, [environmentId, serverEffects]);
}

/**
 * Writes Effects locally and mirrors the whole CodeItLab settings block to the
 * connected environment. The panel stays usable when the server has not wired
 * the settings patch yet: the local write always succeeds.
 */
export function useCodeItLabEffectsWriter(): (
  patch: Partial<CodeItLabEffectsSettings>,
) => CodeItLabEffectsSettings {
  const environmentId = useAtomValue(primaryEnvironmentIdAtom);
  const codeitlab = useAtomValue(primaryServerSettingsAtom).codeitlab;
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    reportFailure: false,
  });
  return (patch) => {
    const next = updateCodeItLabEffects(patch);
    if (environmentId !== null) {
      void updateSettings({
        environmentId,
        input: { patch: { codeitlab: { ...codeitlab, effects: next } } },
      });
    }
    return next;
  };
}

/**
 * Writes any other CodeItLab settings block through the same whole-struct
 * settings patch. Pages keep a local draft so the controls stay responsive
 * when no environment is connected; the environment copy is best-effort.
 */
export function useCodeItLabSettingsWriter(): {
  readonly codeitlab: CodeItLabSettings;
  readonly environmentId: EnvironmentId | null;
  readonly update: (patch: Partial<CodeItLabSettings>) => CodeItLabSettings;
} {
  const environmentId = useAtomValue(primaryEnvironmentIdAtom);
  const codeitlab = useAtomValue(primaryServerSettingsAtom).codeitlab;
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    reportFailure: false,
  });
  const update = (patch: Partial<CodeItLabSettings>) => {
    const next = { ...codeitlab, ...patch };
    if (environmentId !== null) {
      void updateSettings({ environmentId, input: { patch: { codeitlab: next } } });
    }
    return next;
  };
  return { codeitlab, environmentId, update };
}
