import type { CodeItLabBoardSettings } from "@codeitlab/core/board";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render as renderUi } from "../../../test/render";
import { CodeItLabBoardPage } from "./CodeItLabBoardPage";

const mock = vi.hoisted(() => ({
  board: { tasks: [] } as CodeItLabBoardSettings,
  updates: [] as Array<{ board: CodeItLabBoardSettings }>,
  shells: [] as ReadonlyArray<unknown>,
  environmentId: "local" as string | null,
  remoteSource: "local" as "local" | "server",
  remoteError: null as string | null,
  remoteTasks: [] as ReadonlyArray<unknown>,
  upserts: [] as ReadonlyArray<unknown>,
  projects: [] as ReadonlyArray<Record<string, unknown>>,
  removes: [] as ReadonlyArray<string>,
  xpRefreshes: 0,
}));

vi.mock(import("../../codeitlab/effectsSettings"), async (original) => ({
  ...(await original()),
  useCodeItLabSettingsWriter: (() => ({
    codeitlab: { board: mock.board },
    environmentId: mock.environmentId,
    update: (patch: { board: CodeItLabBoardSettings }) => {
      mock.updates.push(patch);
      mock.board = patch.board;
      return { board: mock.board };
    },
  })) as never,
}));

vi.mock(import("../../codeitlab/api"), async (original) => ({
  ...(await original()),
  useCodeItLabTasks: (() => ({
    data: mock.remoteTasks,
    source: mock.remoteSource,
    error: mock.remoteError,
    isPending: false,
    refresh: () => {},
    upsert: async (task: unknown) => {
      mock.upserts = [...mock.upserts, task];
      return task;
    },
    remove: async (id: string) => {
      mock.removes = [...mock.removes, id];
      return true;
    },
  })) as never,
}));

vi.mock(import("../../state/entities"), async (original) => ({
  ...(await original()),
  useProjects: (() => mock.projects) as never,
  useThreadShells: (() => mock.shells) as never,
}));

vi.mock(import("../../codeitlab/xp"), async (original) => ({
  ...(await original()),
  useCodeItLabXp: (() => ({
    state: null,
    refresh: () => {
      mock.xpRefreshes += 1;
    },
    record: async () => null,
  })) as never,
}));

vi.mock(import("../../hooks/useHandleNewThread"), async (original) => ({
  ...(await original()),
  useNewThreadHandler: (() => async () => ({
    threadId: "thread-9",
    draftId: "draft-9",
  })) as never,
}));

const shell = (patch: Record<string, unknown>) => ({
  id: "thread-1",
  runtime: {
    status: "idle",
    activeRunId: null,
    providerInstanceId: "codex",
    providerName: "Codex",
    lastError: null,
    updatedAt: "2026-10-24T12:02:00.000Z",
  },
  latestRun: {
    runId: "run-1",
    status: "completed",
    requestedAt: "2026-10-24T12:00:00.000Z",
    startedAt: "2026-10-24T12:00:00.000Z",
    completedAt: "2026-10-24T12:01:00.000Z",
  },
  ...patch,
});

describe("board page", () => {
  it("adds a task to the pending column from the input", async () => {
    mock.board = { tasks: [] };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeItLabBoardPage />);
    const input = screen.container.querySelector<HTMLInputElement>('input[aria-label="New task"]');
    expect(input).not.toBeNull();
    await userEvent.type(input!, "Ship the board");
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(mock.updates).toHaveLength(1));
    expect(mock.updates[0]?.board.tasks[0]?.title).toBe("Ship the board");
    expect(mock.updates[0]?.board.tasks[0]?.column).toBe("pending");
  });

  it("clears a half-typed task with Escape and saves nothing", async () => {
    mock.board = { tasks: [] };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeItLabBoardPage />);
    const input = screen.container.querySelector<HTMLInputElement>('input[aria-label="New task"]');
    await userEvent.type(input!, "Half a thought");
    expect(input!.value).toBe("Half a thought");
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(input!.value).toBe(""));
    expect(mock.updates).toHaveLength(0);
    expect(document.activeElement).toBe(input);
  });

  it("moves a task to the next column with its labelled arrow", async () => {
    mock.board = {
      tasks: [
        {
          id: "task-1",
          title: "Fix login",
          notes: "",
          column: "pending" as const,
          createdAt: "2026-10-20T00:00:00.000Z",
          updatedAt: "2026-10-20T00:00:00.000Z",
          threadId: "",
          archivedAt: "",
          completedAt: "",
        },
      ],
    };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeItLabBoardPage />);
    await userEvent.click(screen.getByText("Fix login"));
    const move = screen.container.querySelector<HTMLElement>(
      '[aria-label="Move Fix login to In progress"]',
    );
    expect(move).not.toBeNull();
    await userEvent.click(move!);
    await vi.waitFor(() => expect(mock.updates).toHaveLength(1));
    expect(mock.updates[0]?.board.tasks[0]?.column).toBe("inProgress");
  });

  it("asks the XP ring to refresh when a task lands in Completed", async () => {
    const base = {
      notes: "",
      threadId: "",
      createdAt: "2026-10-20T00:00:00.000Z",
      updatedAt: "2026-10-20T00:00:00.000Z",
      archivedAt: "",
      completedAt: "",
    };
    mock.board = {
      tasks: [
        { ...base, id: "task-1", title: "Fix login", column: "review" as const },
        { ...base, id: "task-2", title: "Write docs", column: "pending" as const },
      ],
    };
    mock.updates.length = 0;
    mock.xpRefreshes = 0;
    await using screen = await renderUi(<CodeItLabBoardPage />);
    await userEvent.click(screen.getByText("Write docs"));
    await userEvent.click(
      screen.container.querySelector<HTMLElement>('[aria-label="Move Write docs to In progress"]')!,
    );
    // A move that is not a completion must not touch the ring.
    await vi.waitFor(() =>
      expect(
        mock.updates.some((entry) =>
          entry.board.tasks.some((task) => task.id === "task-2" && task.column === "inProgress"),
        ),
      ).toBe(true),
    );
    expect(mock.xpRefreshes).toBe(0);

    await userEvent.click(screen.getByText("Fix login"));
    await userEvent.click(
      screen.container.querySelector<HTMLElement>('[aria-label="Move Fix login to Completed"]')!,
    );
    await vi.waitFor(() => expect(mock.xpRefreshes).toBe(1));
  });

  it("keeps focus and announces the column after a keyboard move", async () => {
    mock.board = {
      tasks: [
        {
          id: "task-1",
          title: "Fix login",
          notes: "",
          column: "pending" as const,
          createdAt: "2026-10-20T00:00:00.000Z",
          updatedAt: "2026-10-20T00:00:00.000Z",
          threadId: "",
          archivedAt: "",
          completedAt: "",
        },
      ],
    };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeItLabBoardPage />);
    await userEvent.click(screen.getByText("Fix login"));
    const move = screen.container.querySelector<HTMLElement>(
      '[aria-label="Move Fix login to In progress"]',
    );
    move?.focus();
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(mock.updates).toHaveLength(1));
    // The arrow that moved the card no longer exists in the new column, so focus
    // goes to the card itself and the move is spoken instead of silent.
    await vi.waitFor(() => expect(document.activeElement?.id).toBe("board-details-task-1"));
    const status = screen.container.querySelector('[role="status"]');
    expect(status?.textContent).toContain("Moved “Fix login” to In progress.");
  });

  it("restores an archived task", async () => {
    mock.board = {
      tasks: [
        {
          id: "task-2",
          title: "Old idea",
          notes: "",
          column: "completed",
          createdAt: "2026-10-01T00:00:00.000Z",
          updatedAt: "2026-10-01T00:00:00.000Z",
          threadId: "",
          archivedAt: "2026-10-10T00:00:00.000Z",
          completedAt: "",
        },
      ],
    };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeItLabBoardPage />);
    await userEvent.click(screen.getByText("Unarchive"));
    await vi.waitFor(() => expect(mock.updates).toHaveLength(1));
    expect(mock.updates[0]?.board.tasks[0]?.archivedAt).toBe("");
  });

  it("moves an in-progress task to review when its own run completed", async () => {
    mock.board = {
      tasks: [
        {
          id: "task-3",
          title: "Finished work",
          notes: "",
          column: "inProgress",
          createdAt: "2026-10-24T11:59:00.000Z",
          updatedAt: "2026-10-24T12:00:00.000Z",
          threadId: "thread-1",
          archivedAt: "",
          completedAt: "",
        },
      ],
    };
    mock.shells = [shell({})];
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeItLabBoardPage />);
    await vi.waitFor(() => expect(mock.updates).toHaveLength(1));
    expect(mock.updates[0]?.board.tasks[0]?.column).toBe("review");
    expect(screen.getByText("Finished work")).not.toBeNull();
  });

  it("leaves a task in progress while its run is still working", async () => {
    mock.board = {
      tasks: [
        {
          id: "task-4",
          title: "Still running",
          notes: "",
          column: "inProgress",
          createdAt: "2026-10-24T11:59:00.000Z",
          updatedAt: "2026-10-24T12:00:00.000Z",
          threadId: "thread-1",
          archivedAt: "",
          completedAt: "",
        },
      ],
    };
    mock.shells = [
      shell({
        runtime: {
          status: "running",
          activeRunId: "run-2",
          providerInstanceId: "codex",
          providerName: "Codex",
          lastError: null,
          updatedAt: "2026-10-24T12:02:00.000Z",
        },
        latestRun: null,
      }),
    ];
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeItLabBoardPage />);
    expect(screen.getByText("Still running")).not.toBeNull();
    expect(mock.updates).toHaveLength(0);
  });

  it("opens the thread from the keyboard", async () => {
    mock.board = {
      tasks: [
        {
          id: "task-1",
          title: "Fix checkout",
          notes: "",
          column: "inProgress",
          createdAt: "2026-10-20T10:00:00.000Z",
          updatedAt: "2026-10-20T10:00:00.000Z",
          threadId: "thread-1",
          archivedAt: "",
          completedAt: "",
        },
      ],
    };
    mock.shells = [shell({})];
    await using screen = await renderUi(<CodeItLabBoardPage />);
    const button = screen.container.querySelector<HTMLButtonElement>(
      '[aria-label="Open thread for Fix checkout"]',
    );
    expect(button).not.toBeNull();
    button?.focus();
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(screen.router?.state.location.pathname).toBe("/local/thread-1"));
  });

  it("opens the thread a started task points at", async () => {
    mock.board = {
      tasks: [
        {
          id: "task-1",
          title: "Fix checkout",
          notes: "",
          column: "inProgress",
          createdAt: "2026-10-20T10:00:00.000Z",
          updatedAt: "2026-10-20T10:00:00.000Z",
          threadId: "thread-1",
          archivedAt: "",
          completedAt: "",
        },
      ],
    };
    mock.updates.length = 0;
    mock.shells = [shell({})];
    await using screen = await renderUi(<CodeItLabBoardPage />);
    await userEvent.click(screen.getByLabelText("Open thread for Fix checkout"));
    await vi.waitFor(() => expect(screen.router?.state.location.pathname).toBe("/local/thread-1"));
  });

  it("reads the shared board from the database when it answers", async () => {
    mock.remoteSource = "server";
    mock.remoteTasks = [
      {
        id: "remote-1",
        title: "Shared task",
        notes: "",
        column: "pending" as const,
        threadId: "",
        createdAt: "2026-10-20T10:00:00.000Z",
        updatedAt: "2026-10-20T10:00:00.000Z",
        archivedAt: "",
        completedAt: "",
      },
    ];
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeItLabBoardPage />);
    expect(screen.getByText("Shared task")).not.toBeNull();
    expect(screen.getByText(/Reading the shared board from the database/)).not.toBeNull();
  });

  it("says it is on the local copy when the database has no tasks", async () => {
    mock.remoteSource = "local";
    mock.remoteTasks = [];
    await using screen = await renderUi(<CodeItLabBoardPage />);
    expect(screen.getByText(/Showing the local copy/)).not.toBeNull();
  });

  it("mirrors only the task that changed", async () => {
    const base = {
      notes: "",
      threadId: "",
      createdAt: "2026-10-20T10:00:00.000Z",
      updatedAt: "2026-10-20T10:00:00.000Z",
      archivedAt: "",
      completedAt: "",
    };
    mock.remoteSource = "local";
    mock.remoteTasks = [];
    mock.board = {
      tasks: [
        { ...base, id: "a", title: "A", column: "pending" },
        { ...base, id: "b", title: "B", column: "pending" },
        { ...base, id: "c", title: "C", column: "pending" },
      ],
    };
    mock.upserts = [];
    mock.removes = [];
    await using screen = await renderUi(<CodeItLabBoardPage />);
    await userEvent.click(screen.getByLabelText("Move B to In progress"));
    await vi.waitFor(() => expect(mock.upserts).toHaveLength(1));
    expect((mock.upserts[0] as { id: string }).id).toBe("b");
    expect(mock.removes).toEqual([]);
  });

  it("moves a task with the keyboard from the move button", async () => {
    mock.board = {
      tasks: [
        {
          id: "a",
          title: "A",
          notes: "",
          column: "pending" as const,
          threadId: "",
          createdAt: "2026-10-20T10:00:00.000Z",
          updatedAt: "2026-10-20T10:00:00.000Z",
          archivedAt: "",
          completedAt: "",
        },
      ],
    };
    mock.upserts = [];
    await using screen = await renderUi(<CodeItLabBoardPage />);
    const move = [...screen.container.querySelectorAll("button")].find(
      (button) => button.getAttribute("aria-label") === "Move A to In progress",
    );
    expect(move).toBeDefined();
    move?.focus();
    expect(document.activeElement).toBe(move);
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(mock.upserts).toHaveLength(1));
    expect((mock.upserts[0] as { column: string }).column).toBe("inProgress");
  });

  it("keeps the local board when the database has no rows", async () => {
    const task = {
      id: "local-1",
      title: "Local task",
      notes: "",
      column: "pending" as const,
      threadId: "",
      createdAt: "2026-10-20T10:00:00.000Z",
      updatedAt: "2026-10-20T10:00:00.000Z",
      archivedAt: "",
      completedAt: "",
    };
    mock.board = { tasks: [task] };
    mock.remoteSource = "server";
    mock.remoteTasks = [];
    await using screen = await renderUi(<CodeItLabBoardPage />);
    expect(screen.getByText("Local task")).not.toBeNull();
    expect(screen.getByText(/showing the local copy|Reading the shared board/)).not.toBeNull();
  });

  it("edits a task's notes in the details sheet", async () => {
    const task = {
      id: "notes-1",
      title: "Add notes",
      notes: "",
      column: "pending" as const,
      threadId: "",
      createdAt: "2026-10-20T10:00:00.000Z",
      updatedAt: "2026-10-20T10:00:00.000Z",
      archivedAt: "",
      completedAt: "",
    };
    mock.board = { tasks: [task] };
    mock.remoteSource = "local";
    mock.remoteTasks = [];
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeItLabBoardPage />);
    await userEvent.click(screen.getByLabelText("Details for Add notes"));
    await vi.waitFor(() =>
      expect(document.querySelector<HTMLTextAreaElement>("#board-notes")).not.toBeNull(),
    );
    const notes = document.querySelector<HTMLTextAreaElement>("#board-notes");
    await userEvent.fill(notes as HTMLTextAreaElement, "Safari only");
    await userEvent.click(screen.getByText("Save notes"));
    await vi.waitFor(() => expect(mock.updates.length).toBeGreaterThan(0));
    const saved = mock.updates.at(-1)?.board.tasks.find((entry) => entry.id === "notes-1");
    expect(saved?.notes).toBe("Safari only");
  });

  it("says the notes are unsaved, then saved, without closing the sheet", async () => {
    const task = {
      id: "notes-2",
      title: "Draft notes",
      notes: "",
      column: "pending" as const,
      threadId: "",
      createdAt: "2026-10-20T10:00:00.000Z",
      updatedAt: "2026-10-20T10:00:00.000Z",
      archivedAt: "",
      completedAt: "",
    };
    mock.board = { tasks: [task] };
    mock.remoteSource = "local";
    mock.remoteTasks = [];
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeItLabBoardPage />);
    await userEvent.click(screen.getByLabelText("Details for Draft notes"));
    const save = await vi.waitFor(() => {
      const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
        (entry) => entry.textContent?.trim() === "Save notes",
      );
      expect(button).not.toBeUndefined();
      return button!;
    });
    // Nothing changed yet, so there is nothing to save and the button says why.
    expect(save.disabled).toBe(true);
    expect(save.getAttribute("aria-describedby")).toBe("board-notes-state");
    const notes = document.querySelector<HTMLTextAreaElement>("#board-notes");
    await userEvent.fill(notes as HTMLTextAreaElement, "Ship on Friday");
    await vi.waitFor(() => expect(save.disabled).toBe(false));
    expect(document.querySelector("#board-notes-state")?.textContent).toContain(
      "Unsaved changes; closing the sheet discards them.",
    );
    await userEvent.click(save);
    await vi.waitFor(() => expect(mock.updates).toHaveLength(1));
    // The sheet stays open so the reader keeps the context they were editing in.
    expect(document.querySelector("#board-notes")).not.toBeNull();
    await vi.waitFor(() =>
      expect(document.querySelector("#board-notes-state")?.textContent).toContain("Notes saved."),
    );
    expect(save.disabled).toBe(true);
  });

  it("closes the details sheet with Escape", async () => {
    const task = {
      id: "esc-1",
      title: "Close me",
      notes: "",
      column: "pending" as const,
      threadId: "",
      createdAt: "2026-10-20T10:00:00.000Z",
      updatedAt: "2026-10-20T10:00:00.000Z",
      archivedAt: "",
      completedAt: "",
    };
    mock.board = { tasks: [task] };
    mock.remoteSource = "local";
    mock.remoteTasks = [];
    await using screen = await renderUi(<CodeItLabBoardPage />);
    const opener = screen.container.querySelector<HTMLButtonElement>(
      '[aria-label="Details for Close me"]',
    );
    await userEvent.click(screen.getByLabelText("Details for Close me"));
    await vi.waitFor(() => expect(document.querySelector("#board-notes")).not.toBeNull());
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(document.querySelector("#board-notes")).toBeNull());
    // Closing returns focus to the control that opened the sheet, not to the body.
    await vi.waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it("deletes an archived task permanently", async () => {
    const archived = {
      id: "arch-1",
      title: "Old task",
      notes: "",
      column: "completed" as const,
      threadId: "",
      createdAt: "2026-10-01T10:00:00.000Z",
      updatedAt: "2026-10-01T10:00:00.000Z",
      archivedAt: "2026-10-02T10:00:00.000Z",
      completedAt: "",
    };
    mock.board = { tasks: [archived] };
    mock.remoteSource = "local";
    mock.remoteTasks = [];
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeItLabBoardPage />);
    await userEvent.click(screen.getByLabelText("Delete Old task permanently"));
    await vi.waitFor(() => expect(mock.updates.length).toBeGreaterThan(0));
    expect(mock.updates.at(-1)?.board.tasks).toHaveLength(0);
  });

  it("counts completed tasks and shows a streak", async () => {
    const completed = (id: string, when: Date) => ({
      id,
      title: `Done ${id}`,
      notes: "",
      column: "completed" as const,
      threadId: "",
      createdAt: when.toISOString(),
      updatedAt: when.toISOString(),
      archivedAt: "",
      completedAt: "",
    });
    const day = 24 * 60 * 60 * 1000;
    mock.board = {
      tasks: [completed("a", new Date(Date.now())), completed("b", new Date(Date.now() - day))],
    };
    mock.remoteSource = "local";
    mock.remoteTasks = [];
    await using screen = await renderUi(<CodeItLabBoardPage />);
    expect(screen.getByText("2", { exact: true })).not.toBeNull();
    expect(screen.getByText(/2-day streak/)).not.toBeNull();
    expect(screen.getByText(/Counts only tasks completed on this board/)).not.toBeNull();
  });

  it("opens the details sheet from the keyboard", async () => {
    const task = {
      id: "kbd-1",
      title: "Keyboard details",
      notes: "",
      column: "pending" as const,
      threadId: "",
      createdAt: "2026-10-20T10:00:00.000Z",
      updatedAt: "2026-10-20T10:00:00.000Z",
      archivedAt: "",
      completedAt: "",
    };
    mock.board = { tasks: [task] };
    mock.remoteSource = "local";
    mock.remoteTasks = [];
    await using screen = await renderUi(<CodeItLabBoardPage />);
    const details = [...screen.container.querySelectorAll("button")].find(
      (button) => button.getAttribute("aria-label") === "Details for Keyboard details",
    );
    expect(details?.type).toBe("button");
    details?.focus();
    expect(document.activeElement).toBe(details);
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() =>
      expect(document.querySelector<HTMLTextAreaElement>("#board-notes")).not.toBeNull(),
    );
  });

  it("deletes an archived task from the keyboard", async () => {
    const archived = {
      id: "kbd-arch",
      title: "Keyboard archived",
      notes: "",
      column: "completed" as const,
      threadId: "",
      createdAt: "2026-10-01T10:00:00.000Z",
      updatedAt: "2026-10-01T10:00:00.000Z",
      archivedAt: "2026-10-02T10:00:00.000Z",
      completedAt: "",
    };
    mock.board = { tasks: [archived] };
    mock.remoteSource = "local";
    mock.remoteTasks = [];
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeItLabBoardPage />);
    const remove = [...screen.container.querySelectorAll("button")].find(
      (button) => button.getAttribute("aria-label") === "Delete Keyboard archived permanently",
    );
    expect(remove?.type).toBe("button");
    remove?.focus();
    expect(document.activeElement).toBe(remove);
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(mock.updates.length).toBeGreaterThan(0));
    expect(mock.updates.at(-1)?.board.tasks).toHaveLength(0);
  });

  it("explains a database read failure and keeps the local board usable", async () => {
    const task = {
      id: "err-1",
      title: "Local still works",
      notes: "",
      column: "pending" as const,
      threadId: "",
      createdAt: "2026-10-20T10:00:00.000Z",
      updatedAt: "2026-10-20T10:00:00.000Z",
      archivedAt: "",
      completedAt: "",
    };
    mock.board = { tasks: [task] };
    mock.remoteSource = "local";
    mock.remoteTasks = [];
    mock.remoteError = "database is locked";
    try {
      await using screen = await renderUi(<CodeItLabBoardPage />);
      expect(
        screen.getByText(/Could not read the shared board \(database is locked\)/),
      ).not.toBeNull();
      expect(screen.getByText(/local copy below still works/)).not.toBeNull();
      expect(screen.getByText("Local still works")).not.toBeNull();
    } finally {
      mock.remoteError = null;
    }
  });

  it("shows when a completed task was completed, in UTC", async () => {
    const task = {
      id: "done-1",
      title: "Finished task",
      notes: "",
      column: "pending" as const,
      threadId: "",
      createdAt: "2026-10-20T10:00:00.000Z",
      updatedAt: "2026-10-24T10:00:00.000Z",
      archivedAt: "",
      completedAt: "2026-10-24T09:30:00.000Z",
      startedAt: "2026-10-24T08:00:00.000Z",
    };
    mock.board = { tasks: [task] };
    mock.remoteSource = "local";
    mock.remoteTasks = [];
    await using screen = await renderUi(<CodeItLabBoardPage />);
    await userEvent.click(screen.getByLabelText("Details for Finished task"));
    await vi.waitFor(() =>
      expect(document.querySelector('[data-slot="sheet-popup"]')?.textContent).toContain(
        "Completed 2026-10-24 09:30 UTC.",
      ),
    );
    expect(document.querySelector('[data-slot="sheet-popup"]')?.textContent).toContain(
      "This is the day the streak counts.",
    );
    expect(document.querySelector('[data-slot="sheet-popup"]')?.textContent).toContain(
      "Started 2026-10-24 08:00 UTC.",
    );
    expect(document.querySelector('[data-slot="sheet-popup"]')?.textContent).toContain(
      "Created 2026-10-20 10:00 UTC.",
    );
  });

  it("copies the settings board into the database on the first write", async () => {
    const base = {
      notes: "",
      threadId: "",
      createdAt: "2026-10-20T10:00:00.000Z",
      updatedAt: "2026-10-20T10:00:00.000Z",
      archivedAt: "",
      completedAt: "",
    };
    mock.remoteSource = "server";
    mock.remoteTasks = [];
    mock.board = { tasks: [{ ...base, id: "old", title: "Old task", column: "pending" }] };
    mock.upserts = [];
    try {
      await using screen = await renderUi(<CodeItLabBoardPage />);
      await userEvent.fill(screen.getByLabelText("New task"), "New task");
      await userEvent.click(screen.getByText("Add task"));
      await vi.waitFor(() =>
        expect((mock.upserts as ReadonlyArray<{ id: string }>).map((task) => task.id)).toEqual([
          "old",
          expect.any(String),
        ]),
      );
    } finally {
      mock.remoteSource = "local";
      mock.remoteTasks = [];
    }
  });

  it("removes a database task from the database when settings is empty", async () => {
    const base = {
      notes: "",
      threadId: "",
      createdAt: "2026-10-20T10:00:00.000Z",
      updatedAt: "2026-10-20T10:00:00.000Z",
      archivedAt: "",
      completedAt: "",
    };
    mock.remoteSource = "server";
    mock.remoteTasks = [
      { ...base, id: "db-a", title: "Database A", column: "pending" },
      { ...base, id: "db-b", title: "Database B", column: "pending" },
    ];
    mock.board = { tasks: [] };
    mock.upserts = [];
    mock.removes = [];
    try {
      await using screen = await renderUi(<CodeItLabBoardPage />);
      await userEvent.click(screen.getByLabelText("Delete Database A"));
      await vi.waitFor(() => expect(mock.removes).toEqual(["db-a"]));
      expect(mock.upserts).toEqual([]);
    } finally {
      mock.remoteSource = "local";
      mock.remoteTasks = [];
    }
  });

  it("archives a stale database task in the database too", async () => {
    const base = {
      notes: "",
      threadId: "",
      createdAt: "2026-09-20T10:00:00.000Z",
      updatedAt: "2026-09-20T10:00:00.000Z",
      archivedAt: "",
      completedAt: "2026-09-25T10:00:00.000Z",
    };
    mock.remoteSource = "server";
    mock.remoteTasks = [{ ...base, id: "stale-db", title: "Stale task", column: "completed" }];
    mock.board = { tasks: [] };
    mock.upserts = [];
    try {
      await using screen = await renderUi(<CodeItLabBoardPage />);
      await vi.waitFor(() =>
        expect(
          (mock.upserts as ReadonlyArray<{ id: string; archivedAt: string }>).find(
            (task) => task.id === "stale-db",
          )?.archivedAt,
        ).toMatch(/^2026-/u),
      );
      expect(screen.getByText(/Archived 1 completed task/u)).not.toBeNull();
    } finally {
      mock.remoteSource = "local";
      mock.remoteTasks = [];
    }
  });

  it("unarchives a database task in the database when settings is empty", async () => {
    const archived = {
      id: "db-arch",
      title: "Database archived",
      notes: "",
      column: "completed" as const,
      threadId: "",
      createdAt: "2026-09-20T10:00:00.000Z",
      updatedAt: "2026-09-22T10:00:00.000Z",
      archivedAt: "2026-09-22T10:00:00.000Z",
      completedAt: "2026-09-21T10:00:00.000Z",
    };
    mock.remoteSource = "server";
    mock.remoteTasks = [archived];
    mock.board = { tasks: [] };
    mock.upserts = [];
    mock.removes = [];
    try {
      await using screen = await renderUi(<CodeItLabBoardPage />);
      await userEvent.click(screen.getByText("Unarchive"));
      await vi.waitFor(() =>
        expect(
          (mock.upserts as ReadonlyArray<{ id: string; archivedAt: string }>).find(
            (task) => task.id === "db-arch",
          )?.archivedAt,
        ).toBe(""),
      );
    } finally {
      mock.remoteSource = "local";
      mock.remoteTasks = [];
    }
  });

  it("records the thread id in the database when a database task starts", async () => {
    const pending = {
      id: "db-start",
      title: "Database pending",
      notes: "",
      column: "pending" as const,
      threadId: "",
      createdAt: "2026-10-20T10:00:00.000Z",
      updatedAt: "2026-10-20T10:00:00.000Z",
      archivedAt: "",
      completedAt: "",
    };
    mock.remoteSource = "server";
    mock.remoteTasks = [pending];
    mock.board = { tasks: [] };
    mock.upserts = [];
    mock.projects = [
      {
        id: "project-1",
        environmentId: "local",
        isScratch: false,
        name: "Project",
        updated_at: "2026-10-20T10:00:00.000Z",
      },
    ];
    try {
      await using screen = await renderUi(<CodeItLabBoardPage />);
      await userEvent.click(screen.getByText("Start"));
      await vi.waitFor(() =>
        expect(
          (mock.upserts as ReadonlyArray<{ id: string; threadId: string }>).find(
            (task) => task.id === "db-start",
          )?.threadId,
        ).toBe("thread-9"),
      );
    } finally {
      mock.projects = [];
      mock.remoteSource = "local";
      mock.remoteTasks = [];
    }
  });

  it("says a task's thread is gone instead of linking to it", async () => {
    mock.board = {
      tasks: [
        {
          id: "orphan-1",
          title: "Orphaned thread",
          notes: "",
          column: "inProgress" as const,
          createdAt: "2026-10-20T10:00:00.000Z",
          updatedAt: "2026-10-20T10:00:00.000Z",
          threadId: "gone-thread-1",
          archivedAt: "",
          completedAt: "",
        },
      ],
    };
    mock.shells = [];
    await using screen = await renderUi(<CodeItLabBoardPage />);
    expect(
      screen.getByText(/Thread gone-thr no longer exists. Start again to open a new one./),
    ).not.toBeNull();
    expect(
      screen.container.querySelector('[aria-label="Open thread for Orphaned thread"]'),
    ).toBeNull();
  });

  it("moves a task to review after its run finished, even if notes were edited later", async () => {
    mock.remoteSource = "local";
    mock.remoteTasks = [];
    mock.board = {
      tasks: [
        {
          id: "edited-1",
          title: "Notes edited later",
          notes: "Added after the run",
          column: "inProgress" as const,
          createdAt: "2026-10-24T11:00:00.000Z",
          updatedAt: "2026-10-24T13:00:00.000Z",
          threadId: "thread-1",
          archivedAt: "",
          completedAt: "",
          startedAt: "2026-10-24T12:00:00.000Z",
        },
      ],
    };
    mock.shells = [shell({})];
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeItLabBoardPage />);
    await vi.waitFor(() => expect(mock.updates).toHaveLength(1));
    expect(mock.updates[0]?.board.tasks[0]?.column).toBe("review");
    expect(screen.getByText(/Moved 1 task to Review/)).not.toBeNull();
  });

  it("shows when an in-progress task started, and only then", async () => {
    const base = {
      notes: "",
      threadId: "",
      createdAt: "2026-10-24T11:00:00.000Z",
      updatedAt: "2026-10-24T12:00:00.000Z",
      archivedAt: "",
      completedAt: "",
    };
    mock.board = {
      tasks: [
        {
          ...base,
          id: "running-1",
          title: "Running task",
          column: "inProgress" as const,
          startedAt: "2026-10-24T12:00:00.000Z",
        },
        {
          ...base,
          id: "pending-1",
          title: "Pending task",
          column: "pending" as const,
          startedAt: "2026-10-24T12:00:00.000Z",
        },
      ],
    };
    await using screen = await renderUi(<CodeItLabBoardPage />);
    const started = screen.container.querySelectorAll("p");
    const texts = [...started].map((node) => node.textContent ?? "");
    expect(texts.filter((text) => text === "Started 2026-10-24 12:00 UTC")).toHaveLength(1);
    expect(screen.getByText("Pending task")).not.toBeNull();
  });

  it("archives a task with the keyboard", async () => {
    const task = {
      id: "kbd-archive",
      title: "Keyboard archive",
      notes: "",
      column: "completed" as const,
      threadId: "",
      createdAt: "2026-10-24T10:00:00.000Z",
      updatedAt: "2026-10-24T10:00:00.000Z",
      archivedAt: "",
      completedAt: "2026-10-24T10:00:00.000Z",
    };
    mock.board = { tasks: [task] };
    mock.remoteSource = "local";
    mock.remoteTasks = [];
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeItLabBoardPage />);
    const archive = [...screen.container.querySelectorAll("button")].find(
      (button) => button.getAttribute("aria-label") === "Archive Keyboard archive",
    );
    expect(archive?.type).toBe("button");
    archive?.focus();
    expect(document.activeElement).toBe(archive);
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(mock.updates.at(-1)?.board.tasks[0]?.archivedAt).not.toBe(""));
  });

  it("unarchives a task with the keyboard", async () => {
    const archived = {
      id: "kbd-unarchive",
      title: "Keyboard unarchive",
      notes: "",
      column: "completed" as const,
      threadId: "",
      createdAt: "2026-10-20T10:00:00.000Z",
      updatedAt: "2026-10-20T10:00:00.000Z",
      archivedAt: "2026-10-21T10:00:00.000Z",
      completedAt: "2026-10-20T10:00:00.000Z",
    };
    mock.board = { tasks: [archived] };
    mock.remoteSource = "local";
    mock.remoteTasks = [];
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeItLabBoardPage />);
    const unarchive = [...screen.container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Unarchive"),
    );
    expect(unarchive?.type).toBe("button");
    unarchive?.focus();
    expect(document.activeElement).toBe(unarchive);
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(mock.updates.at(-1)?.board.tasks[0]?.archivedAt).toBe(""));
  });

  it("starts a task with the keyboard when a project is open", async () => {
    const pending = {
      id: "kbd-start",
      title: "Keyboard start",
      notes: "",
      column: "pending" as const,
      threadId: "",
      createdAt: "2026-10-24T10:00:00.000Z",
      updatedAt: "2026-10-24T10:00:00.000Z",
      archivedAt: "",
      completedAt: "",
      startedAt: "",
    };
    mock.board = { tasks: [pending] };
    mock.remoteSource = "local";
    mock.remoteTasks = [];
    mock.upserts = [];
    mock.projects = [
      {
        id: "project-1",
        environmentId: "local",
        isScratch: false,
        name: "Project",
        updated_at: "2026-10-20T10:00:00.000Z",
      },
    ];
    try {
      await using screen = await renderUi(<CodeItLabBoardPage />);
      const start = [...screen.container.querySelectorAll("button")].find(
        (button) => button.textContent?.trim() === "Start",
      );
      expect(start?.type).toBe("button");
      start?.focus();
      expect(document.activeElement).toBe(start);
      await userEvent.keyboard("{Enter}");
      await vi.waitFor(() =>
        expect(
          (mock.upserts as ReadonlyArray<{ id: string; threadId: string }>).find(
            (task) => task.id === "kbd-start",
          )?.threadId,
        ).toBe("thread-9"),
      );
    } finally {
      mock.projects = [];
    }
  });

  it("explains why Start needs a project instead of failing silently", async () => {
    const pending = {
      id: "kbd-start-none",
      title: "Keyboard start without project",
      notes: "",
      column: "pending" as const,
      threadId: "",
      createdAt: "2026-10-24T10:00:00.000Z",
      updatedAt: "2026-10-24T10:00:00.000Z",
      archivedAt: "",
      completedAt: "",
      startedAt: "",
    };
    mock.board = { tasks: [pending] };
    mock.remoteSource = "local";
    mock.remoteTasks = [];
    mock.projects = [];
    await using screen = await renderUi(<CodeItLabBoardPage />);
    const start = [...screen.container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Start",
    );
    start?.focus();
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(screen.getByText("Open a project first")).not.toBeNull());
  });

  it("has a heading structure and a live status line for screen readers", async () => {
    mock.board = { tasks: [] };
    mock.remoteSource = "local";
    mock.remoteTasks = [];
    await using screen = await renderUi(<CodeItLabBoardPage />);
    const headings = [...screen.container.querySelectorAll("h2, h3")].map(
      (heading) => heading.textContent,
    );
    expect(headings).toContain("Board");
    expect(headings).toContain("Pending");
    expect(headings).toContain("In progress");
    expect(headings).toContain("Review");
    expect(headings).toContain("Completed");
    expect(headings).toContain("Archived");
    expect(screen.container.querySelector("h1")).toBeNull();
    const status = screen.container.querySelector('[aria-live="polite"]');
    expect(status?.textContent).toContain("Showing the local copy");
    const sections = [...screen.container.querySelectorAll("section")].map((section) =>
      section.getAttribute("aria-label"),
    );
    expect(sections).toContain("Pending");
    expect(sections).toContain("Completed");
  });
});
