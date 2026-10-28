// @effect-diagnostics nodeBuiltinImport:off - reads the navigation components to check positioning.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { describe, expect, it } from "vite-plus/test";

/**
 * UI.md says navigation is sticky, never fixed, so it cannot cover the app chrome
 * or the marketplace header. A background layer may be fixed; a bar may not.
 */
const componentsRoot =
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)) + "/../components/codeitlab";

const files = NodeFS.readdirSync(componentsRoot).filter((name) => name.endsWith(".tsx"));

const fixedUsages = files.flatMap((name) => {
  if (name.includes(".test.")) return [];
  const source = NodeFS.readFileSync(NodePath.join(componentsRoot, name), "utf8");
  return source
    .split("\n")
    .filter((line) => /(^|["\s])fixed([\s"]|$)/.test(line))
    .map((line) => ({ file: name, line: line.trim() }));
});

describe("CodeItLab navigation positioning", () => {
  it("uses sticky for the section navigation", () => {
    const nav = NodeFS.readFileSync(
      NodePath.join(componentsRoot, "CodeItLabSectionNav.tsx"),
      "utf8",
    );
    expect(nav).toContain("sticky top-0");
  });

  it("never fixes a bar over the chrome", () => {
    const offenders = fixedUsages
      .filter((usage) => !usage.line.includes("pointer-events-none"))
      .map((usage) => `${usage.file}: ${usage.line}`);
    expect(offenders).toEqual([]);
  });
});
