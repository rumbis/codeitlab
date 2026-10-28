import type { CodeItLabEcosystemStatus } from "@codeitlab/core/ecosystem";
import { describe, expect, it, vi } from "vite-plus/test";

import "~/index.css";

import { render as renderUi } from "../../../test/render";
import { CodeItLabEcosystemPage } from "./CodeItLabEcosystemPage";

const mock = vi.hoisted(() => ({
  status: null as unknown,
  installs: 0,
  installResult: null as unknown,
}));

vi.mock(import("../../codeitlab/api"), async (original) => ({
  ...(await original()),
  useCodeItLabEcosystem: (() => ({
    data: mock.status,
    source: "server",
    error: null,
    isPending: false,
    refresh: () => {},
    install: async () => {
      mock.installs += 1;
      return mock.installResult;
    },
  })) as never,
}));

const integration = {
  id: "graft" as const,
  name: "Graft",
  kind: "mcp" as const,
  enabled: true,
  mode: "auto",
  version: "0.21.1",
  available: true,
  detail: "Repository context graph, registered per project.",
  warnings: [],
};

const status = (patch: Partial<CodeItLabEcosystemStatus> = {}): CodeItLabEcosystemStatus => ({
  integrations: [integration],
  generatedAt: "2026-01-01T00:00:00.000Z",
  warnings: [],
  ...patch,
});

describe("ecosystem page", () => {
  it("says what Install / refresh writes before it is pressed", async () => {
    mock.status = status();
    mock.installs = 0;
    await using screen = await renderUi(<CodeItLabEcosystemPage />);
    const install = [...screen.container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Install / refresh",
    );
    expect(install?.disabled).toBe(false);
    expect(install?.getAttribute("aria-describedby")).toBe("ecosystem-install-state");
    expect(screen.container.querySelector("#ecosystem-install-state")?.textContent).toContain(
      "writes the files listed below",
    );
  });

  it("gives an empty catalog a next step instead of a blank page", async () => {
    mock.status = status({ integrations: [] });
    await using screen = await renderUi(<CodeItLabEcosystemPage />);
    expect(screen.container.textContent).toContain("No ecosystem integrations reported");
    expect(screen.container.textContent).toContain("Install / refresh writes them");
  });

  it("shows the integrations the server reported with their state", async () => {
    mock.status = status({
      integrations: [{ ...integration, available: false, detail: "Not detected on this machine." }],
    });
    await using screen = await renderUi(<CodeItLabEcosystemPage />);
    expect(screen.container.textContent).toContain("Graft");
    expect(screen.container.textContent).toContain("not detected");
    expect(screen.container.textContent).toContain("Not detected on this machine.");
  });
});
