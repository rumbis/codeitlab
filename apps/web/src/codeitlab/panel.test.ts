// @effect-diagnostics nodeBuiltinImport:off - reads the route directory to compare it with the registry.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { describe, expect, it } from "vite-plus/test";

import {
  SETTINGS_SEARCH_ITEMS,
  SETTINGS_SECTION_LABELS,
} from "../components/settings/settingsSearch";
import { CODEITLAB_SECTIONS } from "./panel";
import { CODEITLAB_SECTION_ICONS } from "./sectionNav";

/**
 * The panel registry is the single list every surface reads: the settings tabs,
 * the sidebar icons and the search index. This test fails when a new section is
 * added without one of those, which is how a page silently becomes unreachable.
 */
const repoRoot = NodePath.resolve(
  NodeURL.fileURLToPath(new URL(".", import.meta.url)),
  "../../../..",
);
const routesRoot = NodePath.resolve(
  NodeURL.fileURLToPath(new URL(".", import.meta.url)),
  "../routes",
);
const routeFiles = (): ReadonlyArray<string> =>
  NodeFS.readdirSync(routesRoot).filter((name) => /^settings\.codeitlab(\..+)?\.tsx$/.test(name));
const allRouteNames = (): ReadonlyArray<string> =>
  NodeFS.readdirSync(routesRoot).map((name) => name.replace(/\.tsx$/, ""));
// Routing and Context are tabs inside the Models page now. Their route files
// stay so old deep links resolve, but they are not panel sections of their own.
const TAB_ROUTE_FILES = new Set([
  "settings.codeitlab.routing.tsx",
  "settings.codeitlab.context.tsx",
]);

describe("CodeItLab panel registry", () => {
  it("gives every section a unique label, path and icon", () => {
    const labels = CODEITLAB_SECTIONS.map((section) => section.label);
    const paths = CODEITLAB_SECTIONS.map((section) => section.to);
    expect(new Set(labels).size).toBe(labels.length);
    expect(new Set(paths).size).toBe(paths.length);
    for (const section of CODEITLAB_SECTIONS) {
      expect(section.label.trim()).not.toBe("");
      expect(CODEITLAB_SECTION_ICONS[section.id]).toBeDefined();
    }
  });

  it("has a route file for every section and no orphan route", () => {
    // The panel layout lives in settings.codeitlab.tsx and the overview page in
    // settings.codeitlab.index.tsx; both are structure, not sections.
    const layout = "settings.codeitlab.tsx";
    const routeFileNames = routeFiles();
    for (const file of TAB_ROUTE_FILES) {
      expect(routeFileNames.includes(file), `${file} is missing from apps/web/src/routes`).toBe(
        true,
      );
    }
    const files = new Set(
      routeFileNames.filter((name) => name !== layout && !TAB_ROUTE_FILES.has(name)),
    );
    expect(files.size).toBeGreaterThan(0);
    const expected = CODEITLAB_SECTIONS.map((section) =>
      section.to === "/settings/codeitlab"
        ? "settings.codeitlab.index.tsx"
        : `settings.codeitlab.${section.id}.tsx`,
    );
    for (const file of expected) {
      expect(files.has(file), `${file} is missing from apps/web/src/routes`).toBe(true);
    }
    const registered = new Set(expected);
    for (const file of files) {
      expect(registered.has(file), `${file} is not in CODEITLAB_SECTIONS`).toBe(true);
    }
  });

  it("keeps section icons in one place", () => {
    // The sidebar used to repeat an icon for every CodeItLab subpage even though
    // it filters them out of its own nav. Two maps drift; one map cannot.
    const sidebar = NodeFS.readFileSync(
      NodePath.join(repoRoot, "apps/web/src/components/settings/SettingsSidebarNav.tsx"),
      "utf8",
    );
    expect(sidebar).not.toMatch(/^\s*"\/settings\/codeitlab\/[a-z]+":/m);
    expect(sidebar).toContain('"/settings/codeitlab"');
  });

  it("routes every palette command at a real destination", () => {
    // A command that navigates nowhere is worse than a missing command: the user
    // types it, presses Enter, and the palette closes on an unchanged screen.
    const palette = NodeFS.readFileSync(
      NodePath.join(repoRoot, "apps/web/src/components/CommandPalette.tsx"),
      "utf8",
    );
    const destinations = new Set<string>();
    for (const match of palette.matchAll(/to: "([^"]+)"/g)) destinations.add(match[1] ?? "");
    for (const match of palette.matchAll(/navigate\(\{ to: "([^"]+)" \}\)/g)) {
      destinations.add(match[1] ?? "");
    }
    const sections = new Set(CODEITLAB_SECTIONS.map((section) => section.to as string));
    const routeNames = new Set(allRouteNames());
    for (const to of destinations) {
      if (to.startsWith("/settings/codeitlab")) {
        expect(sections.has(to), `${to} is not a panel section`).toBe(true);
        continue;
      }
      // Dynamic targets are thread/chat pages, whose params are not filenames.
      if (to.includes("$")) continue;
      // Everything else is a top-level page: /board -> _chat.board, /studio -> studio.
      const segments = to.split("/");
      const leaf = segments.findLast((segment) => segment !== "") ?? "";
      const exists =
        routeNames.has(leaf) ||
        routeNames.has(`_chat.${leaf}`) ||
        routeNames.has(`settings.${leaf}`);
      expect(exists, `${to} has no route file`).toBe(true);
    }
    // The five product surfaces are the point of this test: keep them covered.
    for (const to of [
      "/board",
      "/settings/codeitlab/marketplace",
      "/settings/codeitlab/bots",
      "/settings/codeitlab/deploy",
      "/settings/codeitlab/crew",
    ]) {
      expect(destinations.has(to), `${to} is missing from the command palette`).toBe(true);
    }
  });

  it("labels and indexes every section for search", () => {
    for (const section of CODEITLAB_SECTIONS) {
      expect(SETTINGS_SECTION_LABELS[section.to]).toBeDefined();
      const indexed = SETTINGS_SEARCH_ITEMS.some((item) => item.to === section.to);
      expect(indexed, `${section.to} is missing from the settings search index`).toBe(true);
    }
  });
});
