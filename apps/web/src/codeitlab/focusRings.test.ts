// @effect-diagnostics nodeBuiltinImport:off - reads the components to check their focus styles.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { describe, expect, it } from "vite-plus/test";

/**
 * UI.md asks every interactive control to show a visible focus ring. Controls that
 * come from components/ui inherit one; a raw <button>, <select> or a native
 * checkbox is where the ring silently disappears, so those have to opt in or use
 * the design-system component.
 */
const componentsRoot =
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)) + "/../components/codeitlab";

const files = NodeFS.readdirSync(componentsRoot).filter((name) => name.endsWith(".tsx"));

const sources = files
  .filter((name) => !name.includes(".test."))
  .map((name) => ({
    name,
    source: NodeFS.readFileSync(NodePath.join(componentsRoot, name), "utf8"),
  }));

describe("CodeItLab focus rings", () => {
  it("uses the shared checkbox instead of a native one", () => {
    const offenders = sources
      .filter(({ source }) => /<input[^>]*type="checkbox"/.test(source))
      .map(({ name }) => name);
    expect(offenders).toEqual([]);
  });

  it("gives raw selects and buttons a focus-visible ring", () => {
    const offenders: string[] = [];
    for (const { name, source } of sources) {
      for (const match of source.matchAll(/<(select|button)\b[\s\S]{0,400}?>/g)) {
        if (!match[0].includes("focus-visible")) {
          offenders.push(`${name}: ${match[1]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the ring inside the control", () => {
    // no-outset-state-indicators: an outline offset would paint over neighbours.
    const offenders = sources
      .filter(({ source }) => /focus-visible:outline-offset-[1-9]/.test(source))
      .map(({ name }) => name);
    expect(offenders).toEqual([]);
  });
});
