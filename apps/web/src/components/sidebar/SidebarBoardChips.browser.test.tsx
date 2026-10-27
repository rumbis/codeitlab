import type { CodeItLabBoardSettings } from "@codeitlab/core/board";
import { describe, expect, it, vi } from "vite-plus/test";

import "~/index.css";

import { render as renderUi } from "../../../test/render";
import { SidebarBoardChips } from "./SidebarBoardChips";

const mock = vi.hoisted(() => ({
  board: { tasks: [] } as CodeItLabBoardSettings,
  remoteSource: "local" as "local" | "server",
  remoteTasks: [] as ReadonlyArray<unknown>,
}));

vi.mock(import("../../codeitlab/api"), async (original) => ({
  ...(await original()),
  useCodeItLabTasks: (() => ({
    data: mock.remoteTasks,
    source: mock.remoteSource,
    error: null,
    isPending: false,
    refresh: () => {},
    upsert: async (task: unknown) => task,
    remove: async () => true,
  })) as never,
}));

vi.mock(import("../../codeitlab/effectsSettings"), async (original) => ({
  ...(await original()),
  useCodeItLabSettingsWriter: (() => ({
    codeitlab: { board: mock.board },
    environmentId: null,
    update: () => ({ board: mock.board }),
  })) as never,
}));

const task = (id: string, column: "pending" | "inProgress" | "review" | "completed") => ({
  id,
  title: `Task ${id}`,
  notes: "",
  column,
  createdAt: "2026-10-20T00:00:00.000Z",
  updatedAt: "2026-10-20T00:00:00.000Z",
  threadId: "",
  archivedAt: "",
  completedAt: "",
});

describe("sidebar board chips", () => {
  it("renders nothing while the board is empty", async () => {
    mock.board = { tasks: [] };
    await using screen = await renderUi(<SidebarBoardChips />);
    expect(screen.container.querySelector('[aria-label="Board counts"]')).toBeNull();
  });

  it("counts each active column and links to the board", async () => {
    mock.board = {
      tasks: [
        task("a", "pending"),
        task("b", "pending"),
        task("c", "inProgress"),
        task("d", "completed"),
        { ...task("e", "completed"), archivedAt: "2026-10-22T00:00:00.000Z" },
      ],
    };
    await using screen = await renderUi(<SidebarBoardChips />);
    const row = screen.container.querySelector('[role="group"][aria-label="Board counts"]');
    expect(row).not.toBeNull();
    expect(row?.textContent).toContain("2");
    expect(screen.getByLabelText("Pending: 2 tasks")).not.toBeNull();
    expect(screen.getByLabelText("In progress: 1 task")).not.toBeNull();
    expect(screen.getByLabelText("Completed: 1 task")).not.toBeNull();
    const link = screen.container.querySelector<HTMLAnchorElement>('a[href="/board"]');
    expect(link).not.toBeNull();
  });

  it("counts the database copy when the database answered", async () => {
    mock.board = { tasks: [] };
    mock.remoteSource = "server";
    mock.remoteTasks = [task("db-1", "pending"), task("db-2", "review")];
    try {
      await using screen = await renderUi(<SidebarBoardChips />);
      expect(screen.getByLabelText("Pending: 1 task")).not.toBeNull();
      expect(screen.getByLabelText("Review: 1 task")).not.toBeNull();
    } finally {
      mock.remoteSource = "local";
      mock.remoteTasks = [];
    }
  });

  it("falls back to settings while the database has not answered", async () => {
    mock.board = { tasks: [task("local-1", "inProgress")] };
    mock.remoteSource = "local";
    mock.remoteTasks = [];
    await using screen = await renderUi(<SidebarBoardChips />);
    expect(screen.getByLabelText("In progress: 1 task")).not.toBeNull();
  });

  it("labels each chip with its column and count for screen readers", async () => {
    mock.board = { tasks: [task("a", "pending"), task("b", "inProgress"), task("c", "review")] };
    mock.remoteSource = "local";
    mock.remoteTasks = [];
    await using screen = await renderUi(<SidebarBoardChips />);
    const group = screen.container.querySelector('[role="group"][aria-label="Board counts"]');
    expect(group).not.toBeNull();
    expect(screen.getByLabelText("Pending: 1 task")).not.toBeNull();
    expect(screen.getByLabelText("In progress: 1 task")).not.toBeNull();
    expect(screen.getByLabelText("Review: 1 task")).not.toBeNull();
    expect(screen.getByLabelText("Completed: 0 tasks")).not.toBeNull();
  });
});
