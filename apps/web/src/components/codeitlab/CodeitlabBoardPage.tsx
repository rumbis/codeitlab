import {
  CODEITLAB_BOARD_COLUMNS,
  BOARD_AUTO_ARCHIVE_DAYS,
  activeBoardTasks,
  archivedBoardTasks,
  staleCompletedTasks,
  tasksInColumn,
  type CodeitlabBoardColumn,
  type CodeitlabTask,
} from "@codeitlab/core/board";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FileTextIcon,
  PlayIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useComposerDraftStore } from "~/composerDraftStore";
import { useNavigate } from "@tanstack/react-router";

import { codeitlabProgress } from "@codeitlab/core/progress";

import { useCodeitlabTasks } from "../../codeitlab/api";
import { useCodeitlabSettingsWriter } from "../../codeitlab/effectsSettings";
import {
  BOARD_COLUMN_HINTS,
  BOARD_COLUMN_LABELS,
  archiveBoardTask,
  autoReviewTaskIds,
  boardTaskPrompt,
  createBoardTask,
  moveBoardTask,
  startBoardTask,
  unarchiveBoardTask,
  updateBoardTaskNotes,
} from "../../codeitlab/board";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { useProjects, useThreadShells } from "../../state/entities";
import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/models";
import { sortScopedProjectsForSidebar } from "../Sidebar.logic";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../ui/sheet";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import { CodeitlabCard, CodeitlabEmptyBlock, CodeitlabSectionHeading } from "./CodeitlabPrimitives";

const NEXT_COLUMN: Readonly<Record<CodeitlabBoardColumn, CodeitlabBoardColumn | null>> = {
  pending: "inProgress",
  inProgress: "review",
  review: "completed",
  completed: null,
};

const PREVIOUS_COLUMN: Readonly<Record<CodeitlabBoardColumn, CodeitlabBoardColumn | null>> = {
  pending: null,
  inProgress: "pending",
  review: "inProgress",
  completed: "review",
};

/**
 * The board: four workflow columns over ordinary threads. Starting a task opens
 * a draft thread with the task as its prompt and remembers the thread id, so the
 * board never runs work itself. Completed tasks age off after a week.
 */
export function CodeitlabBoardPage() {
  const { codeitlab, environmentId, update } = useCodeitlabSettingsWriter();
  const remote = useCodeitlabTasks();
  const settingsTasks = codeitlab.board.tasks;
  // The database is the shared copy; settings stays the fallback until the
  // database answers, so a board that existed before this table never vanishes.
  const usingDatabase = remote.source === "server" && remote.data.length > 0;
  const tasks = usingDatabase ? remote.data : settingsTasks;
  const [title, setTitle] = useState("");
  const [startingId, setStartingId] = useState<string | null>(null);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState("");
  const detailsTask =
    detailsId === null ? null : (tasks.find((task) => task.id === detailsId) ?? null);
  const navigate = useNavigate();

  const projects = useProjects();
  const threads = useThreadShells();
  const handleNewThread = useNewThreadHandler();
  const archived = archivedBoardTasks(tasks);
  const active = activeBoardTasks(tasks);
  const savedProgress = codeitlab.progress ?? { bestStreak: 0, bestStreakDay: "" };
  const progress = codeitlabProgress(tasks, new Date(), savedProgress);
  const bestStreakRef = useRef(savedProgress);
  useEffect(() => {
    if (progress.bestStreak <= bestStreakRef.current.bestStreak) return;
    bestStreakRef.current = {
      bestStreak: progress.bestStreak,
      bestStreakDay: progress.bestStreakDay,
    };
    update({ progress: bestStreakRef.current });
  }, [progress.bestStreak, progress.bestStreakDay, update]);
  const autoArchived = useRef(false);
  const autoReviewed = useRef<string | null>(null);

  useEffect(() => {
    if (autoArchived.current) return;
    autoArchived.current = true;
    const now = Date.now();
    const stale = staleCompletedTasks(tasks, now);
    if (stale.length === 0) return;
    const staleIds = new Set(stale.map((task) => task.id));
    const stamp = new Date(now).toISOString();
    update({
      board: {
        ...codeitlab.board,
        tasks: tasks.map((task) =>
          staleIds.has(task.id) ? { ...task, archivedAt: stamp, updatedAt: stamp } : task,
        ),
      },
    });
    toastManager.add({
      type: "info",
      title: `Archived ${stale.length} completed ${stale.length === 1 ? "task" : "tasks"}`,
      description: `Completed tasks leave the board after ${BOARD_AUTO_ARCHIVE_DAYS} days. Open Archived to restore one.`,
    });
  }, [codeitlab.board, tasks, update]);

  const persistTasks = (next: ReadonlyArray<CodeitlabTask>) => {
    update({ board: { ...codeitlab.board, tasks: [...next] } });
    // Mirror to the database so other devices see the same board. Only tasks
    // that actually changed are sent: moving one card used to upsert the whole
    // column, which is a round trip per task for a one-row edit.
    const previousById = new Map(settingsTasks.map((task) => [task.id, task]));
    const previousIds = new Set(settingsTasks.map((task) => task.id));
    const nextIds = new Set(next.map((task) => task.id));
    for (const task of next) {
      const before = previousById.get(task.id);
      if (before !== undefined && JSON.stringify(before) === JSON.stringify(task)) continue;
      void remote.upsert(task);
    }
    for (const id of previousIds) {
      if (!nextIds.has(id)) void remote.remove(id);
    }
  };

  useEffect(() => {
    const snapshots = threads.map((shell) => ({
      threadId: shell.id,
      activeRunId: threadRuntimeIsActive(shell.runtime)
        ? (shell.runtime?.activeRunId ?? null)
        : null,
      latestRunCompletedAt:
        shell.latestRun?.status === "completed" ? shell.latestRun.completedAt : null,
      lastError: shell.runtime?.lastError ?? null,
    }));
    const reviewIds = autoReviewTaskIds(tasks, snapshots);
    if (reviewIds.length === 0) return;
    const key = reviewIds.join(",");
    if (autoReviewed.current === key) return;
    autoReviewed.current = key;
    const now = new Date();
    persistTasks(
      reviewIds.reduce(
        (next, id) => moveBoardTask(next, id, "review", now),
        tasks as ReadonlyArray<CodeitlabTask>,
      ),
    );
    toastManager.add({
      type: "info",
      title: `Moved ${reviewIds.length} ${reviewIds.length === 1 ? "task" : "tasks"} to Review`,
      description: "Auto-review only moves a task when its own run finished cleanly.",
    });
  }, [persistTasks, tasks, threads]);

  const addTask = () => {
    const trimmed = title.trim();
    if (trimmed === "") return;
    persistTasks([...tasks, createBoardTask(new Date(), trimmed)]);
    setTitle("");
  };

  const startTask = async (task: CodeitlabTask) => {
    const project = sortScopedProjectsForSidebar(
      projects.filter((entry) => entry.isScratch !== true),
      threads,
      "updated_at",
    )[0];
    if (project === undefined) {
      toastManager.add({
        type: "error",
        title: "Open a project first",
        description: "Board tasks run as threads in a project, so their changes have a home.",
      });
      return;
    }
    setStartingId(task.id);
    try {
      const opened = await handleNewThread(scopeProjectRef(project.environmentId, project.id), {
        replace: true,
      });
      if (opened === null) {
        toastManager.add({
          type: "error",
          title: "Could not open a thread",
          description: "Try again, or start the task from the composer.",
        });
        return;
      }
      useComposerDraftStore.getState().setPrompt(opened.draftId, boardTaskPrompt(task));
      persistTasks(startBoardTask(tasks, task.id, opened.threadId, new Date()));
      toastManager.add({
        type: "success",
        title: "Task started",
        description: "Its thread is open with the task in the composer.",
      });
    } finally {
      setStartingId(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <CodeitlabSectionHeading
        eyebrow="CodeItLab // board"
        title="Board"
        description="Tasks move through four columns. Starting one opens a normal thread, so every task is steerable and diffable like any other run."
      />

      <CodeitlabCard className="flex flex-col gap-3 p-4">
        <p
          className={
            remote.error !== null && !usingDatabase
              ? "text-2xs text-destructive"
              : "text-2xs text-muted-foreground"
          }
          aria-live="polite"
        >
          {usingDatabase
            ? "Reading the shared board from the database."
            : remote.isPending
              ? "Reading the shared board; showing the local copy until it answers."
              : remote.error !== null
                ? `Could not read the shared board (${remote.error}). The local copy below still works and saves with your settings.`
                : "Showing the local copy: the database has no tasks yet, so this board is saved with your settings."}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label="New task"
            placeholder="What should happen next?"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addTask();
              }
            }}
            className="min-w-56 flex-1"
          />
          <Button type="button" size="sm" onClick={addTask} disabled={title.trim() === ""}>
            <PlusIcon aria-hidden className="size-4" />
            Add task
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">
          {active.length} active · {archived.length} archived · completed tasks archive after{" "}
          {BOARD_AUTO_ARCHIVE_DAYS} days
        </p>
      </CodeitlabCard>

      <CodeitlabCard className="flex flex-wrap items-baseline gap-x-4 gap-y-1 p-4">
        <p className="text-sm font-medium">
          <span className="tabular-nums">{progress.completedCount}</span> completed
        </p>
        <p className="text-muted-foreground text-xs">
          <span className="tabular-nums">{progress.currentStreak}</span>-day streak
          {progress.bestStreak > 0 ? (
            <>
              {" "}
              · best <span className="tabular-nums">{progress.bestStreak}</span>
              {progress.bestStreakDay === "" ? "" : ` (${progress.bestStreakDay})`}
            </>
          ) : null}
        </p>
        <p className="text-muted-foreground text-2xs">
          Counts only tasks completed on this board, by UTC day. Moving a task out of Completed
          removes it from the count; archiving hides a task but keeps it in the history.
        </p>
      </CodeitlabCard>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {CODEITLAB_BOARD_COLUMNS.map((column) => {
          const columnTasks = tasksInColumn(tasks, column);
          return (
            <section
              key={column}
              aria-label={BOARD_COLUMN_LABELS[column]}
              className="flex min-h-40 flex-col gap-2"
            >
              <header className="flex items-baseline justify-between gap-2">
                <h3 className="text-sm font-medium">{BOARD_COLUMN_LABELS[column]}</h3>
                <span className="text-muted-foreground text-xs tabular-nums">
                  {columnTasks.length}
                </span>
              </header>
              <p className="text-muted-foreground text-xs">{BOARD_COLUMN_HINTS[column]}</p>
              {columnTasks.length === 0 ? (
                <p className="text-muted-foreground rounded-md border border-dashed px-3 py-4 text-xs">
                  {column === "pending"
                    ? "Add a task above to fill this column."
                    : "Nothing here yet. Move a task in with the arrows."}
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {columnTasks.map((task) => (
                    <li key={task.id}>
                      <CodeitlabCard className="flex flex-col gap-2 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium">{task.title}</p>
                          <span className="text-muted-foreground text-2xs tabular-nums">
                            {task.updatedAt.slice(0, 10)}
                          </span>
                        </div>
                        {task.notes.trim() === "" ? null : (
                          <p className="text-muted-foreground text-xs whitespace-pre-wrap">
                            {task.notes}
                          </p>
                        )}
                        {task.threadId === "" ? null : (
                          <p className="text-muted-foreground text-2xs">
                            Thread {task.threadId.slice(0, 8)}
                          </p>
                        )}
                        <div className="flex flex-wrap items-center gap-1">
                          <Button
                            aria-label={`Details for ${task.title}`}
                            onClick={() => {
                              setDetailsId(task.id);
                              setNotesDraft(task.notes);
                            }}
                            size="xs"
                            type="button"
                            variant="ghost"
                          >
                            <FileTextIcon aria-hidden className="size-3.5" />
                            Details
                          </Button>
                          {task.threadId === "" || environmentId === null ? null : (
                            <Button
                              aria-label={`Open thread for ${task.title}`}
                              onClick={() =>
                                void navigate({
                                  to: "/$environmentId/$threadId",
                                  params: { environmentId, threadId: task.threadId },
                                })
                              }
                              size="xs"
                              type="button"
                              variant="ghost"
                            >
                              Open thread
                            </Button>
                          )}
                          <Button
                            type="button"
                            size="xs"
                            variant="outline"
                            disabled={startingId === task.id}
                            onClick={() => void startTask(task)}
                          >
                            <PlayIcon aria-hidden className="size-3.5" />
                            {task.threadId === "" ? "Start" : "Restart"}
                          </Button>
                          {PREVIOUS_COLUMN[column] === null ? null : (
                            <Button
                              type="button"
                              size="icon-xs"
                              variant="ghost"
                              aria-label={`Move ${task.title} to ${BOARD_COLUMN_LABELS[PREVIOUS_COLUMN[column]!]}`}
                              onClick={() =>
                                persistTasks(
                                  moveBoardTask(
                                    tasks,
                                    task.id,
                                    PREVIOUS_COLUMN[column]!,
                                    new Date(),
                                  ),
                                )
                              }
                            >
                              <ChevronLeftIcon aria-hidden className="size-4" />
                            </Button>
                          )}
                          {NEXT_COLUMN[column] === null ? null : (
                            <Button
                              type="button"
                              size="icon-xs"
                              variant="ghost"
                              aria-label={`Move ${task.title} to ${BOARD_COLUMN_LABELS[NEXT_COLUMN[column]!]}`}
                              onClick={() =>
                                persistTasks(
                                  moveBoardTask(tasks, task.id, NEXT_COLUMN[column]!, new Date()),
                                )
                              }
                            >
                              <ChevronRightIcon aria-hidden className="size-4" />
                            </Button>
                          )}
                          <Button
                            type="button"
                            size="icon-xs"
                            variant="ghost"
                            aria-label={`Archive ${task.title}`}
                            onClick={() =>
                              persistTasks(archiveBoardTask(tasks, task.id, new Date()))
                            }
                          >
                            <ArchiveIcon aria-hidden className="size-4" />
                          </Button>
                          <Button
                            type="button"
                            size="icon-xs"
                            variant="ghost"
                            aria-label={`Delete ${task.title}`}
                            onClick={() =>
                              persistTasks(tasks.filter((entry) => entry.id !== task.id))
                            }
                          >
                            <Trash2Icon aria-hidden className="size-4" />
                          </Button>
                        </div>
                      </CodeitlabCard>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      <section aria-label="Archived tasks" className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Archived</h3>
        {archived.length === 0 ? (
          <CodeitlabEmptyBlock
            title="Nothing archived"
            description="Archived and week-old completed tasks collect here so the board stays focused."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {archived.map((task) => (
              <li key={task.id}>
                <CodeitlabCard className="flex flex-wrap items-center justify-between gap-2 p-3">
                  <div className="flex flex-col">
                    <p className="text-sm font-medium">{task.title}</p>
                    <p className="text-muted-foreground text-xs">
                      {BOARD_COLUMN_LABELS[task.column]} · archived {task.archivedAt.slice(0, 10)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      onClick={() => persistTasks(unarchiveBoardTask(tasks, task.id, new Date()))}
                    >
                      <ArchiveRestoreIcon aria-hidden className="size-3.5" />
                      Unarchive
                    </Button>
                    <Button
                      aria-label={`Delete ${task.title} permanently`}
                      type="button"
                      size="icon-xs"
                      variant="ghost"
                      onClick={() => persistTasks(tasks.filter((entry) => entry.id !== task.id))}
                    >
                      <Trash2Icon aria-hidden className="size-4" />
                    </Button>
                  </div>
                </CodeitlabCard>
              </li>
            ))}
          </ul>
        )}
      </section>
      <Sheet
        open={detailsTask !== null}
        onOpenChange={(open) => {
          if (!open) setDetailsId(null);
        }}
      >
        <SheetContent side="right">
          <div className="flex flex-col gap-4 p-4">
            <SheetHeader>
              <SheetTitle>{detailsTask?.title ?? "Task"}</SheetTitle>
              <SheetDescription>
                Notes are saved on the task and included when it starts a thread. The thread itself
                opens as a full page so there is one chat view, not a copy.
              </SheetDescription>
            </SheetHeader>
            {detailsTask === null ? null : (
              <>
                <label className="text-xs font-medium text-muted-foreground" htmlFor="board-notes">
                  Notes
                </label>
                <Textarea
                  id="board-notes"
                  onChange={(event) => setNotesDraft(event.currentTarget.value)}
                  placeholder="Constraints, links, acceptance criteria"
                  rows={6}
                  value={notesDraft}
                />
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      persistTasks(
                        updateBoardTaskNotes(tasks, detailsTask.id, notesDraft, new Date()),
                      );
                      setDetailsId(null);
                    }}
                  >
                    Save notes
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setDetailsId(null)}
                  >
                    Cancel
                  </Button>
                </div>
                <p className="text-2xs text-muted-foreground">
                  {detailsTask.notes.trim() === ""
                    ? "No notes yet."
                    : `Saved notes: ${detailsTask.notes}`}
                </p>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
