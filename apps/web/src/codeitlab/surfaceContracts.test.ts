// @effect-diagnostics nodeBuiltinImport:off - reads the four surfaces to check the shared contract.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { describe, expect, it } from "vite-plus/test";

/**
 * The UI bar names four surfaces: chat, settings panel, command palette and the
 * desktop shell. Each was walked on its own; this file holds the shared contract
 * they ended up with so a new surface cannot quietly ship without it.
 */
const componentsRoot = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)) + "/../components";

const read = (relative: string) =>
  NodeFS.readFileSync(NodePath.join(componentsRoot, relative), "utf8");

const surfaces = {
  chat: "chat/ThreadErrorBanner.tsx",
  settings: "settings/SettingsSearchEmptyState.tsx",
  palette: "CommandPaletteResults.tsx",
  shell: "desktop/QuickOverlayLauncher.tsx",
} as const;

describe("surface contracts", () => {
  it("names a next step whenever a surface has nothing to show", () => {
    expect(read(surfaces.chat)).toContain("retry the turn");
    expect(read(surfaces.settings)).toContain("Clear search and browse the sections");
    expect(read(surfaces.palette)).toContain("press Esc to close");
  });

  it("announces empty and async states with a live region", () => {
    for (const file of [surfaces.settings, surfaces.palette]) {
      expect(read(file)).toContain('role="status"');
    }
  });

  it("gives every surface's main control a visible focus indicator", () => {
    expect(read(surfaces.shell)).toContain("focus-visible:outline-2");
    // The palette removes the ring from its own input because the whole shell is
    // the focus context; that exception has to stay explicit.
    expect(read("ui/command.tsx")).toContain("has-focus-visible:ring-0");
  });

  it("keeps the shell dialog a modal", () => {
    const shell = read(surfaces.shell);
    expect(shell).toContain('event.key === "Escape"');
    expect(shell).toContain('event.key !== "Tab"');
    expect(shell).toContain('aria-modal="true"');
  });
});
