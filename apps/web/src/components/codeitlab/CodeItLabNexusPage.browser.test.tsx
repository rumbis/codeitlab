import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render as renderUi } from "../../../test/render";
import { CodeItLabNexusPage } from "./CodeItLabNexusPage";

const mock = vi.hoisted(() => ({
  catalog: {
    generatedAt: "2026-10-20T10:00:00.000Z",
    providers: [],
    warnings: [],
    skills: [
      {
        id: "skill-1",
        name: "review",
        description: "Review a diff",
        source: "hermes" as const,
        alsoAvailableIn: [],
        path: "/skills/review/SKILL.md",
      },
    ],
    mcpServers: [
      {
        id: "mcp-1",
        name: "filesystem",
        transport: "local" as const,
        sources: ["hermes" as const],
        command: "mcp-filesystem",
        args: [],
        envKeys: [],
        tools: ["read_file"],
        enabled: true,
      },
    ],
    sessions: [
      {
        id: "session-1",
        title: "Refactor the board",
        source: "hermes" as const,
        providerInstanceId: "hermes",
        remote: false,
        messageCount: 12,
        updatedAt: "2026-10-20T10:00:00.000Z",
        path: "/sessions/board.jsonl",
      },
    ],
  },
}));

vi.mock(import("../../codeitlab/api"), async (original) => ({
  ...(await original()),
  useCodeItLabNexus: (() => ({
    data: mock.catalog,
    source: "server",
    error: null,
    isPending: false,
    refresh: () => {},
  })) as never,
  useCodeItLabNexusRefresh: (() => async () => null) as never,
}));

describe("nexus page", () => {
  it("says what the catalog covers and links Refresh to it", async () => {
    await using screen = await renderUi(<CodeItLabNexusPage />);
    const refresh = screen.container.querySelector<HTMLButtonElement>(
      'button[aria-describedby="nexus-refresh-state"]',
    );
    expect(refresh?.disabled).toBe(false);
    const state = screen.container.querySelector("#nexus-refresh-state");
    expect(state?.getAttribute("aria-live")).toBe("polite");
    expect(state?.textContent).toContain("from 0 providers");
    expect(state?.textContent).toContain("1 skills");
    expect(state?.textContent).toContain("1 MCP servers");
    expect(state?.textContent).toContain("1 sessions");
  });

  it("counts what the filter is hiding", async () => {
    await using screen = await renderUi(<CodeItLabNexusPage />);
    expect(screen.container.querySelector("#nexus-filter-state")).toBeNull();
    const filter = screen.container.querySelector<HTMLInputElement>(
      'input[aria-label="Filter Nexus catalog"]',
    );
    await userEvent.type(filter!, "filesystem");
    const summary = screen.container.querySelector("#nexus-filter-state");
    expect(summary?.textContent).toContain("Showing 0 of 1 skills");
    expect(summary?.textContent).toContain("1 of 1 MCP servers");
    expect(summary?.textContent).toContain("0 of 1 sessions");
  });

  it("offers a way out of a filter that matches nothing", async () => {
    await using screen = await renderUi(<CodeItLabNexusPage />);
    const filter = screen.container.querySelector<HTMLInputElement>(
      'input[aria-label="Filter Nexus catalog"]',
    );
    await userEvent.type(filter!, "nothing-matches-this");
    expect(screen.getByText("No skills match")).not.toBeNull();
    await userEvent.click(screen.getByText("Clear filter"));
    expect(filter!.value).toBe("");
    expect(screen.getByText("review")).not.toBeNull();
  });
});
