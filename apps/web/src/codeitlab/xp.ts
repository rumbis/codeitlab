import type {
  CodeItLabXpRecordInput,
  CodeItLabXpRecordResult,
  CodeItLabXpState,
} from "@codeitlab/contracts";
import { WS_METHODS } from "@codeitlab/contracts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "@codeitlab/client-runtime/state/runtime";
import * as Option from "effect/Option";
import { useEffect, useRef } from "react";

import { connectionAtomRuntime } from "../connection/runtime";
import { useThreadRouteRef } from "../hooks/useThreadRouteTarget";
import { usePrimaryEnvironmentId } from "../state/environments";
import { useEnvironmentQuery } from "../state/query";
import { useEnvironmentThread } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";

/**
 * Client half of XP. The server owns the ledger and the streak; this module
 * reads the computed state, records finished events, and turns the state into
 * the few strings the send button renders.
 */

export const codeitlabXpStateQuery = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "codeitlab:xp:state",
  tag: WS_METHODS.codeitlabXpState,
  staleTimeMs: 15_000,
  idleTtlMs: 120_000,
});

export const codeitlabXpRecordCommand = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "codeitlab:xp:record",
  tag: WS_METHODS.codeitlabXpRecord,
});

export interface CodeItLabXpView {
  /** `null` until the server answers; the chip renders nothing then. */
  readonly state: CodeItLabXpState | null;
  readonly refresh: () => void;
  readonly record: (input: CodeItLabXpRecordInput) => Promise<CodeItLabXpRecordResult | null>;
}

export function useCodeItLabXp(): CodeItLabXpView {
  const environmentId = usePrimaryEnvironmentId();
  const query = useEnvironmentQuery(
    environmentId === null ? null : codeitlabXpStateQuery({ environmentId, input: {} }),
  );
  const recordCommand = useAtomCommand(codeitlabXpRecordCommand, { reportFailure: false });
  return {
    state: query.data,
    refresh: query.refresh,
    record: async (input) => {
      if (environmentId === null) return null;
      const result = await recordCommand({ environmentId, input });
      if (result._tag !== "Success") return null;
      // The record result carries the new state, but the query is the render
      // source; refresh it so the ring and the ledger cannot drift.
      query.refresh();
      return result.value;
    },
  };
}

/** Accessible name for the level ring. */
export function xpLevelAriaLabel(
  state: Pick<CodeItLabXpState, "level" | "xpIntoLevel" | "xpForNextLevel">,
): string {
  return `Level ${state.level}, ${state.xpIntoLevel} of ${state.xpForNextLevel} XP`;
}

/** Short streak label; a gap is stated plainly instead of showing "0". */
export function xpStreakLabel(state: Pick<CodeItLabXpState, "streakDays">): string {
  return state.streakDays > 0 ? `${state.streakDays}-day streak` : "no streak yet";
}

/** Clamped ring fill so a bad server number cannot draw outside the circle. */
export function xpRingProgress(state: Pick<CodeItLabXpState, "progress">): number {
  if (!Number.isFinite(state.progress)) return 0;
  return Math.min(Math.max(state.progress, 0), 1);
}

export function xpRingCircumference(radius: number): number {
  return 2 * Math.PI * radius;
}

/** Stroke offset for an SVG ring at `progress` 0..1. */
export function xpRingDashOffset(progress: number, radius: number): number {
  const clamped = Number.isFinite(progress) ? Math.min(Math.max(progress, 0), 1) : 0;
  return xpRingCircumference(radius) * (1 - clamped);
}

/**
 * XP actually added by an award. The server can add a daily bonus on the first
 * finished event of a day, so this reads the delta instead of assuming +10.
 */
export function xpAwardedAmount(
  previous: Pick<CodeItLabXpState, "totalXp"> | null,
  next: Pick<CodeItLabXpState, "totalXp">,
): number {
  if (previous === null) return 0;
  return Math.max(0, next.totalXp - previous.totalXp);
}

const IN_FLIGHT_RUN_STATUSES: ReadonlySet<string> = new Set([
  "preparing",
  "queued",
  "starting",
  "running",
  "waiting",
]);

/**
 * Records `turn-completed` once per run that this mount watched finish. A run
 * counts only after it was seen in flight: opening an old thread must not
 * backfill XP for turns that finished before the composer existed. The server
 * dedupes by event id, so a remount cannot double-award a run.
 */
export function useTurnCompletedRecording(
  record: (input: CodeItLabXpRecordInput) => Promise<CodeItLabXpRecordResult | null>,
): void {
  const threadRef = useThreadRouteRef();
  const thread = useEnvironmentThread(
    threadRef?.environmentId ?? null,
    threadRef?.threadId ?? null,
  );
  const runs = Option.getOrNull(thread.data)?.runs ?? [];
  const signature = runs.map((run) => `${run.id}:${run.status}`).join("|");
  const threadKey = threadRef === null ? "" : `${threadRef.environmentId}:${threadRef.threadId}`;
  const observedInFlight = useRef<ReadonlySet<string>>(new Set());
  const recorded = useRef<ReadonlySet<string>>(new Set());
  const lastThreadKey = useRef(threadKey);

  useEffect(() => {
    if (lastThreadKey.current !== threadKey) {
      lastThreadKey.current = threadKey;
      observedInFlight.current = new Set();
      recorded.current = new Set();
    }
    if (signature.length === 0) return;
    const inFlight = new Set(observedInFlight.current);
    const done = new Set(recorded.current);
    for (const entry of signature.split("|")) {
      const separator = entry.lastIndexOf(":");
      const runId = entry.slice(0, separator);
      const status = entry.slice(separator + 1);
      if (IN_FLIGHT_RUN_STATUSES.has(status)) {
        inFlight.add(runId);
        continue;
      }
      if (status !== "completed" || !inFlight.has(runId) || done.has(runId)) continue;
      done.add(runId);
      void record({ kind: "turn-completed", eventId: runId });
    }
    observedInFlight.current = inFlight;
    recorded.current = done;
  }, [signature, threadKey, record]);
}
