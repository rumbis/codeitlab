import type { CodeitlabShortsClip, CodeitlabShortsJobState } from "@t3tools/contracts";

/**
 * Pure Shorts-job display logic and the localStorage contract for tracked job
 * ids. The engine is polled through the server, so everything here is about
 * what the user sees, not about the OpenShorts API.
 */

export const SHORTS_JOBS_STORAGE_KEY = "codeitlab.shorts.jobs";
export const SHORTS_JOBS_CAP = 20;
export const SHORTS_JOB_POLL_MS = 15_000;
export const SHORTS_LOG_TAIL = 8;

const STATE_LABELS: Readonly<Record<CodeitlabShortsJobState, string>> = {
  queued: "Queued",
  processing: "Processing",
  completed: "Completed",
  failed: "Failed",
  unknown: "Unknown",
};

type StateBadgeVariant = "success" | "warning" | "error" | "info" | "secondary";

const STATE_VARIANTS: Readonly<Record<CodeitlabShortsJobState, StateBadgeVariant>> = {
  queued: "secondary",
  processing: "info",
  completed: "success",
  failed: "error",
  unknown: "warning",
};

export function shortsStateLabel(state: CodeitlabShortsJobState): string {
  return STATE_LABELS[state];
}

export function shortsStateVariant(state: CodeitlabShortsJobState): StateBadgeVariant {
  return STATE_VARIANTS[state];
}

/** Only these states keep the poller alive; `unknown` is a final answer we cannot improve on. */
export function isShortsJobActive(state: CodeitlabShortsJobState): boolean {
  return state === "queued" || state === "processing";
}

export function shortsUnknownStateExplanation(engineStatus: string | undefined): string {
  return engineStatus === undefined
    ? "Unknown — the engine returned a status we don't recognise."
    : `Unknown — the engine returned "${engineStatus}", which we don't recognise.`;
}

export function tailShortsLogs(
  logs: ReadonlyArray<string>,
  limit = SHORTS_LOG_TAIL,
): ReadonlyArray<string> {
  if (limit <= 0) return [];
  return logs.slice(-limit);
}

export function addTrackedShortsJob(
  ids: ReadonlyArray<string>,
  jobId: string,
  cap = SHORTS_JOBS_CAP,
): ReadonlyArray<string> {
  const trimmed = jobId.trim();
  if (trimmed.length === 0) return ids;
  const next = [trimmed, ...ids.filter((id) => id !== trimmed)];
  return next.slice(0, cap);
}

export function parseTrackedShortsJobs(raw: string | null): ReadonlyArray<string> {
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      .slice(0, SHORTS_JOBS_CAP);
  } catch {
    return [];
  }
}

export function serializeTrackedShortsJobs(ids: ReadonlyArray<string>): string {
  return JSON.stringify(ids.slice(0, SHORTS_JOBS_CAP));
}

function formatSeconds(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

/** `0:12 – 0:34 · 22s` when both ends are known; `0:12` when only the start is. */
export function formatClipDuration(clip: CodeitlabShortsClip): string | null {
  const { startSeconds, endSeconds } = clip;
  if (startSeconds === undefined && endSeconds === undefined) return null;
  if (startSeconds === undefined) return formatSeconds(endSeconds ?? 0);
  if (endSeconds === undefined) return formatSeconds(startSeconds);
  const duration = Math.max(0, endSeconds - startSeconds);
  return `${formatSeconds(startSeconds)} – ${formatSeconds(endSeconds)} · ${Math.round(duration)}s`;
}

export function clampTargetClips(value: number): number {
  if (!Number.isFinite(value)) return 3;
  return Math.min(12, Math.max(1, Math.round(value)));
}

export const SHORTS_OUTPUT_FORMATS = ["vertical", "horizontal", "square", "auto"] as const;
export type ShortsOutputFormat = (typeof SHORTS_OUTPUT_FORMATS)[number];

export const SHORTS_OUTPUT_FORMAT_LABELS: Readonly<Record<ShortsOutputFormat, string>> = {
  vertical: "Vertical",
  horizontal: "Horizontal",
  square: "Square",
  auto: "Auto",
};
