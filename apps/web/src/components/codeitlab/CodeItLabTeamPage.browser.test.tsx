import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render as renderUi } from "../../../test/render";
import { CodeItLabTeamPage } from "./CodeItLabTeamPage";

const mock = vi.hoisted(() => ({
  team: { presets: [], runs: [] } as { presets: unknown[]; runs: unknown[] },
  updates: [] as Array<{ team: unknown }>,
}));

vi.mock(import("../../codeitlab/effectsSettings"), async (original) => ({
  ...(await original()),
  useCodeItLabSettingsWriter: (() => ({
    codeitlab: { team: mock.team },
    environmentId: null,
    update: (patch: { team: unknown }) => {
      mock.updates.push(patch);
      mock.team = patch.team as typeof mock.team;
      return { team: mock.team };
    },
  })) as never,
}));

vi.mock(import("../../state/environments"), async (original) => ({
  ...(await original()),
  usePrimaryEnvironmentId: (() => null) as never,
  useEnvironmentProviders: (() => new Map()) as never,
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

const preset = {
  id: "team-1",
  name: "My team",
  architectInstanceId: "",
  architectModel: "",
  workers: [
    { id: "worker-1", name: "Worker 1", role: "research", instanceId: "", model: "" },
    { id: "worker-2", name: "Worker 2", role: "implementation", instanceId: "", model: "" },
  ],
};

describe("team page", () => {
  it("starts from the empty state", async () => {
    mock.team = { presets: [], runs: [] };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeItLabTeamPage />);
    expect(screen.getByText("No team presets yet")).not.toBeNull();
  });

  it("keeps Start team disabled and says what is missing", async () => {
    mock.team = { presets: [preset], runs: [] };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeItLabTeamPage />);
    const start = await vi.waitFor(() => {
      const button = [...screen.container.querySelectorAll<HTMLButtonElement>("button")].find(
        (entry) => entry.textContent?.includes("Start team"),
      );
      expect(button).not.toBeUndefined();
      return button!;
    });
    expect(start.disabled).toBe(true);
    expect(start.getAttribute("aria-describedby")).toBe("team-start-state");
    expect(screen.container.querySelector("#team-start-state")?.textContent).toContain(
      "Describe the task so the architect has something to split.",
    );
    const task = screen.container.querySelector<HTMLTextAreaElement>("#team-task");
    await userEvent.fill(task as HTMLTextAreaElement, "Add a settings search test");
    await vi.waitFor(() => expect(start.disabled).toBe(false));
    expect(screen.container.querySelector("#team-start-state")?.textContent).toContain(
      "Nothing runs until you send.",
    );
  });

  it("creates a preset from the keyboard", async () => {
    mock.team = { presets: [], runs: [] };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeItLabTeamPage />);
    const create = [...screen.container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "New team preset",
    );
    expect(create?.type).toBe("button");
    create?.focus();
    expect(document.activeElement).toBe(create);
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(mock.updates).toHaveLength(1));
    expect((mock.updates[0]?.team as { presets: unknown[] }).presets).toHaveLength(1);
  });
});
