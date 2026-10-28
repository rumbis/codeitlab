// @effect-diagnostics nodeBuiltinImport:off - reads the settings nav to check its search states.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { describe, expect, it } from "vite-plus/test";

/**
 * The settings panel is one of the four surfaces the UI bar names. Its search box
 * is the only way through thirty-odd sections, so an empty result has to say what
 * search can reach and lead back to browsing instead of stopping at "not found".
 */
const settingsRoot =
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)) + "/../components/settings";

const read = (name: string) => NodeFS.readFileSync(NodePath.join(settingsRoot, name), "utf8");

describe("settings search surface", () => {
  it("renders the shared empty state instead of a bare not-found line", () => {
    const nav = read("SettingsSidebarNav.tsx");
    expect(nav).toContain("<SettingsSearchEmptyState");
    expect(nav).not.toContain("No settings found");
  });

  it("says what search covers and offers a way back", () => {
    const empty = read("SettingsSearchEmptyState.tsx");
    expect(empty).toContain("No setting matches");
    expect(empty).toContain("not the text inside");
    expect(empty).toContain("Clear search and browse the sections");
    expect(empty).toContain('role="status"');
  });
});
