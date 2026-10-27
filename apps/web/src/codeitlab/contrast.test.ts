// @effect-diagnostics nodeBuiltinImport:off - reads the theme tokens to check their contrast.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { describe, expect, it } from "vite-plus/test";

/**
 * UI.md allows accent text only where it stays readable. The status chips put
 * `text-codeitlab-green` on `bg-codeitlab-green/8…12`, so this measures the real
 * pair from index.css instead of trusting the eye: WCAG AA for small text is 4.5.
 */
const cssPath = NodePath.join(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "../index.css",
);
const css = NodeFS.readFileSync(cssPath, "utf8");

function hexTokens(name: string): ReadonlyArray<string> {
  return [...css.matchAll(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`, "g"))].map(
    (match) => match[1]!,
  );
}

function channels(hex: string): [number, number, number] {
  return [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16)) as [
    number,
    number,
    number,
  ];
}

function linear(value: number): number {
  const channel = value / 255;
  return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function luminance([r, g, b]: readonly [number, number, number]): number {
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrast(a: readonly [number, number, number], b: readonly [number, number, number]) {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function tint(
  color: readonly [number, number, number],
  background: readonly [number, number, number],
  alpha: number,
): [number, number, number] {
  return color.map((value, index) =>
    Math.round(value * alpha + background[index]! * (1 - alpha)),
  ) as [number, number, number];
}

const themes = ["light", "dark"] as const;

describe("CodeItLab accent contrast", () => {
  it("keeps accent text above AA on its own tint", () => {
    const backgrounds = hexTokens("--background");
    expect(backgrounds.length).toBeGreaterThanOrEqual(2);
    const failures: string[] = [];
    for (const [index, theme] of themes.entries()) {
      const background = channels(backgrounds[index]!);
      for (const token of ["--codeitlab-green", "--codeitlab-cyan"]) {
        const color = channels(hexTokens(token)[index]!);
        for (const alpha of [0.08, 0.1, 0.12]) {
          const ratio = contrast(color, tint(color, background, alpha));
          if (ratio < 4.5) {
            failures.push(`${theme} ${token} @${alpha}: ${ratio.toFixed(2)}`);
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });
});
