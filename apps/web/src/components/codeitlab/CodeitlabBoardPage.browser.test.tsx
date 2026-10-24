import type { CodeitlabBoardSettings } from "@codeitlab/core/board";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render as renderUi } from "../../../test/render";
import { CodeitlabBoardPage } from "./CodeitlabBoardPage";

const mock = vi.hoisted(() => ({
  board: { tasks: [] } as CodeitlabBoardSettings,
  updates: [] as Array<{ board: CodeitlabBoardSettings }>,
  shells: [] as ReadonlyArray<unknown>,
  environmentId: "local" as string | null,
  remoteSource: "local" as "local" | "server",
  remoteError: null as string | null,
  remoteTasks: [] as ReadonlyArray<unknown>,
  upserts: [] as ReadonlyArray<unknown>,
  removes: [] as ReadonlyArray<string>,
}));

vi.mock(import("../../codeitlab/effectsSettings"), async (original) => ({
  ...(await original()),
  useCodeitlabSettingsWriter: (() => ({
    codeitlab: { board: mock.board },
    environmentId: mock.environmentId,
    update: (patch: { board: CodeitlabBoardSettings }) => {
      mock.updates.push(patch);
      mock.board = patch.board;
      return { board: mock.board };
    },
  })) as never,
}));

vi.mock(import("../../codeitlab/api"), async (original) => ({
  ...(await original()),
  useCodeitlabTasks: (() => ({
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
  useProjects: (() => []) as never,
  useThreadShells: (() => mock.shells) as never,
}));

vi.mock(import("../../hooks/useHandleNewThread"), async (original) => ({
  ...(await original()),
  useNewThreadHandler: (() => async () => null) as never,
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
    await using screen = await renderUi(<CodeitlabBoardPage />);
    const input = screen.container.querySelector<HTMLInputElement>('input[aria-label="New task"]');
    expect(input).not.toBeNull();
    await userEvent.type(input!, "Ship the board");
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(mock.updates).toHaveLength(1));
    expect(mock.updates[0]?.board.tasks[0]?.title).toBe("Ship the board");
    expect(mock.updates[0]?.board.tasks[0]?.column).toBe("pending");
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
    await using screen = await renderUi(<CodeitlabBoardPage />);
    await userEvent.click(screen.getByText("Fix login"));
    const move = screen.container.querySelector<HTMLElement>(
      '[aria-label="Move Fix login to In progress"]',
    );
    expect(move).not.toBeNull();
    await userEvent.click(move!);
    await vi.waitFor(() => expect(mock.updates).toHaveLength(1));
    expect(mock.updates[0]?.board.tasks[0]?.column).toBe("inProgress");
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
    await using screen = await renderUi(<CodeitlabBoardPage />);
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
    await using screen = await renderUi(<CodeitlabBoardPage />);
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
    await using screen = await renderUi(<CodeitlabBoardPage />);
    expect(screen.getByText("Still running")).not.toBeNull();
    expect(mock.updates).toHaveLength(0);
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
    await using screen = await renderUi(<CodeitlabBoardPage />);
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
    await using screen = await renderUi(<CodeitlabBoardPage />);
    expect(screen.getByText("Shared task")).not.toBeNull();
    expect(screen.getByText(/Reading the shared board from the database/)).not.toBeNull();
  });

  it("says it is on the local copy when the database has no tasks", async () => {
    mock.remoteSource = "local";
    mock.remoteTasks = [];
    await using screen = await renderUi(<CodeitlabBoardPage />);
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
    await using screen = await renderUi(<CodeitlabBoardPage />);
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
    await using screen = await renderUi(<CodeitlabBoardPage />);
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
    await using screen = await renderUi(<CodeitlabBoardPage />);
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
    await using screen = await renderUi(<CodeitlabBoardPage />);
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
    await using screen = await renderUi(<CodeitlabBoardPage />);
    await userEvent.click(screen.getByLabelText("Details for Close me"));
    await vi.waitFor(() => expect(document.querySelector("#board-notes")).not.toBeNull());
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(document.querySelector("#board-notes")).toBeNull());
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
    await using screen = await renderUi(<CodeitlabBoardPage />);
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
    await using screen = await renderUi(<CodeitlabBoardPage />);
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
    await using screen = await renderUi(<CodeitlabBoardPage />);
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
    await using screen = await renderUi(<CodeitlabBoardPage />);
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
      await using screen = await renderUi(<CodeitlabBoardPage />);
      expect(
        screen.getByText(/Could not read the shared board \(database is locked\)/),
      ).not.toBeNull();
      expect(screen.getByText(/local copy below still works/)).not.toBeNull();
      expect(screen.getByText("Local still works")).not.toBeNull();
    } finally {
      mock.remoteError = null;
    }
  });
});
