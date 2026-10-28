// @effect-diagnostics nodeBuiltinImport:off - reads the components to check their group behaviour.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { describe, expect, it } from "vite-plus/test";

/**
 * UI.md asks a group of choices to be one tab stop with arrow keys. That is easy
 * to lose when a new filter row is written as a plain map of buttons, so mapped
 * `aria-pressed` buttons have to go through CodeItLabToggleGroup instead.
 */
const componentsRoot =
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)) + "/../components/codeitlab";

const sources = NodeFS.readdirSync(componentsRoot)
  .filter((name) => name.endsWith(".tsx") && !name.includes(".test."))
  .map((name) => ({
    name,
    source: NodeFS.readFileSync(NodePath.join(componentsRoot, name), "utf8"),
  }));

describe("CodeItLab toggle groups", () => {
  it("sends mapped toggle buttons through the shared group", () => {
    const offenders = sources
      .filter(({ name }) => name !== "CodeItLabPrimitives.tsx")
      .filter(({ source }) => {
        // A mapped toggle either returns <Button> directly or from a block body.
        const direct = /\.map\([^)]{0,160}\)\s*=>\s*\(?\s*<Button[\s\S]{0,500}?aria-pressed/;
        const block = /\.map\([\s\S]{0,200}?return \(\s*<Button[\s\S]{0,500}?aria-pressed/;
        return direct.test(source) || block.test(source);
      })
      .map(({ name }) => name);
    expect(offenders).toEqual([]);
  });

  it("keeps the shared group a single tab stop with arrow keys", () => {
    const primitives = sources.find(({ name }) => name === "CodeItLabPrimitives.tsx")!.source;
    expect(primitives).toContain("tabIndex={selected ? 0 : -1}");
    for (const key of ["ArrowRight", "ArrowLeft", "Home", "End"]) {
      expect(primitives).toContain(`event.key === "${key}"`);
    }
  });

  it("keeps the section navigation roving", () => {
    const nav = sources.find(({ name }) => name === "CodeItLabSectionNav.tsx")!.source;
    expect(nav).toContain("tabIndex={active ? 0 : -1}");
    expect(nav).toContain("nextSectionIndex(from, event.key, CODEITLAB_SECTIONS.length)");
  });
});
