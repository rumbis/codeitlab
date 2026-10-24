import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render as renderUi } from "../../../test/render";
import { CodeitlabTeamPage } from "./CodeitlabTeamPage";

const mock = vi.hoisted(() => ({
  team: { presets: [], runs: [] } as { presets: unknown[]; runs: unknown[] },
  updates: [] as Array<{ team: unknown }>,
}));

vi.mock(import("../../codeitlab/effectsSettings"), async (original) => ({
  ...(await original()),
  useCodeitlabSettingsWriter: (() => ({
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

describe("team page", () => {
  it("starts from the empty state", async () => {
    mock.team = { presets: [], runs: [] };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeitlabTeamPage />);
    expect(screen.getByText("No team presets yet")).not.toBeNull();
  });

  it("creates a preset from the keyboard", async () => {
    mock.team = { presets: [], runs: [] };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeitlabTeamPage />);
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
