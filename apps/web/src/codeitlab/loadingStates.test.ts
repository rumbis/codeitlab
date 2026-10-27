// @effect-diagnostics nodeBuiltinImport:off - reads the loading surfaces to check their labels.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { describe, expect, it } from "vite-plus/test";

/**
 * A skeleton that announces nothing is silent to a screen reader: the page simply
 * looks finished and empty. Every loading block therefore has to name what is
 * loading, which this keeps true as pages are added.
 */
const componentsRoot =
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)) + "/../components/codeitlab";

const files = NodeFS.readdirSync(componentsRoot).filter((name) => name.endsWith(".tsx"));

const usages = files.flatMap((name) => {
  if (name.includes(".test.") || name === "CodeItLabPrimitives.tsx") return [];
  const source = NodeFS.readFileSync(NodePath.join(componentsRoot, name), "utf8");
  const matches = source.matchAll(/<CodeItLabLoadingRows\b([^>]*)\/>/g);
  return [...matches].map((match) => ({ file: name, props: match[1] ?? "" }));
});

describe("CodeItLab loading states", () => {
  it("finds the pages that render a skeleton", () => {
    expect(usages.length).toBeGreaterThan(0);
  });

  it("names what each skeleton is loading", () => {
    const missing = usages
      .filter((usage) => !/\blabel="/.test(usage.props))
      .map((usage) => usage.file);
    expect(missing).toEqual([]);
  });
});
