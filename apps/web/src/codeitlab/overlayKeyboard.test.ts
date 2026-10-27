// @effect-diagnostics nodeBuiltinImport:off - reads the overlay components to check their tests.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { describe, expect, it } from "vite-plus/test";

/**
 * The UI bar says Escape closes every overlay. A sheet added without a test is how
 * that quietly stops being true, so this scans the CodeItLab surfaces for overlay
 * primitives and requires the matching browser test to press Escape.
 */
const componentsRoot =
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)) + "/../components/codeitlab";

const files = NodeFS.readdirSync(componentsRoot).filter((name) => name.endsWith(".tsx"));

const overlays = files.filter((name) => {
  if (name.includes(".test.")) return false;
  const source = NodeFS.readFileSync(NodePath.join(componentsRoot, name), "utf8");
  return /<(?:Sheet|Dialog|AlertDialog)Content\b/.test(source);
});

const desktopRoot =
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)) + "/../components/desktop";

const rawDialogs = NodeFS.readdirSync(desktopRoot)
  .filter((name) => name.endsWith(".tsx") && !name.includes(".test."))
  .filter((name) =>
    /role="dialog"/.test(NodeFS.readFileSync(NodePath.join(desktopRoot, name), "utf8")),
  );

describe("CodeItLab overlays", () => {
  it("finds the surfaces that open a sheet or dialog", () => {
    expect(overlays.length).toBeGreaterThan(0);
  });

  it("closes each overlay with Escape in its browser test", () => {
    const missing: string[] = [];
    for (const name of overlays) {
      const testFile = NodePath.join(componentsRoot, name.replace(/\.tsx$/, ".browser.test.tsx"));
      if (!NodeFS.existsSync(testFile)) {
        missing.push(`${name}: no browser test`);
        continue;
      }
      if (!NodeFS.readFileSync(testFile, "utf8").includes("{Escape}")) {
        missing.push(`${name}: browser test never presses Escape`);
      }
    }
    expect(missing).toEqual([]);
  });
});

describe("desktop shell dialogs", () => {
  it("finds the shell dialogs", () => {
    expect(rawDialogs.length).toBeGreaterThan(0);
  });

  it("closes on Escape, traps Tab, and proves it in a browser test", () => {
    const missing: string[] = [];
    for (const name of rawDialogs) {
      const source = NodeFS.readFileSync(NodePath.join(desktopRoot, name), "utf8");
      if (!source.includes('event.key === "Escape"')) {
        missing.push(`${name}: no Escape handler`);
      }
      if (!source.includes('event.key !== "Tab"')) {
        missing.push(`${name}: Tab is not trapped`);
      }
      const testFile = NodePath.join(desktopRoot, name.replace(/\.tsx$/, ".browser.test.tsx"));
      if (!NodeFS.existsSync(testFile)) {
        missing.push(`${name}: no browser test`);
        continue;
      }
      const test = NodeFS.readFileSync(testFile, "utf8");
      if (!test.includes("{Escape}")) missing.push(`${name}: browser test never presses Escape`);
      if (!test.includes("{Tab}")) missing.push(`${name}: browser test never presses Tab`);
    }
    expect(missing).toEqual([]);
  });
});
