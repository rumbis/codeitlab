import { describe, expect, it } from "vite-plus/test";

import type { CodeItLabTask } from "./board.ts";
import { codeitlabProgress, completedDays } from "./progress.ts";

const now = new Date("2026-10-24T12:00:00.000Z");

const task = (patch: Partial<CodeItLabTask>): CodeItLabTask => ({
  id: "t",
  title: "Task",
  notes: "",
  column: "completed",
  threadId: "",
  createdAt: "2026-10-20T10:00:00.000Z",
  updatedAt: "2026-10-24T10:00:00.000Z",
  archivedAt: "",
  completedAt: "",
  ...patch,
});

describe("progress", () => {
  it("counts unique completed UTC days and ignores other columns", () => {
    const days = completedDays([
      task({ updatedAt: "2026-10-24T09:00:00.000Z" }),
      task({ updatedAt: "2026-10-24T18:00:00.000Z" }),
      task({ updatedAt: "2026-10-23T09:00:00.000Z" }),
      task({ column: "review", updatedAt: "2026-10-22T09:00:00.000Z" }),
    ]);
    expect(days).toEqual(["2026-10-24", "2026-10-23"]);
  });

  it("keeps a streak alive when the last completion was yesterday", () => {
    const progress = codeitlabProgress(
      [
        task({ updatedAt: "2026-10-23T09:00:00.000Z" }),
        task({ updatedAt: "2026-10-22T09:00:00.000Z" }),
      ],
      now,
    );
    expect(progress.currentStreak).toBe(2);
    expect(progress.bestStreak).toBe(2);
  });

  it("ends a streak after a full empty day", () => {
    const progress = codeitlabProgress([task({ updatedAt: "2026-10-22T09:00:00.000Z" })], now);
    expect(progress.currentStreak).toBe(0);
    expect(progress.completedCount).toBe(1);
    expect(progress.lastCompletedDay).toBe("2026-10-22");
  });

  it("keeps the saved best when the current streak is lower", () => {
    const progress = codeitlabProgress([task({ updatedAt: "2026-10-24T09:00:00.000Z" })], now, {
      bestStreak: 5,
      bestStreakDay: "2026-10-10",
    });
    expect(progress.currentStreak).toBe(1);
    expect(progress.bestStreak).toBe(5);
    expect(progress.bestStreakDay).toBe("2026-10-10");
  });

  it("uses completion time, not the last edit, for the day", () => {
    const edited = task({
      completedAt: "2026-10-23T09:00:00.000Z",
      updatedAt: "2026-10-24T20:00:00.000Z",
    });
    expect(completedDays([edited])).toEqual(["2026-10-23"]);
  });

  it("keeps the saved best when the board has no completed tasks at all", () => {
    const progress = codeitlabProgress([task({ column: "pending" })], now, {
      bestStreak: 4,
      bestStreakDay: "2026-10-01",
    });
    expect(progress.currentStreak).toBe(0);
    expect(progress.completedCount).toBe(0);
    expect(progress.bestStreak).toBe(4);
    expect(progress.bestStreakDay).toBe("2026-10-01");
  });

  it("counts an unarchived completed task on the day it was completed", () => {
    const restored = task({
      archivedAt: "",
      completedAt: "2026-10-24T08:00:00.000Z",
      updatedAt: "2026-10-25T08:00:00.000Z",
    });
    const progress = codeitlabProgress([restored], new Date("2026-10-25T12:00:00.000Z"));
    expect(progress.currentStreak).toBe(1);
    expect(progress.lastCompletedDay).toBe("2026-10-24");
  });

  it("keeps archived completed tasks in the history", () => {
    const archived = task({
      archivedAt: "2026-10-24T11:00:00.000Z",
      completedAt: "2026-10-23T09:00:00.000Z",
    });
    const progress = codeitlabProgress([archived], now);
    expect(progress.completedCount).toBe(1);
    expect(progress.currentStreak).toBe(1);
    expect(progress.lastCompletedDay).toBe("2026-10-23");
  });
});
