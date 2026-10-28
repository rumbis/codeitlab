// @effect-diagnostics nodeBuiltinImport:off - reads the stylesheet to guard the motion budget.
import * as NodeFS from "node:fs";

import { describe, expect, it } from "vite-plus/test";

const codeitlabComponents = NodeFS.readdirSync(
  new URL("../components/codeitlab", import.meta.url),
  { recursive: true, encoding: "utf8" },
).filter((entry) => entry.endsWith(".tsx"));

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

  it("keeps codeitlab components free of continuous or long motion", () => {
    // The panel entrance and the sheet are the only motions UI.md allows; a
    // component-level `animate-*` or a 300ms width transition is exactly the
    // "speeding it up" the doc warns against.
    const offenders: string[] = [];
    for (const file of codeitlabComponents) {
      const source = NodeFS.readFileSync(
        new URL(`../components/codeitlab/${file}`, import.meta.url),
        "utf8",
      );
      for (const match of source.matchAll(
        /animate-[a-z-]+|transition-\[width\]|duration-[3-9]\d\d/g,
      )) {
        offenders.push(`${file}: ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("moves the panel entrance no more than four pixels", () => {
    const start = css.indexOf("@keyframes codeitlab-page-enter");
    expect(start).toBeGreaterThan(-1);
    const block = css.slice(start, css.indexOf("}", start) + 1);
    const moves = [...block.matchAll(/translateY\((-?\d+(?:\.\d+)?)px\)/g)].map((match) =>
      Math.abs(Number(match[1])),
    );
    expect(moves.length).toBeGreaterThan(0);
    for (const distance of moves) expect(distance).toBeLessThanOrEqual(4);
  });

  it("keeps the ambient scene static when motion is reduced", () => {
    const source = NodeFS.readFileSync(new URL("./ambientScene.ts", import.meta.url), "utf8");
    expect(source).toContain("prefers-reduced-motion: reduce");
    // One static frame instead of the render loop.
    expect(source).toContain("if (reducedMotion) renderOnce();");
    expect(source).toContain("if (!reducedMotion) rafId = requestAnimationFrame(tick);");
  });

  it("lets the loading skeleton opt out of motion", () => {
    const source = NodeFS.readFileSync(
      new URL("../components/ui/skeleton.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("motion-safe:animate-skeleton");
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
