import { describe, expect, it } from "vite-plus/test";

import type { CodeItLabShortsClip } from "@codeitlab/contracts";

import {
  addTrackedShortsJob,
  clampTargetClips,
  formatClipDuration,
  isShortsJobActive,
  parseTrackedShortsJobs,
  serializeTrackedShortsJobs,
  SHORTS_JOBS_CAP,
  shortsStateLabel,
  shortsStateVariant,
  shortsUnknownStateExplanation,
  tailShortsLogs,
} from "./shorts";

const clip: CodeItLabShortsClip = {
  title: "Clip",
  startSeconds: 12,
  endSeconds: 34,
  videoUrl: "https://example.com/clip.mp4",
};

describe("shorts job display model", () => {
  it("maps every job state to a label and badge variant", () => {
    expect(shortsStateLabel("queued")).toBe("Queued");
    expect(shortsStateLabel("processing")).toBe("Processing");
    expect(shortsStateLabel("completed")).toBe("Completed");
    expect(shortsStateLabel("failed")).toBe("Failed");
    expect(shortsStateLabel("unknown")).toBe("Unknown");

    expect(shortsStateVariant("queued")).toBe("secondary");
    expect(shortsStateVariant("processing")).toBe("info");
    expect(shortsStateVariant("completed")).toBe("success");
    expect(shortsStateVariant("failed")).toBe("error");
    expect(shortsStateVariant("unknown")).toBe("warning");
  });

  it("polls only queued and processing jobs", () => {
    expect(isShortsJobActive("queued")).toBe(true);
    expect(isShortsJobActive("processing")).toBe(true);
    expect(isShortsJobActive("completed")).toBe(false);
    expect(isShortsJobActive("failed")).toBe(false);
    expect(isShortsJobActive("unknown")).toBe(false);
  });

  it("explains unknown engine states honestly", () => {
    expect(shortsUnknownStateExplanation(undefined)).toBe(
      "Unknown — the engine returned a status we don't recognise.",
    );
    expect(shortsUnknownStateExplanation("weird-new-state")).toBe(
      'Unknown — the engine returned "weird-new-state", which we don\'t recognise.',
    );
  });

  it("tails the log to the last lines", () => {
    const logs = Array.from({ length: 12 }, (_, index) => `line ${index}`);
    expect(tailShortsLogs(logs)).toEqual(logs.slice(-8));
    expect(tailShortsLogs(logs, 3)).toEqual(["line 9", "line 10", "line 11"]);
    expect(tailShortsLogs([], 8)).toEqual([]);
    expect(tailShortsLogs(logs, 0)).toEqual([]);
  });

  it("adds tracked jobs newest-first, dedupes, and caps the list", () => {
    expect(addTrackedShortsJob(["a", "b"], "c")).toEqual(["c", "a", "b"]);
    expect(addTrackedShortsJob(["a", "b"], "b")).toEqual(["b", "a"]);
    expect(addTrackedShortsJob(["a"], "  ")).toEqual(["a"]);

    const many = Array.from({ length: 25 }, (_, index) => `job-${index}`);
    expect(addTrackedShortsJob(many, "newest")).toHaveLength(SHORTS_JOBS_CAP);
    expect(addTrackedShortsJob(many, "newest")[0]).toBe("newest");
  });

  it("parses stored ids leniently", () => {
    expect(parseTrackedShortsJobs(null)).toEqual([]);
    expect(parseTrackedShortsJobs("not json")).toEqual([]);
    expect(parseTrackedShortsJobs('{"jobId":"x"}')).toEqual([]);
    expect(parseTrackedShortsJobs('["a", 2, "", "b"]')).toEqual(["a", "b"]);
    expect(parseTrackedShortsJobs(serializeTrackedShortsJobs(["a", "b"]))).toEqual(["a", "b"]);
  });

  it("formats clip duration from start/end seconds", () => {
    expect(formatClipDuration(clip)).toBe("0:12 – 0:34 · 22s");
    expect(formatClipDuration({ title: "only start", startSeconds: 5 })).toBe("0:05");
    expect(formatClipDuration({ title: "only end", endSeconds: 75 })).toBe("1:15");
    expect(formatClipDuration({ title: "none" })).toBeNull();
    expect(formatClipDuration({ title: "reversed", startSeconds: 40, endSeconds: 30 })).toBe(
      "0:40 – 0:30 · 0s",
    );
  });

  it("clamps target clips to 1–12", () => {
    expect(clampTargetClips(0)).toBe(1);
    expect(clampTargetClips(3)).toBe(3);
    expect(clampTargetClips(99)).toBe(12);
    expect(clampTargetClips(Number.NaN)).toBe(3);
  });
});
