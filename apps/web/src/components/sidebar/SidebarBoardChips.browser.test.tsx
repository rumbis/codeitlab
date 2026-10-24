import type { CodeitlabBoardSettings } from "@codeitlab/core/board";
import { describe, expect, it, vi } from "vite-plus/test";

import "~/index.css";

import { render as renderUi } from "../../../test/render";
import { SidebarBoardChips } from "./SidebarBoardChips";

const mock = vi.hoisted(() => ({
  board: { tasks: [] } as CodeitlabBoardSettings,
}));

vi.mock(import("../../codeitlab/effectsSettings"), async (original) => ({
  ...(await original()),
  useCodeitlabSettingsWriter: (() => ({
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
    const row = screen.container.querySelector('[aria-label="Board counts"]');
    expect(row).not.toBeNull();
    expect(row?.textContent).toContain("2");
    expect(screen.getByLabelText("Pending: 2 tasks")).not.toBeNull();
    expect(screen.getByLabelText("In progress: 1 task")).not.toBeNull();
    expect(screen.getByLabelText("Completed: 1 task")).not.toBeNull();
    const link = screen.container.querySelector<HTMLAnchorElement>('a[href="/board"]');
    expect(link).not.toBeNull();
  });
});
