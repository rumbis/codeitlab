import type { CodeitlabBoardColumn, CodeitlabTask } from "@codeitlab/core/board";

export const BOARD_COLUMN_LABELS: Readonly<Record<CodeitlabBoardColumn, string>> = {
  pending: "Pending",
  inProgress: "In progress",
  review: "Review",
  completed: "Completed",
};

export const BOARD_COLUMN_HINTS: Readonly<Record<CodeitlabBoardColumn, string>> = {
  pending: "Ideas waiting for a thread",
  inProgress: "A thread is working on it",
  review: "Finished, waiting for a look",
  completed: "Done and counted",
};

let sequence = 0;

export function createBoardTask(now: Date, title: string): CodeitlabTask {
  sequence += 1;
  const stamp = now.toISOString();
  return {
    id: `task-${now.getTime().toString(36)}-${sequence.toString(36)}`,
    title: title.trim(),
    notes: "",
    column: "pending",
    createdAt: stamp,
    updatedAt: stamp,
    threadId: "",
    archivedAt: "",
    completedAt: "",
  };
}

function replaceTask(
  tasks: ReadonlyArray<CodeitlabTask>,
  id: string,
  patch: Partial<CodeitlabTask>,
): ReadonlyArray<CodeitlabTask> {
  return tasks.map((task) => (task.id === id ? { ...task, ...patch } : task));
}

export function moveBoardTask(
  tasks: ReadonlyArray<CodeitlabTask>,
  id: string,
  column: CodeitlabBoardColumn,
  now: Date,
): ReadonlyArray<CodeitlabTask> {
  const stamp = now.toISOString();
  return replaceTask(tasks, id, {
    column,
    updatedAt: stamp,
    // The day a task was finished, not the day it was last edited.
    completedAt: column === "completed" ? stamp : "",
  });
}

export function updateBoardTaskNotes(
  tasks: ReadonlyArray<CodeitlabTask>,
  id: string,
  notes: string,
  now: Date,
): ReadonlyArray<CodeitlabTask> {
  const trimmed = notes.trim();
  return replaceTask(tasks, id, { notes: trimmed, updatedAt: now.toISOString() });
}

export function startBoardTask(
  tasks: ReadonlyArray<CodeitlabTask>,
  id: string,
  threadId: string,
  now: Date,
): ReadonlyArray<CodeitlabTask> {
  return replaceTask(tasks, id, {
    column: "inProgress",
    threadId,
    updatedAt: now.toISOString(),
  });
}

export function archiveBoardTask(
  tasks: ReadonlyArray<CodeitlabTask>,
  id: string,
  now: Date,
): ReadonlyArray<CodeitlabTask> {
  return replaceTask(tasks, id, { archivedAt: now.toISOString(), updatedAt: now.toISOString() });
}

export function unarchiveBoardTask(
  tasks: ReadonlyArray<CodeitlabTask>,
  id: string,
  now: Date,
): ReadonlyArray<CodeitlabTask> {
  return replaceTask(tasks, id, { archivedAt: "", updatedAt: now.toISOString() });
}

/**
 * A quest turned into a board task. The lesson becomes the notes and the route
 * becomes the place to do it, so the card carries the teaching with it. Nothing
 * is created automatically: the user asks for this from the quest card.
 */
export function questBoardTask(
  quest: { readonly title: string; readonly lesson: string },
  href: string,
  now: Date,
): CodeitlabTask {
  const task = createBoardTask(now, quest.title);
  const where = href.trim() === "" ? "" : `Where: ${href.trim()}`;
  const notes = [quest.lesson.trim(), where].filter((line) => line !== "").join("\n\n");
  return notes === "" ? task : { ...task, notes };
}

/** The prompt a started task puts in the composer: title first, then notes. */
export function boardTaskPrompt(task: CodeitlabTask): string {
  const notes = task.notes.trim();
  return notes === "" ? task.title.trim() : `${task.title.trim()}\n\n${notes}`;
}

export interface BoardThreadRunSnapshot {
  readonly threadId: string;
  readonly activeRunId: string | null;
  readonly latestRunCompletedAt: string | null;
  readonly lastError: string | null;
}

/**
 * Auto-review is deliberately narrow: a task moves from In progress to Review
 * only when its own root run finished cleanly. A failed run stays in progress so
 * the user sees the failure instead of a green column, and a run that is still
 * active never moves.
 */
export function autoReviewTaskIds(
  tasks: ReadonlyArray<CodeitlabTask>,
  snapshots: ReadonlyArray<BoardThreadRunSnapshot>,
): ReadonlyArray<string> {
  const byThreadId = new Map(snapshots.map((snapshot) => [snapshot.threadId, snapshot]));
  return tasks
    .filter((task) => {
      if (task.column !== "inProgress" || task.threadId === "") return false;
      if (task.archivedAt !== "") return false;
      const snapshot = byThreadId.get(task.threadId);
      if (snapshot === undefined) return false;
      if (snapshot.activeRunId !== null) return false;
      if (snapshot.lastError !== null) return false;
      if (snapshot.latestRunCompletedAt === null) return false;
      const completed = Date.parse(snapshot.latestRunCompletedAt);
      const started = Date.parse(task.updatedAt);
      if (Number.isNaN(completed)) return false;
      return Number.isNaN(started) || completed >= started;
    })
    .map((task) => task.id);
}
