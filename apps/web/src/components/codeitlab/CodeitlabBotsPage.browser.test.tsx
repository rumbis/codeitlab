import type { CodeitlabBotsSettings } from "@codeitlab/core/bots";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render as renderUi } from "../../../test/render";
import { CodeitlabBotsPage } from "./CodeitlabBotsPage";

const mock = vi.hoisted(() => ({
  bots: { bots: [] } as CodeitlabBotsSettings,
  updates: [] as Array<{ bots: CodeitlabBotsSettings }>,
}));

vi.mock(import("../../codeitlab/effectsSettings"), async (original) => ({
  ...(await original()),
  useCodeitlabSettingsWriter: (() => ({
    codeitlab: { bots: mock.bots },
    environmentId: null,
    update: (patch: { bots: CodeitlabBotsSettings }) => {
      mock.updates.push(patch);
      mock.bots = patch.bots;
      return { bots: mock.bots };
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

const bot = {
  id: "bot-1",
  name: "Atlas",
  persona: "Answer in short paragraphs.",
  memory: "",
  instanceId: "",
  model: "",
  enabled: true,
};

describe("bots page", () => {
  it("starts from the empty state with a new bot", async () => {
    mock.bots = { bots: [] };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeitlabBotsPage />);
    expect(screen.getByText("No bots yet")).not.toBeNull();
    await userEvent.click(screen.getByText("New bot"));
    await vi.waitFor(() => expect(mock.updates).toHaveLength(1));
    expect(mock.updates[0]?.bots.bots).toHaveLength(1);
  });

  it("asks for a message before opening a chat", async () => {
    mock.bots = { bots: [bot] };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeitlabBotsPage />);
    await userEvent.click(screen.getByText("Start chat"));
    await vi.waitFor(() => expect(screen.getByText("Write a message")).not.toBeNull());
  });

  it("refuses a bot without standing instructions", async () => {
    mock.bots = { bots: [{ ...bot, persona: "  " }] };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeitlabBotsPage />);
    expect(screen.getByText(/standing instructions/)).not.toBeNull();
  });

  it("runs the start action from the keyboard", async () => {
    mock.bots = { bots: [bot] };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeitlabBotsPage />);
    const start = [...screen.container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Start chat",
    );
    expect(start?.type).toBe("button");
    start?.focus();
    expect(document.activeElement).toBe(start);
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(screen.getByText("Write a message")).not.toBeNull());
  });
});
