import type { CodeItLabMoodBoardsSettings } from "@codeitlab/core/moodboard";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render as renderUi } from "../../../test/render";
import { CodeItLabMoodBoardPage } from "./CodeItLabMoodBoardPage";

const mock = vi.hoisted(() => ({
  moodboards: { boards: [] } as CodeItLabMoodBoardsSettings,
  updates: [] as Array<{ moodboards: CodeItLabMoodBoardsSettings }>,
}));

vi.mock(import("../../codeitlab/effectsSettings"), async (original) => ({
  ...(await original()),
  useCodeItLabSettingsWriter: (() => ({
    codeitlab: { moodboards: mock.moodboards },
    environmentId: null,
    update: (patch: { moodboards: CodeItLabMoodBoardsSettings }) => {
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
    await using screen = await renderUi(<CodeItLabMoodBoardPage />);
    expect(screen.getByText("No mood boards yet")).not.toBeNull();
    await userEvent.click(screen.getByText("New board"));
    await vi.waitFor(() => expect(mock.updates).toHaveLength(1));
    expect(mock.updates[0]?.moodboards.boards).toHaveLength(1);
  });

  it("adds a normalized hex colour", async () => {
    mock.moodboards = { boards: [{ ...board, colors: [] }] };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeItLabMoodBoardPage />);
    const input = screen.getByLabelText("Colour hex for Launch");
    await userEvent.type(input, "abc");
    await userEvent.click(screen.getByLabelText("Add colour to Launch"));
    await vi.waitFor(() => expect(mock.updates).toHaveLength(1));
    expect(mock.updates[0]?.moodboards.boards[0]?.colors).toEqual([{ hex: "#aabbcc", name: "" }]);
  });

  it("keeps Add colour disabled with a reason until the hex is usable", async () => {
    mock.moodboards = { boards: [{ ...board, colors: [] }] };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeItLabMoodBoardPage />);
    const add = screen.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Add colour to Launch"]',
    ) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(add.getAttribute("aria-describedby")).toBe("mood-colour-hint-mood-1");
    expect(screen.container.querySelector("#mood-colour-hint-mood-1")?.textContent).toContain(
      "Use #rgb or #rrggbb",
    );
    await userEvent.type(screen.getByLabelText("Colour hex for Launch"), "blue");
    // "blue" is not a hex colour, so the button stays disabled instead of failing later.
    expect(add.disabled).toBe(true);
    await userEvent.clear(screen.getByLabelText("Colour hex for Launch"));
    await userEvent.type(screen.getByLabelText("Colour hex for Launch"), "abc");
    await vi.waitFor(() => expect(add.disabled).toBe(false));
    expect(screen.container.querySelector("#mood-colour-hint-mood-1")?.textContent).toContain(
      "Adds this colour to the palette.",
    );
    expect(mock.updates).toHaveLength(0);
  });

  it("adds a note and refuses to send an empty board", async () => {
    mock.moodboards = { boards: [{ ...board, colors: [], notes: [] }] };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeItLabMoodBoardPage />);
    const input = screen.getByLabelText("Note for Launch");
    await userEvent.type(input, "No gradients");
    await userEvent.click(screen.getByLabelText("Add note to Launch"));
    await vi.waitFor(() => expect(mock.updates).toHaveLength(1));
    expect(mock.updates[0]?.moodboards.boards[0]?.notes).toEqual(["No gradients"]);
    const send = [...screen.container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.includes("Send to thread"),
    );
    expect(send?.disabled).toBe(true);
    // The board now has a note, so the remaining blocker is the missing project.
    expect(screen.container.querySelector("#mood-send-state-mood-1")?.textContent).toContain(
      "Send to thread needs a project",
    );
  });

  it("disables Add reference and Add note until their input has text", async () => {
    mock.moodboards = { boards: [{ ...board, colors: [], notes: [] }] };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeItLabMoodBoardPage />);
    const reference = screen.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Add reference to Launch"]',
    ) as HTMLButtonElement;
    const noteButton = screen.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Add note to Launch"]',
    ) as HTMLButtonElement;
    expect(reference.disabled).toBe(true);
    expect(noteButton.disabled).toBe(true);
    expect(screen.container.querySelector("#mood-image-hint-mood-1")?.textContent).toContain(
      "Paste an image URL",
    );
    await userEvent.type(
      screen.getByLabelText("Reference URL for Launch"),
      "https://example.com/a.png",
    );
    await vi.waitFor(() => expect(reference.disabled).toBe(false));
    await userEvent.type(screen.getByLabelText("Note for Launch"), "No gradients");
    await vi.waitFor(() => expect(noteButton.disabled).toBe(false));
  });

  it("names a missing project on Send to thread", async () => {
    mock.moodboards = { boards: [{ ...board }] };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeItLabMoodBoardPage />);
    const send = [...screen.container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.includes("Send to thread"),
    );
    expect(send?.disabled).toBe(true);
    expect(send?.getAttribute("aria-describedby")).toBe("mood-send-state-mood-1");
    expect(screen.container.querySelector("#mood-send-state-mood-1")?.textContent).toContain(
      "Send to thread needs a project",
    );
  });

  it("creates a board from the keyboard", async () => {
    mock.moodboards = { boards: [] };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeItLabMoodBoardPage />);
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
