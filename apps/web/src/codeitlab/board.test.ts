import { describe, expect, it } from "vite-plus/test";

import type { CodeItLabTask } from "@codeitlab/core/board";

import {
  archiveBoardTask,
  autoReviewTaskIds,
  boardTaskPrompt,
  boardTimestamp,
  createBoardTask,
  moveBoardTask,
  questBoardTask,
  startBoardTask,
  unarchiveBoardTask,
  updateBoardTaskNotes,
} from "./board.ts";

const now = new Date("2026-10-24T12:00:00.000Z");

const task = (patch: Partial<CodeItLabTask>): CodeItLabTask => ({
  ...createBoardTask(now, "Ship the board"),
  ...patch,
});

describe("board task actions", () => {
  it("creates a pending task with a stable timestamp", () => {
    const created = createBoardTask(now, "  Ship the board  ");
    expect(created.title).toBe("Ship the board");
    expect(created.column).toBe("pending");
    expect(created.createdAt).toBe(now.toISOString());
    expect(created.threadId).toBe("");
  });

  it("moves a task and stamps the update", () => {
    const later = new Date(now.getTime() + 60_000);
    const moved = moveBoardTask([task({ id: "a" })], "a", "review", later);
    expect(moved[0]?.column).toBe("review");
    expect(moved[0]?.updatedAt).toBe(later.toISOString());
  });

  it("starting a task records the thread and moves it to in progress", () => {
    const started = startBoardTask([task({ id: "a" })], "a", "thread-9", now);
    expect(started[0]?.threadId).toBe("thread-9");
    expect(started[0]?.column).toBe("inProgress");
    expect(started[0]?.startedAt).toBe(now.toISOString());
  });

  it("keeps a run start only while the task is in progress", () => {
    const started = moveBoardTask([task({ id: "a" })], "a", "inProgress", now);
    expect(started[0]?.startedAt).toBe(now.toISOString());
    const moved = moveBoardTask(started, "a", "review", new Date(now.getTime() + 60_000));
    expect(moved[0]?.startedAt).toBe("");
  });

  it("archives and unarchives without losing the column", () => {
    const archived = archiveBoardTask([task({ id: "a", column: "completed" })], "a", now);
    expect(archived[0]?.archivedAt).toBe(now.toISOString());
    const restored = unarchiveBoardTask(archived, "a", now);
    expect(restored[0]?.archivedAt).toBe("");
    expect(restored[0]?.column).toBe("completed");
  });

  it("updates notes and trims them", () => {
    const later = new Date(now.getTime() + 60_000);
    const updated = updateBoardTaskNotes([task({ id: "a" })], "a", "  Safari only  ", later);
    expect(updated[0]?.notes).toBe("Safari only");
    expect(updated[0]?.updatedAt).toBe(later.toISOString());
  });

  it("builds a prompt from the title and optional notes", () => {
    expect(boardTaskPrompt(task({ title: "Fix login" }))).toBe("Fix login");
    expect(boardTaskPrompt(task({ title: "Fix login", notes: "Safari only" }))).toBe(
      "Fix login\n\nSafari only",
    );
  });
});

describe("auto review", () => {
  const base = task({ id: "a", column: "inProgress", threadId: "thread-1" });
  const snapshot = (patch: Partial<Parameters<typeof autoReviewTaskIds>[1][number]>) => ({
    threadId: "thread-1",
    activeRunId: null,
    latestRunCompletedAt: "2026-10-24T12:01:00.000Z",
    lastError: null,
    ...patch,
  });

  it("moves a task whose own run completed cleanly", () => {
    expect(autoReviewTaskIds([base], [snapshot({})])).toEqual(["a"]);
  });

  it("never moves while the run is still active", () => {
    expect(autoReviewTaskIds([base], [snapshot({ activeRunId: "run-2" })])).toEqual([]);
  });

  it("keeps a failed run in progress instead of claiming review", () => {
    expect(
      autoReviewTaskIds(
        [base],
        [snapshot({ lastError: "provider exited", latestRunCompletedAt: null })],
      ),
    ).toEqual([]);
  });

  it("ignores pending, archived and unstarted tasks", () => {
    expect(
      autoReviewTaskIds(
        [
          task({ id: "pending", column: "pending", threadId: "thread-1" }),
          task({
            id: "archived",
            column: "inProgress",
            threadId: "thread-1",
            archivedAt: "2026-10-24T00:00:00.000Z",
          }),
          task({ id: "unstarted", column: "inProgress" }),
        ],
        [snapshot({})],
      ),
    ).toEqual([]);
  });

  it("ignores a completion older than the task's start", () => {
    expect(
      autoReviewTaskIds(
        [
          task({
            id: "late",
            column: "inProgress",
            threadId: "thread-1",
            startedAt: "2026-10-24T12:05:00.000Z",
            updatedAt: "2026-10-24T12:05:00.000Z",
          }),
        ],
        [snapshot({ latestRunCompletedAt: "2026-10-24T12:01:00.000Z" })],
      ),
    ).toEqual([]);
  });

  it("still reviews after notes were edited once the run finished", () => {
    expect(
      autoReviewTaskIds(
        [
          task({
            id: "edited",
            column: "inProgress",
            threadId: "thread-1",
            startedAt: "2026-10-24T12:00:00.000Z",
            updatedAt: "2026-10-24T12:30:00.000Z",
          }),
        ],
        [snapshot({ latestRunCompletedAt: "2026-10-24T12:01:00.000Z" })],
      ),
    ).toEqual(["edited"]);
  });
});

describe("completion day", () => {
  it("records the completion day when a task enters Completed", () => {
    const original = task({});
    const moved = moveBoardTask([original], original.id, "completed", now);
    expect(moved[0]?.completedAt).toBe(now.toISOString());
  });

  it("clears the completion day when a task leaves Completed", () => {
    const original = task({});
    const finished = moveBoardTask([original], original.id, "completed", now);
    const reopened = moveBoardTask(finished, original.id, "review", now);
    expect(reopened[0]?.completedAt).toBe("");
  });

  it("keeps the completion day across archive and unarchive", () => {
    const original = task({});
    const finished = moveBoardTask([original], original.id, "completed", now);
    const archived = archiveBoardTask(finished, original.id, new Date("2026-10-25T09:00:00.000Z"));
    expect(archived[0]?.completedAt).toBe(now.toISOString());
    const restored = unarchiveBoardTask(
      archived,
      original.id,
      new Date("2026-10-26T09:00:00.000Z"),
    );
    expect(restored[0]?.completedAt).toBe(now.toISOString());
  });

  it("keeps the completion day when notes are edited later", () => {
    const original = task({});
    const finished = moveBoardTask([original], original.id, "completed", now);
    const later = new Date("2026-10-26T09:00:00.000Z");
    const edited = updateBoardTaskNotes(finished, original.id, "Follow-up note", later);
    expect(edited[0]?.completedAt).toBe(now.toISOString());
    expect(edited[0]?.updatedAt).toBe(later.toISOString());
  });

  it("turns a quest into a pending task that carries its lesson and route", () => {
    const created = questBoardTask(
      { title: "Install one agent", lesson: "An agent is how work actually runs." },
      "/settings/codeitlab/agents",
      now,
    );
    expect(created.column).toBe("pending");
    expect(created.title).toBe("Install one agent");
    expect(created.notes).toContain("An agent is how work actually runs.");
    expect(created.notes).toContain("Where: /settings/codeitlab/agents");
  });

  it("leaves the notes empty when a quest has no lesson and no route", () => {
    const created = questBoardTask({ title: "Look around", lesson: "  " }, " ", now);
    expect(created.notes).toBe("");
  });

  it("formats a task timestamp in UTC, or empty when unset", () => {
    expect(boardTimestamp("2026-10-24T09:30:00.000Z")).toBe("2026-10-24 09:30 UTC");
    expect(boardTimestamp("")).toBe("");
    expect(boardTimestamp("not a date")).toBe("");
  });
});
