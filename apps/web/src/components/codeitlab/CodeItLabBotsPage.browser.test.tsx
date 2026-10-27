import type { CodeItLabBotsSettings } from "@codeitlab/core/bots";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render as renderUi } from "../../../test/render";
import { CodeItLabBotsPage } from "./CodeItLabBotsPage";

const mock = vi.hoisted(() => ({
  bots: { bots: [] } as CodeItLabBotsSettings,
  updates: [] as Array<{ bots: CodeItLabBotsSettings }>,
  projects: [] as ReadonlyArray<Record<string, unknown>>,
  shells: [] as ReadonlyArray<Record<string, unknown>>,
}));

vi.mock(import("../../codeitlab/effectsSettings"), async (original) => ({
  ...(await original()),
  useCodeItLabSettingsWriter: (() => ({
    codeitlab: { bots: mock.bots },
    environmentId: null,
    update: (patch: { bots: CodeItLabBotsSettings }) => {
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
  useProjects: (() => mock.projects) as never,
  useThreadShells: (() => mock.shells) as never,
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
    await using screen = await renderUi(<CodeItLabBotsPage />);
    expect(screen.getByText("No bots yet")).not.toBeNull();
    await userEvent.click(screen.getByText("New bot"));
    await vi.waitFor(() => expect(mock.updates).toHaveLength(1));
    expect(mock.updates[0]?.bots.bots).toHaveLength(1);
  });

  it("toggles a bot with the shared checkbox", async () => {
    mock.bots = { bots: [bot] };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeItLabBotsPage />);
    const toggle = screen.container.querySelector<HTMLElement>('[data-slot="checkbox"]');
    expect(toggle).not.toBeNull();
    expect(toggle!.getAttribute("aria-checked")).toBe("true");
    expect(toggle!.getAttribute("aria-label")).toBe("Enable Atlas");
    await userEvent.click(toggle!);
    await vi.waitFor(() => expect(mock.updates.length).toBeGreaterThan(0));
    expect(mock.updates.at(-1)?.bots.bots[0]?.enabled).toBe(false);
  });

  it("keeps Start chat disabled and says a message is missing", async () => {
    mock.projects = [];
    mock.shells = [];
    mock.bots = { bots: [bot] };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeItLabBotsPage />);
    const start = screen.container.querySelector<HTMLButtonElement>('[data-bot-start="bot-1"]');
    expect(start?.disabled).toBe(true);
    expect(screen.container.querySelector("#bot-issue-bot-1")?.textContent).toContain(
      "Write a message so the bot has something to answer.",
    );
  });

  it("names the project before the message once a message is typed", async () => {
    mock.projects = [];
    mock.shells = [];
    mock.bots = { bots: [bot] };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeItLabBotsPage />);
    const message = screen.container.querySelector<HTMLTextAreaElement>("#bot-message-bot-1");
    await userEvent.fill(message as HTMLTextAreaElement, "Summarise the repo");
    await vi.waitFor(() =>
      expect(screen.container.querySelector("#bot-issue-bot-1")?.textContent).toContain(
        "Open a project first",
      ),
    );
    const start = screen.container.querySelector<HTMLButtonElement>('[data-bot-start="bot-1"]');
    expect(start?.disabled).toBe(true);
  });

  it("refuses a bot without standing instructions", async () => {
    mock.bots = { bots: [{ ...bot, persona: "  " }] };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeItLabBotsPage />);
    expect(screen.getByText(/standing instructions/)).not.toBeNull();
  });

  it("runs the start action from the keyboard", async () => {
    mock.projects = [
      {
        id: "project-1",
        environmentId: "local",
        isScratch: false,
        name: "App",
        updatedAt: "2026-10-24T12:00:00.000Z",
      },
    ];
    mock.shells = [];
    mock.bots = { bots: [bot] };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeItLabBotsPage />);
    const start = [...screen.container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Start chat",
    );
    expect(start?.type).toBe("button");
    expect(start?.disabled).toBe(true);
    // With a project and a message the button unlocks; the mocked thread handler
    // then returns null and the keyboard path reports that nothing opened.
    const message = screen.container.querySelector<HTMLTextAreaElement>("#bot-message-bot-1");
    await userEvent.fill(message as HTMLTextAreaElement, "Summarise the repo");
    await vi.waitFor(() => expect(start?.disabled).toBe(false));
    start?.focus();
    expect(document.activeElement).toBe(start);
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(screen.getByText("Could not open a thread")).not.toBeNull());
  });

  it("ties the bot issue to the message field for screen readers", async () => {
    mock.bots = { bots: [{ ...bot, name: "  " }] };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeItLabBotsPage />);
    const message = screen.container.querySelector("#bot-message-bot-1");
    const issueId = message?.getAttribute("aria-describedby");
    expect(issueId).toBe("bot-issue-bot-1");
    const issue = screen.container.querySelector(`#${issueId}`);
    expect(issue?.getAttribute("aria-live")).toBe("polite");
    expect(issue?.textContent).toContain("Give the bot a name");
    const start = [...screen.container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Start chat"),
    );
    expect(start?.disabled).toBe(true);
    // A disabled action still has to carry the reason it is disabled.
    expect(start?.getAttribute("aria-describedby")).toBe("bot-issue-bot-1");
    expect(start?.getAttribute("data-bot-start")).toBe("bot-1");
  });

  it("describes the normal path when the bot is ready", async () => {
    mock.projects = [
      {
        id: "project-1",
        environmentId: "local",
        isScratch: false,
        name: "App",
        updatedAt: "2026-10-24T12:00:00.000Z",
      },
    ];
    mock.shells = [];
    mock.bots = { bots: [bot] };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeItLabBotsPage />);
    const message = screen.container.querySelector<HTMLTextAreaElement>("#bot-message-bot-1");
    await userEvent.fill(message as HTMLTextAreaElement, "Summarise the repo");
    await vi.waitFor(() =>
      expect(screen.container.querySelector("#bot-issue-bot-1")?.textContent).toContain(
        "Opens a normal thread",
      ),
    );
  });
});
