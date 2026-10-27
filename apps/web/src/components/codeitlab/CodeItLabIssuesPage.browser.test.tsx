import type { CodeItLabIssuesSettings } from "@codeitlab/core/issues";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render as renderUi } from "../../../test/render";
import { CodeItLabIssuesPage } from "./CodeItLabIssuesPage";

const mock = vi.hoisted(() => ({
  codeitlab: {
    issues: { issues: [] } as CodeItLabIssuesSettings,
    board: { tasks: [] as ReadonlyArray<unknown> },
  },
  updates: [] as Array<Record<string, unknown>>,
}));

vi.mock(import("../../codeitlab/effectsSettings"), async (original) => ({
  ...(await original()),
  useCodeItLabSettingsWriter: (() => ({
    codeitlab: mock.codeitlab,
    environmentId: null,
    update: (patch: Record<string, unknown>) => {
      mock.updates.push(patch);
      Object.assign(mock.codeitlab, patch);
      return mock.codeitlab;
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

describe("issues page", () => {
  it("moves focus to the title field from the empty state", async () => {
    mock.codeitlab.issues = { issues: [] };
    await using screen = await renderUi(<CodeItLabIssuesPage />);
    await userEvent.click(screen.getByText("Write the first issue"));
    const input = screen.container.querySelector<HTMLInputElement>("#issue-title");
    expect(document.activeElement).toBe(input);
  });

  it("starts empty and adds a titled issue", async () => {
    mock.codeitlab.issues = { issues: [] };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeItLabIssuesPage />);
    expect(screen.getByText("No issues yet")).not.toBeNull();
    const input = screen.getByLabelText("New issue");
    await userEvent.type(input, "Board loses archive state");
    await userEvent.click(screen.getByText("Add issue"));
    await vi.waitFor(() => expect(mock.updates).toHaveLength(1));
    const issues = (mock.updates[0]?.issues as CodeItLabIssuesSettings | undefined)?.issues ?? [];
    expect(issues[0]?.title).toBe("Board loses archive state");
    expect(issues[0]?.status).toBe("open");
  });

  it("keeps Add issue disabled until the title is usable", async () => {
    mock.codeitlab.issues = { issues: [] };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeItLabIssuesPage />);
    const add = [...screen.container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Add issue",
    );
    expect(add?.disabled).toBe(true);
    expect(add?.getAttribute("aria-describedby")).toBe("issue-add-state");
    expect(screen.container.querySelector("#issue-add-state")?.textContent).toContain(
      "Give the issue a title",
    );
    await userEvent.type(screen.getByLabelText("New issue"), "Board loses archive state");
    await vi.waitFor(() => expect(add?.disabled).toBe(false));
    expect(screen.container.querySelector("#issue-add-state")?.textContent).toContain(
      "Press Enter in the title field to add the issue.",
    );
  });

  it("keeps Send to thread disabled and names the missing project", async () => {
    mock.codeitlab.issues = {
      issues: [
        {
          id: "issue-1",
          title: "Board loses archive state",
          body: "",
          status: "open",
          source: "",
          createdAt: "2026-10-24T12:00:00.000Z",
          updatedAt: "2026-10-24T12:00:00.000Z",
        },
      ],
    };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeItLabIssuesPage />);
    const send = [...screen.container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.includes("Send to thread"),
    );
    expect(send?.disabled).toBe(true);
    expect(send?.getAttribute("aria-describedby")).toBe("issues-project-state");
    expect(screen.container.querySelector("#issues-project-state")?.textContent).toContain(
      "Send to thread stays disabled until you open a project",
    );
  });

  it("adds an issue to the board with its body and source", async () => {
    mock.codeitlab.issues = {
      issues: [
        {
          id: "issue-1",
          title: "Board loses archive state",
          body: "Steps to reproduce",
          status: "open",
          source: "https://example.com/1",
          createdAt: "2026-10-24T12:00:00.000Z",
          updatedAt: "2026-10-24T12:00:00.000Z",
        },
      ],
    };
    mock.codeitlab.board = { tasks: [] };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeItLabIssuesPage />);
    await userEvent.click(screen.getByText("Add to board"));
    await vi.waitFor(() => expect(mock.updates).toHaveLength(1));
    const board = mock.updates[0]?.board as {
      tasks: ReadonlyArray<{ title: string; notes: string }>;
    };
    expect(board.tasks[0]?.title).toBe("Board loses archive state");
    expect(board.tasks[0]?.notes).toContain("Steps to reproduce");
    expect(board.tasks[0]?.notes).toContain("Source: https://example.com/1");
  });

  it("adds an issue with Enter from the title field", async () => {
    mock.codeitlab.issues = { issues: [] };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeItLabIssuesPage />);
    const input = screen.container.querySelector<HTMLInputElement>("#issue-title");
    input?.focus();
    expect(document.activeElement).toBe(input);
    await userEvent.type(screen.getByLabelText("New issue"), "Keyboard issue");
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(mock.updates).toHaveLength(1));
    const issues = (mock.updates[0]?.issues as CodeItLabIssuesSettings | undefined)?.issues ?? [];
    expect(issues[0]?.title).toBe("Keyboard issue");
  });
});
