import { describe, expect, it } from "vitest";
import * as Schema from "effect/Schema";

import {
  BOARD_AUTO_ARCHIVE_MS,
  CodeItLabBoardSettings,
  CodeItLabTask,
  activeBoardTasks,
  archivedBoardTasks,
  staleCompletedTasks,
  tasksInColumn,
} from "./board.ts";

const decodeBoard = Schema.decodeUnknownSync(CodeItLabBoardSettings);
const decodeTask = Schema.decodeUnknownSync(CodeItLabTask);

describe("board schema", () => {
  it("decodes an empty settings block", () => {
    expect(decodeBoard({}).tasks).toEqual([]);
  });

  it("defaults a partial task to pending and unarchived", () => {
    const task = decodeTask({ id: "task-1", title: "Ship the board" });
    expect(task.column).toBe("pending");
    expect(task.archivedAt).toBe("");
    expect(task.completedAt).toBe("");
    expect(task.threadId).toBe("");
  });
});

describe("board task helpers", () => {
  const now = Date.parse("2026-10-24T12:00:00.000Z");
  const task = (patch: Partial<CodeItLabTask>): CodeItLabTask => ({ ...decodeTask({}), ...patch });

  it("keeps archived tasks out of the active board", () => {
    const tasks = [
      task({ id: "a", column: "pending" }),
      task({ id: "b", column: "completed", archivedAt: "2026-10-01T00:00:00.000Z" }),
    ];
    expect(activeBoardTasks(tasks).map((entry) => entry.id)).toEqual(["a"]);
    expect(archivedBoardTasks(tasks).map((entry) => entry.id)).toEqual(["b"]);
  });

  it("orders a column by newest update", () => {
    const tasks = [
      task({ id: "old", updatedAt: "2026-10-01T00:00:00.000Z" }),
      task({ id: "new", updatedAt: "2026-10-20T00:00:00.000Z" }),
    ];
    expect(tasksInColumn(tasks, "pending").map((entry) => entry.id)).toEqual(["new", "old"]);
  });

  it("only ages out completed tasks past the archive window", () => {
    const stale = task({
      id: "stale",
      column: "completed",
      updatedAt: new Date(now - BOARD_AUTO_ARCHIVE_MS).toISOString(),
    });
    const fresh = task({
      id: "fresh",
      column: "completed",
      updatedAt: new Date(now - 60_000).toISOString(),
    });
    const active = task({
      id: "active",
      column: "pending",
      updatedAt: "2020-01-01T00:00:00.000Z",
    });
    expect(staleCompletedTasks([stale, fresh, active], now).map((entry) => entry.id)).toEqual([
      "stale",
    ]);
  });

  it("ages a completed task by when it was completed, not when it was last edited", () => {
    const finished = task({
      id: "finished",
      column: "completed",
      completedAt: new Date(now - BOARD_AUTO_ARCHIVE_MS - 1_000).toISOString(),
      updatedAt: new Date(now - 1_000).toISOString(),
    });
    expect(staleCompletedTasks([finished], now).map((entry) => entry.id)).toEqual(["finished"]);
  });
});
