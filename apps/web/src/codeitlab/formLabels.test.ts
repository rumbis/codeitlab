// @effect-diagnostics nodeBuiltinImport:off - reads the pages to guard label wiring.
import * as NodeFS from "node:fs";

import { describe, expect, it } from "vite-plus/test";

/**
 * A field without an accessible name is silent for screen readers. The design
 * system components forward `id`/`aria-label`, so the page has to pass one; this
 * scan is a heuristic (it does not prove the id has a label), but it catches the
 * plain `<Input>` that was only visually labelled by a sibling span.
 */
const pages = NodeFS.readdirSync(new URL("../components/codeitlab", import.meta.url), {
  recursive: true,
  encoding: "utf8",
}).filter((entry) => entry.endsWith(".tsx") && !entry.includes(".test."));

describe("form field labels", () => {
  it("gives every design-system field an id or an aria-label", () => {
    const offenders: string[] = [];
    for (const file of pages) {
      const lines = NodeFS.readFileSync(
        new URL(`../components/codeitlab/${file}`, import.meta.url),
        "utf8",
      ).split("\n");
      for (const [index, line] of lines.entries()) {
        if (!/<(?:Input|Textarea)\b/.test(line)) continue;
        const block = lines.slice(index, index + 12).join("\n");
        if (/\bid=|\baria-label(?:ledby)?=/.test(block)) continue;
        offenders.push(`${file}:${index + 1}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
