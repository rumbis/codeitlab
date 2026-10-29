import { emptyProfile } from "@codeitlab/core/profile";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render as renderUi } from "../../../test/render";
import { CodeItLabOverviewPage } from "./CodeItLabOverviewPage";

const mock = vi.hoisted(() => ({
  updates: [] as Array<{ board: { tasks: ReadonlyArray<{ title: string; notes: string }> } }>,
  upserts: [] as ReadonlyArray<{ title: string; notes: string }>,
  questRefreshes: 0,
  boardTasks: [] as ReadonlyArray<{ title: string; notes: string; archivedAt?: string }>,
  remoteSource: "local" as "local" | "server",
  remoteTasks: [] as ReadonlyArray<{ title: string; notes: string; archivedAt?: string }>,
  // Hoisted factories cannot call imports, so the blank profile is spelled out
  // here and overwritten by setupProfile() in the tests that care.
  profile: {
    fullName: "",
    headline: "",
    location: "",
    interestDomain: "",
    skillset: "",
    workHistory: [],
    visibleToBusinesses: false,
  } as Record<string, unknown>,
}));

const questBoard = {
  quests: [
    {
      id: "agent" as const,
      title: "Install one agent",
      detail: "Install one agent so work can run.",
      lesson: "An agent is how work actually runs.",
      href: "/settings/codeitlab/agents",
      done: false,
    },
  ],
  done: 0,
  total: 1,
  levelLabel: "Getting started",
  next: {
    id: "agent" as const,
    title: "Install one agent",
    detail: "Install one agent so work can run.",
    lesson: "An agent is how work actually runs.",
    href: "/settings/codeitlab/agents",
    done: false,
  },
};

vi.mock(import("../../codeitlab/api"), async (original) => ({
  ...(await original()),
  useCodeItLabTasks: (() => ({
    data: mock.remoteTasks,
    source: mock.remoteSource,
    error: null,
    isPending: false,
    refresh: () => {},
    upsert: async (task: { title: string; notes: string }) => {
      mock.upserts = [...mock.upserts, task];
      return task;
    },
    remove: async () => true,
  })) as never,
  useCodeItLabNexusRefresh: (() => async () => null) as never,
  useCodeItLabQuests: (() => ({
    data: questBoard,
    source: "local",
    error: null,
    isPending: false,
    refresh: () => {
      mock.questRefreshes += 1;
    },
  })) as never,
}));

vi.mock(import("../../codeitlab/effectsSettings"), async (original) => ({
  ...(await original()),
  useCodeItLabSettingsWriter: (() => ({
    codeitlab: { board: { tasks: mock.boardTasks }, profile: mock.profile },
    environmentId: "local",
    update: (patch: { board: { tasks: ReadonlyArray<{ title: string; notes: string }> } }) => {
      mock.updates.push(patch);
      return patch;
    },
  })) as never,
}));

function setupProfile(overrides: Record<string, unknown> = {}) {
  mock.profile = { ...emptyProfile(), ...overrides } as unknown as Record<string, unknown>;
}

describe("CodeItLabOverviewPage quests", () => {
  it("keeps changing counts from jittering", async () => {
    await using screen = await renderUi(<CodeItLabOverviewPage />);
    const hint = [...screen.container.querySelectorAll("p")].find((node) =>
      /MCP servers$/.test(node.textContent ?? ""),
    );
    expect(hint).not.toBeUndefined();
    expect(getComputedStyle(hint!).fontVariantNumeric).toBe("tabular-nums");
    // Badges carry counts all over the panel, so the base style has to hold too.
    const badge = screen.container.querySelector('[data-slot="badge"]');
    expect(badge).not.toBeNull();
    expect(getComputedStyle(badge!).fontVariantNumeric).toBe("tabular-nums");
  });

  it("offers to turn the next quest into a board task", async () => {
    await using screen = await renderUi(<CodeItLabOverviewPage />);
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

  it("refreshes the derived quest board along with the catalog", async () => {
    await using screen = await renderUi(<CodeItLabOverviewPage />);
    const before = mock.questRefreshes;
    await userEvent.click(screen.getByText("Refresh status"));
    expect(mock.questRefreshes).toBeGreaterThan(before);
    expect(
      screen.getByText(/Refresh needs the CodeItLab RPC; the local preview panels are shown/),
    ).not.toBeNull();
  });

  it("copies a settings-only board into the database with the quest task", async () => {
    mock.boardTasks = [{ title: "Existing local task", notes: "", archivedAt: "" }];
    mock.remoteSource = "server";
    mock.remoteTasks = [];
    mock.upserts = [];
    try {
      await using screen = await renderUi(<CodeItLabOverviewPage />);
      await userEvent.click(screen.getByText("Add as board task"));
      await vi.waitFor(() =>
        expect(mock.upserts.map((task) => task.title)).toEqual([
          "Existing local task",
          "Install one agent",
        ]),
      );
    } finally {
      mock.boardTasks = [];
      mock.remoteSource = "local";
      mock.remoteTasks = [];
    }
  });

  it("re-reads the quest card once the board task is stored", async () => {
    mock.boardTasks = [];
    mock.remoteSource = "local";
    mock.remoteTasks = [];
    mock.upserts = [];
    const before = mock.questRefreshes;
    await using screen = await renderUi(<CodeItLabOverviewPage />);
    await userEvent.click(screen.getByText("Add as board task"));
    await vi.waitFor(() => expect(mock.upserts).toHaveLength(1));
    await vi.waitFor(() => expect(mock.questRefreshes).toBeGreaterThan(before));
  });

  it("disables Add as board task once the quest is already there", async () => {
    mock.boardTasks = [{ title: "Install one agent", notes: "", archivedAt: "" }];
    mock.remoteTasks = [];
    mock.remoteSource = "local";
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeItLabOverviewPage />);
    const add = [...screen.container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Add as board task",
    );
    expect(add?.disabled).toBe(true);
    expect(add?.getAttribute("aria-describedby")).toBe("overview-quest-board-state");
    expect(screen.container.querySelector("#overview-quest-board-state")?.textContent).toContain(
      "already on the board",
    );
  });

  it("says what the status counts are based on", async () => {
    mock.boardTasks = [];
    mock.remoteTasks = [];
    await using screen = await renderUi(<CodeItLabOverviewPage />);
    const state = screen.container.querySelector("#overview-refresh-state");
    expect(state?.getAttribute("role")).toBe("status");
    expect(state?.textContent).toContain("Counts come from the catalog built");
    const refresh = [...screen.container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.includes("Refresh status"),
    );
    expect(refresh?.getAttribute("aria-describedby")).toBe("overview-refresh-state");
  });

  it("adds the quest to the board with the keyboard", async () => {
    mock.boardTasks = [];
    mock.remoteSource = "local";
    mock.remoteTasks = [];
    mock.upserts = [];
    await using _screen = await renderUi(<CodeItLabOverviewPage />);
    const button = [...document.querySelectorAll("button")].find((entry) =>
      entry.textContent?.includes("Add as board task"),
    );
    expect(button).toBeDefined();
    button?.focus();
    expect(document.activeElement).toBe(button);
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(mock.upserts).toHaveLength(1));
  });
});

describe("CodeItLabOverviewPage work", () => {
  it("puts work on the home screen and asks for the profile", async () => {
    setupProfile();
    await using screen = await renderUi(<CodeItLabOverviewPage />);
    const card = screen.container.querySelector("[data-codeitlab-work]");
    expect(card).not.toBeNull();
    expect(card!.textContent).toContain("Get on the work board");
    expect(card!.textContent).toContain("0/3 steps");
    expect(card!.textContent).toContain("Private until you switch on showing it to businesses.");
  });

  it("counts the steps as they are filled in", async () => {
    setupProfile({ fullName: "Maria", headline: "Backend engineer" });
    await using screen = await renderUi(<CodeItLabOverviewPage />);
    const card = screen.container.querySelector("[data-codeitlab-work]");
    expect(card!.textContent).toContain("1/3 steps");
    expect(card!.textContent).toContain("Build your profile");
  });

  it("says the profile is ready once all three steps are done", async () => {
    setupProfile({
      fullName: "Maria",
      headline: "Backend engineer",
      interestDomain: "Local-first tools",
      workHistory: [{ company: "Acme", role: "Backend", period: "", summary: "" }],
      visibleToBusinesses: true,
    });
    await using screen = await renderUi(<CodeItLabOverviewPage />);
    const card = screen.container.querySelector("[data-codeitlab-work]");
    expect(card!.textContent).toContain("3/3 steps");
    expect(card!.textContent).toContain("Your profile is ready for businesses");
    expect(card!.textContent).toContain("Shown to businesses on our site.");
    expect(card!.querySelector("a")?.getAttribute("href")).toBe("/settings/codeitlab/profile");
  });
});
