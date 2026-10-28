import type { CodeItLabBudgetSettings } from "@codeitlab/core/budget";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render as renderUi } from "../../../test/render";
import { CodeItLabBudgetPage } from "./CodeItLabBudgetPage";

const mock = vi.hoisted(() => ({
  budget: { budgets: [] } as CodeItLabBudgetSettings,
  updates: [] as Array<{ budget: CodeItLabBudgetSettings }>,
  threads: [] as ReadonlyArray<unknown>,
}));

vi.mock(import("../../codeitlab/effectsSettings"), async (original) => ({
  ...(await original()),
  useCodeItLabSettingsWriter: (() => ({
    codeitlab: { budget: mock.budget },
    environmentId: null,
    update: (patch: { budget: CodeItLabBudgetSettings }) => {
      mock.updates.push(patch);
      mock.budget = patch.budget;
      return { budget: mock.budget };
    },
  })) as never,
}));

vi.mock(import("../../state/entities"), async (original) => ({
  ...(await original()),
  useThreadShells: (() => mock.threads) as never,
}));

const thread = (id: string, title: string, updatedAt: string) => ({
  id,
  title,
  updatedAt,
  archivedAt: null,
});

describe("budget page", () => {
  it("says there is nothing to budget when there are no threads", async () => {
    mock.threads = [];
    await using screen = await renderUi(<CodeItLabBudgetPage />);
    expect(screen.getByText("No threads yet")).not.toBeNull();
  });

  it("records a token budget for a thread", async () => {
    mock.threads = [thread("thread-1", "Ship the board", "2026-10-24T12:00:00.000Z")];
    mock.budget = { budgets: [] };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeItLabBudgetPage />);
    const input = screen.getByLabelText("Token budget for Ship the board");
    await userEvent.type(input, "50000");
    await userEvent.click(screen.getByText("Thread"));
    await vi.waitFor(() => expect(mock.updates).toHaveLength(1));
    expect(mock.updates[0]?.budget.budgets).toEqual([
      { threadId: "thread-1", tokens: 50_000, note: "" },
    ]);
  });

  it("refuses a typo instead of deleting the budget", async () => {
    mock.threads = [thread("thread-1", "Ship the board", "2026-10-24T12:00:00.000Z")];
    mock.budget = { budgets: [{ threadId: "thread-1", tokens: 50_000, note: "" }] };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeItLabBudgetPage />);
    const input = screen.getByLabelText("Token budget for Ship the board");
    await userEvent.clear(input);
    await userEvent.type(input, "50k");
    await userEvent.click(screen.getByText("Thread"));
    await vi.waitFor(() =>
      expect(screen.container.querySelector('[role="status"]')?.textContent).toContain(
        "Not saved: “50k” is not a token count.",
      ),
    );
    // A refused value leaves the stored budget alone.
    expect(mock.updates).toHaveLength(0);
  });

  it("announces a saved budget and what it means", async () => {
    mock.threads = [thread("thread-1", "Ship the board", "2026-10-24T12:00:00.000Z")];
    mock.budget = { budgets: [] };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeItLabBudgetPage />);
    const input = screen.getByLabelText("Token budget for Ship the board");
    await userEvent.type(input, "120000");
    await userEvent.click(screen.getByText("Thread"));
    await vi.waitFor(() =>
      expect(screen.container.querySelector('[role="status"]')?.textContent).toContain(
        "Budget for “Ship the board” is 120k tokens; it warns, it does not stop.",
      ),
    );
  });

  it("clearing the field removes the budget", async () => {
    mock.threads = [thread("thread-1", "Ship the board", "2026-10-24T12:00:00.000Z")];
    mock.budget = { budgets: [{ threadId: "thread-1", tokens: 50_000, note: "" }] };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeItLabBudgetPage />);
    const input = screen.getByLabelText("Token budget for Ship the board");
    await userEvent.clear(input);
    await userEvent.click(screen.getByText("Thread"));
    await vi.waitFor(() => expect(mock.updates).toHaveLength(1));
    expect(mock.updates[0]?.budget.budgets).toEqual([]);
  });
});
