import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render as renderUi } from "../../../test/render";
import { CodeitlabOverviewPage } from "./CodeitlabOverviewPage";

const mock = vi.hoisted(() => ({
  updates: [] as Array<{ board: { tasks: ReadonlyArray<{ title: string; notes: string }> } }>,
  upserts: [] as ReadonlyArray<{ title: string; notes: string }>,
}));

vi.mock(import("../../codeitlab/api"), async (original) => ({
  ...(await original()),
  useCodeitlabTasks: (() => ({
    data: [],
    source: "local",
    error: null,
    isPending: false,
    refresh: () => {},
    upsert: async (task: { title: string; notes: string }) => {
      mock.upserts = [...mock.upserts, task];
      return task;
    },
    remove: async () => true,
  })) as never,
  useCodeitlabNexusRefresh: (() => async () => null) as never,
}));

vi.mock(import("../../codeitlab/effectsSettings"), async (original) => ({
  ...(await original()),
  useCodeitlabSettingsWriter: (() => ({
    codeitlab: { board: { tasks: [] } },
    environmentId: "local",
    update: (patch: { board: { tasks: ReadonlyArray<{ title: string; notes: string }> } }) => {
      mock.updates.push(patch);
      return patch;
    },
  })) as never,
}));

describe("CodeitlabOverviewPage quests", () => {
  it("offers to turn the next quest into a board task", async () => {
    await using screen = await renderUi(<CodeitlabOverviewPage />);
    const button = screen.getByText("Add as board task");
    expect(button).not.toBeNull();
    await userEvent.click(button);
    expect(mock.updates.length).toBe(1);
    const task = mock.updates[0]?.board.tasks[0];
    expect(task?.title.length).toBeGreaterThan(0);
    expect(task?.notes).toContain("Where: /settings/codeitlab/");
    expect(mock.upserts).toHaveLength(1);
    expect(mock.upserts[0]?.title).toBe(task?.title);
  });
});
