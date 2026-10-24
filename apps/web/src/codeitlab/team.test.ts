import { describe, expect, it } from "vite-plus/test";

import type { RuntimeSubagent } from "@t3tools/client-runtime/state/subagentRuntime";

import {
  MAX_TEAM_WORKERS,
  buildTeamBrief,
  createTeamRun,
  aggregateTeamChangedFiles,
  summarizeTeamRun,
  createTeamPreset,
  createTeamWorker,
  teamPresetIssue,
} from "./team";

describe("team presets", () => {
  it("creates a preset with two named workers and inheriting models", () => {
    const preset = createTeamPreset(1_700_000_000_000);
    expect(preset.id).toBe("team-1700000000000");
    expect(preset.workers).toHaveLength(2);
    expect(preset.workers.map((worker) => worker.role)).toEqual(["implementation", "tests"]);
    expect(preset.architectModel).toBe("");
  });

  it("keeps the product worker cap", () => {
    expect(MAX_TEAM_WORKERS).toBe(3);
  });

  it("rejects a preset that cannot start", () => {
    const preset = createTeamPreset(1);
    expect(teamPresetIssue(preset)).toBeNull();
    expect(teamPresetIssue({ ...preset, name: "  " })).toContain("name");
    expect(teamPresetIssue({ ...preset, workers: [] })).toContain("worker");
    expect(
      teamPresetIssue({
        ...preset,
        workers: Array.from({ length: MAX_TEAM_WORKERS + 1 }, (_, index) =>
          createTeamWorker(index + 1),
        ),
      }),
    ).toContain("at most");
    expect(
      teamPresetIssue({ ...preset, workers: [{ ...createTeamWorker(1), name: "" }] }),
    ).toContain("name");
  });
});

describe("team brief", () => {
  it("names every worker, role and model and requires a synthesis", () => {
    const preset = {
      ...createTeamPreset(1),
      architectInstanceId: "claude",
      architectModel: "claude-sonnet-4-5",
      workers: [
        {
          id: "w1",
          name: "API surface",
          role: "implementation",
          instanceId: "codex",
          model: "gpt-5-codex",
        },
        { id: "w2", name: "Tests", role: "tests", instanceId: "", model: "" },
      ],
    };
    const brief = buildTeamBrief(preset, "  Add a health endpoint.  ");
    expect(brief).toContain("Add a health endpoint.");
    expect(brief).toContain("API surface — role: implementation — model: codex · gpt-5-codex");
    expect(brief).toContain(
      "Tests — role: tests — model: the architect's provider (default model)",
    );
    expect(brief).toContain("Architect: claude · claude-sonnet-4-5");
    expect(brief).toContain("delegate_task");
    expect(brief).toContain("deduplicated list of changed files");
    expect(brief).not.toContain("  Add a health endpoint.  ");
  });

  it("tells the architect to inherit when no model is chosen", () => {
    const brief = buildTeamBrief(createTeamPreset(1), "Do the thing");
    expect(brief).toContain("Architect: the thread's model");
    expect(brief).toContain("the architect's provider (default model)");
  });
});

describe("team run summary", () => {
  const agent = (patch: Partial<RuntimeSubagent>): RuntimeSubagent => ({
    id: "agent-1",
    kind: "subagent",
    title: "Worker",
    role: null,
    model: "deepseek-v4",
    effort: null,
    status: "running",
    activationCount: 1,
    usage: null,
    progress: null,
    lastToolName: null,
    result: null,
    error: null,
    outputFile: null,
    parentAgentId: null,
    agentIndex: null,
    phaseIndex: null,
    phaseTitle: null,
    attempt: null,
    workflowName: null,
    phases: [],
    runHandles: null,
    childThreadId: null,
    recentActivity: [],
    firstSeenAt: "2026-10-24T12:00:00.000Z",
    startedAt: "2026-10-24T12:00:00.000Z",
    completedAt: null,
    updatedAt: "2026-10-24T12:00:00.000Z",
    ...patch,
  });

  it("counts every state and reports no workers honestly", () => {
    expect(summarizeTeamRun([])).toMatchObject({ total: 0, working: 0, done: 0 });
    const summary = summarizeTeamRun([
      agent({ id: "a", title: "API", status: "running" }),
      agent({ id: "b", title: "Tests", status: "completed", result: "8 tests pass" }),
      agent({ id: "c", title: "Docs", status: "failed", error: "ran out of context" }),
    ]);
    expect(summary).toMatchObject({ total: 3, working: 1, done: 1, failed: 1, stopped: 0 });
    expect(summary.results.map((entry) => entry.title)).toEqual(["API", "Tests", "Docs"]);
    expect(summary.results[1]?.text).toBe("8 tests pass");
    expect(summary.results[2]?.text).toBe("ran out of context");
  });

  it("maps stopped statuses separately from failures", () => {
    const summary = summarizeTeamRun([
      agent({ status: "cancelled" }),
      agent({ id: "b", status: "interrupted" }),
      agent({ id: "c", status: "idle" }),
    ]);
    expect(summary).toMatchObject({ stopped: 2, idle: 1, failed: 0 });
  });

  it("records a run with the thread and environment it opened in", () => {
    const preset = createTeamPreset(Date.parse("2026-10-24T12:00:00.000Z"));
    const run = createTeamRun({
      preset,
      threadId: "thread-9",
      environmentId: "env-1",
      task: "  Split the work  ",
      now: new Date("2026-10-24T12:05:00.000Z"),
    });
    expect(run).toMatchObject({
      presetId: preset.id,
      threadId: "thread-9",
      environmentId: "env-1",
      task: "Split the work",
      startedAt: "2026-10-24T12:05:00.000Z",
    });
  });
});

describe("aggregateTeamChangedFiles", () => {
  const file = (path: string, additions: number, deletions = 0, kind = "modified") => ({
    path,
    kind,
    additions,
    deletions,
  });

  it("deduplicates a path across checkpoints and keeps the latest numbers", () => {
    const files = aggregateTeamChangedFiles([
      { files: [file("a.ts", 2), file("b.ts", 1)] },
      { files: [file("a.ts", 5), file("c.ts", 3)] },
    ]);
    expect(files.map((entry) => entry.path)).toEqual(["a.ts", "b.ts", "c.ts"]);
    expect(files[0]?.additions).toBe(5);
  });

  it("ignores blank paths and handles an empty run", () => {
    expect(aggregateTeamChangedFiles([])).toEqual([]);
    expect(aggregateTeamChangedFiles([{ files: [file("  ", 1)] }])).toEqual([]);
  });
});
