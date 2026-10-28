// @effect-diagnostics nodeBuiltinImport:off - reads the error surfaces to check their copy.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { describe, expect, it } from "vite-plus/test";

/**
 * The UI bar asks every error to say what still works. A bare message plus Retry
 * is the failure mode this catches: it leaves the reader unsure whether their data
 * survived, so each file that renders an error has to name the fallback too.
 */
const componentsRoot =
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)) + "/../components/codeitlab";
const chatRoot = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)) + "/../components/chat";

const fallbackWords = [
  "still works",
  "keeps working",
  "keeps running",
  "untouched",
  "paused",
  "unchanged",
  "local copy",
  "only lost",
];

const files = NodeFS.readdirSync(componentsRoot).filter((name) => name.endsWith(".tsx"));

const errorSurfaces = files.filter((name) => {
  if (name.includes(".test.")) return false;
  const source = NodeFS.readFileSync(NodePath.join(componentsRoot, name), "utf8");
  return source.includes('variant="error"') || source.includes("text-error-foreground");
});

describe("CodeItLab error states", () => {
  it("finds the surfaces that can show an error", () => {
    expect(errorSurfaces.length).toBeGreaterThan(0);
  });

  it("says what still works next to every error", () => {
    const missing = errorSurfaces.filter((name) => {
      const source = NodeFS.readFileSync(NodePath.join(componentsRoot, name), "utf8");
      return !fallbackWords.some((word) => source.includes(word));
    });
    expect(missing).toEqual([]);
  });
});

describe("chat error states", () => {
  it("tells the reader the conversation survived the failed turn", () => {
    const banner = NodeFS.readFileSync(NodePath.join(chatRoot, "ThreadErrorBanner.tsx"), "utf8");
    expect(banner).toContain("The conversation is saved");
    expect(banner).toContain("retry the turn");
  });
});
