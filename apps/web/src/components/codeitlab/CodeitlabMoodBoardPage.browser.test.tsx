import type { CodeitlabMoodBoardsSettings } from "@codeitlab/core/moodboard";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render as renderUi } from "../../../test/render";
import { CodeitlabMoodBoardPage } from "./CodeitlabMoodBoardPage";

const mock = vi.hoisted(() => ({
  moodboards: { boards: [] } as CodeitlabMoodBoardsSettings,
  updates: [] as Array<{ moodboards: CodeitlabMoodBoardsSettings }>,
}));

vi.mock(import("../../codeitlab/effectsSettings"), async (original) => ({
  ...(await original()),
  useCodeitlabSettingsWriter: (() => ({
    codeitlab: { moodboards: mock.moodboards },
    environmentId: null,
    update: (patch: { moodboards: CodeitlabMoodBoardsSettings }) => {
      mock.updates.push(patch);
      mock.moodboards = patch.moodboards;
      return { moodboards: mock.moodboards };
    },
  })) as never,
}));

vi.mock(import("../../state/entities"), async (original) => ({
  ...(await original()),
  useProjects: (() => []) as never,
  useThreadShells: (() => []) as never,
}));

vi.mock(import("../../hooks/useHandleNewThread"), async (original) => ({
  ...(await original()),
  useNewThreadHandler: (() => async () => null) as never,
}));

const board = {
  id: "mood-1",
  name: "Launch",
  projectId: "",
  colors: [{ hex: "#112233", name: "Ink" }],
  images: [],
  notes: [],
};

describe("mood board page", () => {
  it("starts from the empty state with a new board", async () => {
    mock.moodboards = { boards: [] };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeitlabMoodBoardPage />);
    expect(screen.getByText("No mood boards yet")).not.toBeNull();
    await userEvent.click(screen.getByText("New board"));
    await vi.waitFor(() => expect(mock.updates).toHaveLength(1));
    expect(mock.updates[0]?.moodboards.boards).toHaveLength(1);
  });

  it("adds a normalized hex colour", async () => {
    mock.moodboards = { boards: [{ ...board, colors: [] }] };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeitlabMoodBoardPage />);
    const input = screen.getByLabelText("Colour hex for Launch");
    await userEvent.type(input, "abc");
    await userEvent.click(screen.getByLabelText("Add colour to Launch"));
    await vi.waitFor(() => expect(mock.updates).toHaveLength(1));
    expect(mock.updates[0]?.moodboards.boards[0]?.colors).toEqual([{ hex: "#aabbcc", name: "" }]);
  });

  it("rejects a non-hex colour with a reason", async () => {
    mock.moodboards = { boards: [{ ...board, colors: [] }] };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeitlabMoodBoardPage />);
    const input = screen.getByLabelText("Colour hex for Launch");
    await userEvent.type(input, "blue");
    await userEvent.click(screen.getByLabelText("Add colour to Launch"));
    await vi.waitFor(() => expect(screen.getByText("Not a hex colour")).not.toBeNull());
    expect(mock.updates).toHaveLength(0);
  });

  it("adds a note and refuses to send an empty board", async () => {
    mock.moodboards = { boards: [{ ...board, colors: [], notes: [] }] };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeitlabMoodBoardPage />);
    const input = screen.getByLabelText("Note for Launch");
    await userEvent.type(input, "No gradients");
    await userEvent.click(screen.getByLabelText("Add note to Launch"));
    await vi.waitFor(() => expect(mock.updates).toHaveLength(1));
    expect(mock.updates[0]?.moodboards.boards[0]?.notes).toEqual(["No gradients"]);
    await userEvent.click(screen.getByText("Send to thread"));
    await vi.waitFor(() =>
      expect(screen.getByText(/Add at least one colour, image or note/)).not.toBeNull(),
    );
  });

  it("creates a board from the keyboard", async () => {
    mock.moodboards = { boards: [] };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeitlabMoodBoardPage />);
    const create = [...screen.container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "New board",
    );
    expect(create?.type).toBe("button");
    create?.focus();
    expect(document.activeElement).toBe(create);
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(mock.updates).toHaveLength(1));
    expect(mock.updates[0]?.moodboards.boards).toHaveLength(1);
  });
});
