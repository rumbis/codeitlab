import * as DateTime from "effect/DateTime";
import type { CodeitlabTeamRun } from "@codeitlab/core/team";
import { describe, expect, it, vi } from "vite-plus/test";

import "~/index.css";

import { render as renderUi } from "../../../test/render";
import { CodeitlabTeamRunCard } from "./CodeitlabTeamRunCard";

const mock = vi.hoisted(() => ({
  subagents: [] as ReadonlyArray<unknown>,
  checkpoints: [] as ReadonlyArray<unknown>,
  threadFound: true,
}));

vi.mock(import("../../state/entities"), async (original) => ({
  ...(await original()),
  useThreadProjection: (() =>
    mock.threadFound ? ({ projection: { subagents: mock.subagents } } as never) : null) as never,
  useThreadCheckpointSummaries: (() => mock.checkpoints) as never,
}));

const RUN: CodeitlabTeamRun = {
  id: "run-1",
  presetId: "team-1",
  presetName: "Checkout crew",
  threadId: "thread-1234567890",
  environmentId: "local",
  task: "Split the checkout refactor",
  startedAt: "2026-10-24T12:00:00.000Z",
};

const at = DateTime.makeUnsafe("2026-10-24T12:00:00Z");

const subagent = (patch: Record<string, unknown>) => ({
  id: "agent-1",
  origin: "app_owned",
  driver: "codex",
  providerInstanceId: "codex-work",
  childThreadId: "child-1",
  title: "API surface",
  prompt: "Do the API",
  model: "deepseek-v4",
  status: "running",
  progress: null,
  result: null,
  startedAt: at,
  completedAt: null,
  updatedAt: at,
  ...patch,
});

describe("team run card", () => {
  it("says it is waiting when the architect has not delegated yet", async () => {
    mock.subagents = [];
    mock.threadFound = true;
    await using screen = await renderUi(<CodeitlabTeamRunCard run={RUN} />);
    expect(screen.getByText("Split the checkout refactor")).not.toBeNull();
    expect(screen.getByText(/No worker rows yet/)).not.toBeNull();
  });

  it("lists worker rows with their state", async () => {
    mock.subagents = [
      subagent({}),
      subagent({ id: "agent-2", title: "Tests", status: "completed", result: "8 tests pass" }),
    ];
    mock.threadFound = true;
    await using screen = await renderUi(<CodeitlabTeamRunCard run={RUN} />);
    const list = screen.container.querySelector('[aria-label="Team workers"]');
    expect(list?.textContent).toContain("API surface");
    expect(list?.textContent).toContain("Tests");
    expect(list?.textContent).toContain("working");
    expect(list?.textContent).toContain("done");
    expect(screen.getByText(/1\/2 finished/)).not.toBeNull();
  });

  it("summarises results once every worker settles", async () => {
    mock.subagents = [
      subagent({ status: "completed", result: "shipped the API" }),
      subagent({ id: "agent-2", title: "Tests", status: "failed", result: "suite is red" }),
    ];
    mock.threadFound = true;
    await using screen = await renderUi(<CodeitlabTeamRunCard run={RUN} />);
    const synthesis = screen.container.querySelector('[aria-label="Synthesis"]');
    expect(synthesis?.textContent).toContain("1 done");
    expect(synthesis?.textContent).toContain("1 failed");
    expect(synthesis?.textContent).toContain("shipped the API");
    expect(synthesis?.textContent).toContain("suite is red");
  });

  it("does not claim success when the thread projection is missing", async () => {
    mock.subagents = [];
    mock.threadFound = false;
    await using screen = await renderUi(<CodeitlabTeamRunCard run={RUN} />);
    expect(screen.getByText(/No worker rows yet/)).not.toBeNull();
  });

  it("aggregates changed files across checkpoints and says what it covers", async () => {
    mock.subagents = [];
    mock.checkpoints = [
      {
        files: [
          { path: "src/api.ts", kind: "modified", additions: 4, deletions: 1 },
          { path: "src/db.ts", kind: "modified", additions: 2, deletions: 0 },
        ],
      },
      { files: [{ path: "src/api.ts", kind: "modified", additions: 9, deletions: 3 }] },
    ];
    await using screen = await renderUi(<CodeitlabTeamRunCard run={RUN} />);
    expect(screen.getByText("Changed files (2)")).not.toBeNull();
    expect(screen.getByText("src/api.ts")).not.toBeNull();
    expect(screen.getByText("+9 −3")).not.toBeNull();
    expect(screen.getByText(/worker edits in separate worktrees may not appear/)).not.toBeNull();
  });
});
