import type { CodeItLabIntegrationList, CodeItLabIntegrationStatus } from "@codeitlab/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render as renderUi } from "../../../test/render";
import { CodeItLabIntegrationPage } from "./CodeItLabIntegrationPage";

const status = (patch: Partial<CodeItLabIntegrationStatus> = {}): CodeItLabIntegrationStatus => ({
  id: "shorts",
  name: "Shorts",
  tagline: "Turn a script into a video.",
  engine: "OpenShorts",
  enabled: true,
  configured: true,
  state: "ready",
  reachable: true,
  latencyMs: 42,
  wired: [],
  actions: [],
  ...patch,
});

const mock = vi.hoisted(() => ({
  view: null as unknown,
  refreshes: 0,
  sets: [] as Array<Record<string, unknown>>,
  status: null as unknown,
}));

vi.mock(import("../../codeitlab/api"), async (original) => ({
  ...(await original()),
  useCodeItLabIntegrations: (() => mock.view) as never,
}));

vi.mock(import("../../codeitlab/audio"), async (original) => ({
  ...(await original()),
  playCodeItLabSfx: (() => {}) as never,
  unlockCodeItLabAudio: (() => {}) as never,
}));

function setup(patch: Partial<CodeItLabIntegrationStatus> = {}): void {
  mock.status = status(patch);
  mock.refreshes = 0;
  mock.sets.length = 0;
  const data = {
    integrations: [mock.status as CodeItLabIntegrationStatus],
    wired: { mcpServers: [], skills: [] },
  } satisfies CodeItLabIntegrationList;
  mock.view = {
    data,
    source: "server",
    error: null,
    isPending: false,
    refresh: () => {
      mock.refreshes += 1;
    },
    set: async (p: Record<string, unknown>) => {
      mock.sets.push(p);
      return data;
    },
  };
}

describe("integration page", () => {
  it("says whether the surface is on for this environment", async () => {
    setup({ enabled: false });
    await using screen = await renderUi(<CodeItLabIntegrationPage id="shorts" />);
    const toggle = screen.container.querySelector<HTMLElement>('[aria-label="Enable Shorts"]');
    expect(toggle?.getAttribute("aria-describedby")).toBe("integration-switch-state");
    expect(screen.container.querySelector("#integration-switch-state")?.textContent).toContain(
      "Shorts is off for this environment.",
    );
  });

  it("says what the status line is based on before any retry", async () => {
    setup();
    await using screen = await renderUi(<CodeItLabIntegrationPage id="shorts" />);
    const state = screen.container.querySelector("#integration-refresh-state");
    expect(state?.getAttribute("role")).toBe("status");
    expect(state?.textContent).toContain("Status comes from the last probe");
  });

  it("runs one probe per Retry click", async () => {
    setup({ state: "unreachable", reachable: false });
    await using screen = await renderUi(<CodeItLabIntegrationPage id="shorts" />);
    const retry = [...screen.container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Retry connection",
    );
    expect(retry?.disabled).toBe(false);
    await userEvent.click(retry!);
    await vi.waitFor(() => expect(mock.refreshes).toBe(1));
  });

  it("keeps the switch busy state readable while saving", async () => {
    setup();
    let release: (() => void) | null = null;
    const view = mock.view as {
      set: (patch: Record<string, unknown>) => Promise<unknown>;
    };
    view.set = (patch) => {
      mock.sets.push(patch);
      return new Promise((resolve) => {
        release = () => resolve(null);
      });
    };
    await using screen = await renderUi(<CodeItLabIntegrationPage id="shorts" />);
    const toggle = screen.container.querySelector<HTMLElement>('[aria-label="Enable Shorts"]');
    await userEvent.click(toggle!);
    await vi.waitFor(() =>
      expect(screen.container.querySelector("#integration-switch-state")?.textContent).toContain(
        "Saving the switch…",
      ),
    );
    release!();
  });
});
