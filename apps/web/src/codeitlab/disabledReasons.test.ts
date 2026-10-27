// @effect-diagnostics nodeBuiltinImport:off - reads the panels to check their disabled reasons.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { describe, expect, it } from "vite-plus/test";

/**
 * UI.md: a disabled control either stays focusable because its reason must be read,
 * or the reason is wired to it with aria-describedby. These are the actions whose
 * reason is not obvious from the label, so they are the ones that have to be wired.
 */
const componentsRoot =
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)) + "/../components/codeitlab";

const wired = [
  { file: "CodeItLabShortsJobs.tsx", marker: "data-shorts-submit" },
  { file: "CodeItLabRemotePage.tsx", marker: "data-remote-create-link" },
  { file: "CodeItLabBotsPage.tsx", marker: "data-bot-start" },
] as const;

const read = (file: string) => NodeFS.readFileSync(NodePath.join(componentsRoot, file), "utf8");

/** aria-describedby is either a literal, a template literal, or a ternary of both. */
const describedById = (element: string): string | null => {
  const literal = /aria-describedby="([\w-]+)"/.exec(element);
  if (literal?.[1] !== undefined) return literal[1];
  const template = /aria-describedby=\{`([^`]+)`\}/.exec(element);
  if (template?.[1] !== undefined) return template[1];
  const ternary = /aria-describedby=\{[^}]*?"([\w-]+)"/.exec(element);
  return ternary?.[1] ?? null;
};

describe("disabled actions explain themselves", () => {
  it.each(wired)("$file wires its disabled reason", ({ file, marker }) => {
    const source = read(file);
    const at = source.indexOf(marker);
    expect(at, `${marker} missing from ${file}`).toBeGreaterThan(-1);
    const start = source.lastIndexOf("<Button", at);
    const element = source.slice(start, at + marker.length + 2);
    const id = describedById(element);
    expect(id, `${marker} has no aria-describedby`).not.toBeNull();
    // The bot case builds the id from the bot id, so only a static id is checked
    // for a matching element; a template one is checked by its prefix.
    if ((id ?? "").includes("${")) {
      const prefix = (id ?? "").split("${")[0] ?? "";
      expect(source, `${prefix} is referenced but never rendered`).toContain(`id={\`${prefix}`);
    } else {
      expect(source, `${id} is referenced but never rendered`).toContain(`id="${id}"`);
    }
  });
});
