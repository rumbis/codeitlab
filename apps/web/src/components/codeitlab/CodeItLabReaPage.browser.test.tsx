import type { ReaStatus } from "@codeitlab/core/rea";
import type { CodeItLabReaSettings } from "@codeitlab/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import "~/index.css";

import { render as renderUi } from "../../../test/render";
import { CodeItLabReaPage } from "./CodeItLabReaPage";

const mock = vi.hoisted(() => ({
  status: null as unknown,
  settings: null as unknown,
  updates: [] as Array<Record<string, unknown>>,
  installs: 0,
}));

vi.mock(import("../../codeitlab/api"), async (original) => ({
  ...(await original()),
  useCodeItLabRea: (() => ({
    data: mock.status,
    capabilities: [],
    source: "server",
    error: null,
    isPending: false,
    refresh: () => {},
    install: async () => {
      mock.installs += 1;
      return mock.status;
    },
  })) as never,
}));

vi.mock(import("../../codeitlab/effectsSettings"), async (original) => ({
  ...(await original()),
  useCodeItLabSettingsWriter: (() => ({
    codeitlab: { rea: mock.settings },
    environmentId: "env-1",
    update: (patch: Record<string, unknown>) => {
      mock.updates.push(patch);
      return patch;
    },
  })) as never,
}));

const status = (patch: Partial<ReaStatus> = {}): ReaStatus => ({
  installed: false,
  version: "",
  mcpCommand: "npx",
  mcpArgs: ["-y", "rea-agents@6.7.0", "--mcp"],
  skillInstalled: false,
  autoActivate: true,
  health: [],
  ...patch,
});

const settings = (patch: Partial<CodeItLabReaSettings> = {}): CodeItLabReaSettings => ({
  enabled: true,
  autoActivate: true,
  mcpCommand: "npx",
  mcpArgs: ["-y", "rea-agents@6.7.0", "--mcp"],
  installSkill: true,
  ...patch,
});

describe("REA page", () => {
  it("says what Install does before it is pressed", async () => {
    mock.status = status();
    mock.settings = settings();
    mock.installs = 0;
    await using screen = await renderUi(<CodeItLabReaPage />);
    const install = [...screen.container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Install",
    );
    expect(install?.disabled).toBe(false);
    expect(install?.getAttribute("aria-describedby")).toBe("rea-install-state");
    expect(screen.container.querySelector("#rea-install-state")?.textContent).toContain(
      "Install rewrites both",
    );
  });

  it("disables Auto-activate while REA itself is off and says why", async () => {
    mock.status = status();
    mock.settings = settings({ enabled: false, autoActivate: true });
    await using screen = await renderUi(<CodeItLabReaPage />);
    const toggle = screen.container.querySelector<HTMLElement>('[aria-label="Auto-activate REA"]');
    expect(toggle?.getAttribute("aria-disabled")).toBe("true");
    expect(toggle?.getAttribute("aria-describedby")).toBe("rea-activate-state");
    expect(screen.container.querySelector("#rea-activate-state")?.textContent).toContain(
      "Enable REA first",
    );
  });

  it("keeps Auto-activate available when REA is on", async () => {
    mock.status = status();
    mock.settings = settings({ enabled: true, autoActivate: false });
    await using screen = await renderUi(<CodeItLabReaPage />);
    const toggle = screen.container.querySelector<HTMLElement>('[aria-label="Auto-activate REA"]');
    expect(toggle?.getAttribute("aria-disabled")).toBeNull();
    expect(screen.container.querySelector("#rea-activate-state")?.textContent).toContain(
      "without being named",
    );
  });
});
