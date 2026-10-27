import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/**
 * The board is a thin view over threads: a task records what should happen, and
 * starting it opens an ordinary thread. Columns are a workflow label, not a
 * second execution engine, so nothing here schedules or runs work.
 */

export const CODEITLAB_BOARD_COLUMNS = ["pending", "inProgress", "review", "completed"] as const;
export const CodeItLabBoardColumn = Schema.Literals(CODEITLAB_BOARD_COLUMNS);
export type CodeItLabBoardColumn = typeof CodeItLabBoardColumn.Type;

/** Finished tasks leave the active board after this long; unarchive restores one. */
export const BOARD_AUTO_ARCHIVE_DAYS = 7;
export const BOARD_AUTO_ARCHIVE_MS = BOARD_AUTO_ARCHIVE_DAYS * 24 * 60 * 60 * 1000;

const TrimmedDefault = (value: string) =>
  Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(value)));

export const CodeItLabTask = Schema.Struct({
  id: TrimmedDefault("task-1"),
  title: TrimmedDefault("Task"),
  notes: TrimmedDefault(""),
  column: CodeItLabBoardColumn.pipe(Schema.withDecodingDefault(Effect.succeed("pending" as const))),
  /** ISO timestamps; empty strings decode from older settings files. */
  createdAt: TrimmedDefault(""),
  updatedAt: TrimmedDefault(""),
  /** Thread opened by Start; empty until the task is started. */
  threadId: TrimmedDefault(""),
  /** ISO timestamp; empty means the task is on the active board. */
  archivedAt: TrimmedDefault(""),
  /** ISO timestamp of entering Completed; empty for tasks that never finished. */
  completedAt: TrimmedDefault(""),
  /**
   * ISO timestamp of the current run: set when the task enters In progress,
   * cleared when it leaves. Auto-review compares the run completion with this,
   * so editing notes afterwards does not block the move. Optional so settings
   * files written before this field still decode.
   */
  startedAt: Schema.optional(TrimmedDefault("")),
});
export type CodeItLabTask = typeof CodeItLabTask.Type;

export const CodeItLabBoardSettings = Schema.Struct({
  tasks: Schema.Array(CodeItLabTask).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
export type CodeItLabBoardSettings = typeof CodeItLabBoardSettings.Type;

export function isTaskArchived(task: CodeItLabTask): boolean {
  return task.archivedAt.trim() !== "";
}

export function activeBoardTasks(
  tasks: ReadonlyArray<CodeItLabTask>,
): ReadonlyArray<CodeItLabTask> {
  return tasks.filter((task) => !isTaskArchived(task));
}

export function archivedBoardTasks(
  tasks: ReadonlyArray<CodeItLabTask>,
): ReadonlyArray<CodeItLabTask> {
  return tasks.filter(isTaskArchived);
}

/** Tasks in a column, newest first, so a fresh idea sits at the top. */
export function tasksInColumn(
  tasks: ReadonlyArray<CodeItLabTask>,
  column: CodeItLabBoardColumn,
): ReadonlyArray<CodeItLabTask> {
  return activeBoardTasks(tasks)
    .filter((task) => task.column === column)
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

/**
 * Only completed tasks age out. Moving a completed task back to an earlier
 * column clears the clock because the task is active again.
 */
export function staleCompletedTasks(
  tasks: ReadonlyArray<CodeItLabTask>,
  now: number,
): ReadonlyArray<CodeItLabTask> {
  return activeBoardTasks(tasks).filter((task) => {
    if (task.column !== "completed") return false;
    // Completion time, not the last edit: writing notes on a finished task must
    // not restart its seven-day clock.
    const completed = Date.parse(task.completedAt !== "" ? task.completedAt : task.updatedAt);
    if (Number.isNaN(completed)) return false;
    return now - completed >= BOARD_AUTO_ARCHIVE_MS;
  });
}
