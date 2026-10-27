import type { MemoryEntry } from "@codeitlab/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render as renderUi } from "../../../test/render";
import { CodeItLabMemoryPage } from "./CodeItLabMemoryPage";

const mock = vi.hoisted(() => ({
  entries: [] as ReadonlyArray<MemoryEntry>,
  source: "server" as "server" | "local",
}));

vi.mock(import("../../codeitlab/api"), async (original) => ({
  ...(await original()),
  useCodeItLabMemory: (() => ({
    data: mock.entries,
    stats: {
      total: mock.entries.length,
      global: 0,
      project: mock.entries.length,
      byKind: {},
      lastExtractionAt: null,
    },
    source: mock.source,
    error: null,
    isPending: false,
    refresh: () => {},
    add: async () => null,
    remove: async () => true,
  })) as never,
}));

const entry = (patch: Partial<MemoryEntry>): MemoryEntry => ({
  id: "memory-1",
  scope: "project",
  projectId: "codeitlab",
  kind: "fact",
  text: "The release branch is cut on Thursdays.",
  source: "turn",
  createdAt: "2026-10-20T10:00:00.000Z",
  updatedAt: "2026-10-20T10:00:00.000Z",
  recalls: 2,
  tags: ["release"],
  confidence: 0.9,
  ...patch,
});

describe("memory page", () => {
  it("says there are no memories at all, not that a filter failed", async () => {
    mock.entries = [];
    await using screen = await renderUi(<CodeItLabMemoryPage />);
    expect(screen.getByText("No memories yet")).not.toBeNull();
    expect(screen.container.textContent).toContain("starts every turn without stored context");
  });

  it("names the filter and offers to clear it when nothing matches", async () => {
    mock.entries = [entry({})];
    await using screen = await renderUi(<CodeItLabMemoryPage />);
    const filter = screen.container.querySelector<HTMLInputElement>(
      '[aria-label="Filter memories"]',
    );
    await userEvent.fill(filter as HTMLInputElement, "kubernetes");
    await vi.waitFor(() =>
      expect(screen.container.textContent).toContain("No memories match “kubernetes”"),
    );
    // The empty state says what the filter reads and how many memories exist.
    expect(screen.container.textContent).toContain("There is 1 memory without this text.");
    await userEvent.click(screen.getByText("Clear filter"));
    await vi.waitFor(() =>
      expect(screen.container.textContent).toContain("The release branch is cut on Thursdays."),
    );
  });

  it("counts what the filter shows", async () => {
    mock.entries = [
      entry({}),
      entry({ id: "memory-2", text: "Screenshots go in docs/images.", tags: ["docs"] }),
    ];
    await using screen = await renderUi(<CodeItLabMemoryPage />);
    const filter = screen.container.querySelector<HTMLInputElement>(
      '[aria-label="Filter memories"]',
    );
    await userEvent.fill(filter as HTMLInputElement, "docs");
    await vi.waitFor(() =>
      expect(screen.container.textContent).toContain("Showing 1 of 2 memories for “docs”."),
    );
  });
});
