// @effect-diagnostics nodeBuiltinImport:off - reads the stylesheet to guard the motion budget.
import * as NodeFS from "node:fs";

import { describe, expect, it } from "vite-plus/test";

/**
 * UI.md asks for one short entrance and a reduced-motion branch for every
 * animation. Tailwind utilities on primitives cannot carry that branch, so the
 * stylesheet owns it and this test fails if the branch is deleted.
 */
const css = NodeFS.readFileSync(new URL("../index.css", import.meta.url), "utf8");

const reducedMotionBlock = (): string => {
  const start = css.indexOf("@media (prefers-reduced-motion: reduce)");
  expect(start, "no reduced-motion block in index.css").toBeGreaterThan(-1);
  return css.slice(start);
};

describe("motion budget", () => {
  it("turns the panel entrance off under reduced motion", () => {
    const block = reducedMotionBlock();
    expect(block).toContain(".codeitlab-page-enter");
    expect(block).toMatch(/\.codeitlab-page-enter\s*\{\s*animation:\s*none;/);
  });

  it("turns the sheet transition off under reduced motion", () => {
    const block = reducedMotionBlock();
    expect(block).toContain('[data-slot="sheet-backdrop"]');
    expect(block).toContain('[data-slot="sheet-popup"]');
    expect(block).toMatch(/transition:\s*none\s*!important/);
  });

  it("keeps the panel entrance inside the 120-200ms budget", () => {
    const match =
      /\.codeitlab-page-enter\s*\{[^}]*animation:\s*codeitlab-page-enter\s+(\d+)ms/.exec(css);
    expect(match?.[1]).toBeDefined();
    const duration = Number(match?.[1]);
    expect(duration).toBeGreaterThanOrEqual(120);
    expect(duration).toBeLessThanOrEqual(200);
  });
});
