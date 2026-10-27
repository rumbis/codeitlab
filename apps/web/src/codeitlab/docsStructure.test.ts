// @effect-diagnostics nodeBuiltinImport:off - reads the docs to guard their structure.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { describe, expect, it } from "vite-plus/test";

const docs = ["STATUS.md", "LIMITS.md", "UI.md"] as const;

const repoRoot = NodePath.resolve(
  NodeURL.fileURLToPath(new URL(".", import.meta.url)),
  "../../../..",
);
const docsRoot = NodePath.join(repoRoot, "docs");

const markdownFiles = (): string[] => [
  NodePath.join(repoRoot, "README.md"),
  ...NodeFS.readdirSync(docsRoot, { recursive: true, encoding: "utf8" })
    .filter((entry) => entry.endsWith(".md"))
    .map((entry) => NodePath.join(docsRoot, entry)),
];

/**
 * GitHub's heading anchor: lowercase, punctuation dropped, spaces to hyphens.
 * Good enough for the headings this repo uses, and it keeps unicode letters.
 */
const anchorOf = (heading: string): string =>
  heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s/g, "-");

const anchorsOf = (file: string): Set<string> => {
  const anchors = new Set<string>();
  for (const line of NodeFS.readFileSync(file, "utf8").split("\n")) {
    const match = /^#{1,6}\s+(.*)$/.exec(line);
    if (match?.[1] !== undefined) anchors.add(anchorOf(match[1]));
  }
  return anchors;
};

/** Fenced blocks and inline code show syntax, not links, so neither is checked. */
const stripCode = (source: string): string =>
  source.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");

const read = (name: string): string =>
  NodeFS.readFileSync(new URL(`../../../../docs/codeitlab/${name}`, import.meta.url), "utf8");

describe("codeitlab docs structure", () => {
  it("keeps each doc's second-level headings unique", () => {
    // A duplicated heading means two sections claim the same topic; STATUS.md had
    // 29 of them after a bad merge, which hid the newer text behind an older copy.
    for (const name of docs) {
      const headings = read(name)
        .split("\n")
        .filter((line) => line.startsWith("## "))
        .map((line) => line.trim());
      expect(headings.length).toBeGreaterThan(0);
      expect(new Set(headings).size, `duplicate headings in ${name}`).toBe(headings.length);
    }
  });

  it("keeps every relative link pointing at a real file", () => {
    const broken: string[] = [];
    for (const file of markdownFiles()) {
      const source = stripCode(NodeFS.readFileSync(file, "utf8"));
      for (const match of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
        const target = (match[1] ?? "").split("#")[0]?.trim() ?? "";
        if (target === "" || /^(?:https?:|mailto:|#)/.test(target)) continue;
        const resolved = NodePath.resolve(NodePath.dirname(file), target);
        if (!NodeFS.existsSync(resolved))
          broken.push(`${NodePath.relative(repoRoot, file)} -> ${target}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it("lists every user guide in the user index", () => {
    // README links the short path; docs/user/README.md is the complete index, so a
    // new guide that is not listed there is invisible from the docs entry points.
    const index = NodeFS.readFileSync(NodePath.join(docsRoot, "user", "README.md"), "utf8");
    const unlisted = NodeFS.readdirSync(NodePath.join(docsRoot, "user"))
      .filter((entry) => entry.endsWith(".md") && entry !== "README.md")
      .filter((entry) => !index.includes(`./${entry}`));
    expect(unlisted).toEqual([]);
    const readme = NodeFS.readFileSync(NodePath.join(repoRoot, "README.md"), "utf8");
    expect(readme).toContain("./docs/user/README.md");
  });

  it("lists every constraint doc in its index", () => {
    const index = NodeFS.readFileSync(NodePath.join(docsRoot, "codeitlab", "README.md"), "utf8");
    const unlisted = NodeFS.readdirSync(NodePath.join(docsRoot, "codeitlab"))
      .filter((entry) => entry.endsWith(".md") && entry !== "README.md")
      .filter((entry) => !index.includes(`./${entry}`));
    expect(unlisted).toEqual([]);
    const readme = NodeFS.readFileSync(NodePath.join(repoRoot, "README.md"), "utf8");
    expect(readme).toContain("./docs/codeitlab/README.md");
  });

  it("keeps test counts inside the verification snapshot only", () => {
    // A count in the prose is an unmeasured claim the moment someone adds a test.
    // STATUS.md must keep numbers in the snapshot table and nowhere else.
    const status = read("STATUS.md");
    const snapshot = status.indexOf("## Verification snapshot");
    expect(snapshot).toBeGreaterThan(-1);
    expect(status.slice(snapshot)).toMatch(/## Verification snapshot \(\d{4}-\d{2}-\d{2}\)/);
    const prose = status.slice(0, snapshot);
    expect(prose).not.toMatch(/\d+\s+tests\b/);
  });

  it("points at code paths that exist", () => {
    // A doc that names `apps/.../Thing.ts` is a map; a stale map sends a reader to
    // a file that was renamed. FEATURE-SPEC.md and BUILD-PLAN.md are design
    // documents with their own banner, so they are excluded on purpose.
    const design = new Set(["FEATURE-SPEC.md", "BUILD-PLAN.md"]);
    const constraintRoot = NodePath.join(docsRoot, "codeitlab");
    const names = NodeFS.readdirSync(constraintRoot).filter(
      (name) => name.endsWith(".md") && !design.has(name),
    );
    expect(names.length).toBeGreaterThan(20);
    const missing: string[] = [];
    for (const name of names) {
      for (const match of read(name).matchAll(/`((?:apps|packages|scripts)\/[A-Za-z0-9_./-]+)`/g)) {
        const path = match[1]?.replace(/\/$/, "") ?? "";
        if (!NodeFS.existsSync(NodePath.join(repoRoot, path))) missing.push(`${name}: ${path}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("keeps user guides pointing at real files and legacy names", () => {
    // docs/user is the flow documentation: a path there sends a person to a file,
    // and a legacy CIL_ name there promises a name the code still reads.
    const userRoot = NodePath.join(docsRoot, "user");
    const guides = NodeFS.readdirSync(userRoot).filter((name) => name.endsWith(".md"));
    expect(guides.length).toBeGreaterThan(40);
    const sources = new Map(
      guides.map((name) => [name, NodeFS.readFileSync(NodePath.join(userRoot, name), "utf8")]),
    );
    // Walk only the source roots: a recursive read of the repo root drags in
    // node_modules and aborts the worker.
    const skip = new Set(["node_modules", "dist", "release", ".git", "build"]);
    const sourceFiles: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of NodeFS.readdirSync(dir, { withFileTypes: true })) {
        if (skip.has(entry.name)) continue;
        const path = NodePath.join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.(ts|tsx|mjs|js|json|sh)$/.test(entry.name)) sourceFiles.push(path);
      }
    };
    for (const root of ["apps", "packages", "scripts"]) walk(NodePath.join(repoRoot, root));
    const repoText = sourceFiles.map((file) => NodeFS.readFileSync(file, "utf8")).join("\n");

    const missing: string[] = [];
    for (const [name, source] of sources) {
      for (const match of source.matchAll(/`((?:apps|packages|scripts)\/[A-Za-z0-9_./-]+)`/g)) {
        const path = match[1]?.replace(/\/$/, "") ?? "";
        if (!NodeFS.existsSync(NodePath.join(repoRoot, path))) missing.push(`${name}: ${path}`);
      }
      for (const match of source.matchAll(/\b(CIL_[A-Z0-9_]+)\b/g)) {
        if (!repoText.includes(match[1] ?? "")) missing.push(`${name}: ${match[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("does not promise the hosted deployments without the caveat", () => {
    // app.codeitlab.com answers nothing and codeitlab.com/market returns 404; a doc
    // that tells someone to install or buy there without saying so is lying.
    const readme = NodeFS.readFileSync(NodePath.join(repoRoot, "README.md"), "utf8");
    expect(readme).toContain("Neither hosted deployment is live yet");
    const pwa = read("PWA.md");
    const lines = pwa.split("\n").filter((line) => line.includes("app.codeitlab.com"));
    expect(lines.length).toBeGreaterThan(0);
    expect(
      lines.some((line) => /not live yet|intended hosted origin|intended origin/i.test(line)),
    ).toBe(true);
    const limits = read("LIMITS.md");
    expect(limits).toContain("Hosted deployments");
  });

  it("keeps the telemetry account honest and identical in both docs", () => {
    // The server does send product events upstream; a LIMITS page claiming it sends
    // none contradicts docs/user/telemetry.md and the code's default.
    const limits = read("LIMITS.md");
    expect(limits).not.toMatch(/sends no telemetry|no telemetry by default/i);
    const telemetry = NodeFS.readFileSync(NodePath.join(docsRoot, "user", "telemetry.md"), "utf8");
    for (const file of [limits, telemetry]) {
      expect(file).toContain("ingest.codeitlab.dev");
      expect(file).toContain("CIL_TELEMETRY_ENABLED=false");
    }
  });

  it("keeps every in-page anchor pointing at a real heading", () => {
    const broken: string[] = [];
    for (const file of markdownFiles()) {
      const source = stripCode(NodeFS.readFileSync(file, "utf8"));
      for (const match of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
        const target = match[1] ?? "";
        if (target.startsWith("http")) continue;
        const hash = target.indexOf("#");
        if (hash === -1) continue;
        const anchor = target.slice(hash + 1);
        if (anchor === "") continue;
        const pathPart = target.slice(0, hash);
        const targetFile =
          pathPart === "" ? file : NodePath.resolve(NodePath.dirname(file), pathPart);
        if (!NodeFS.existsSync(targetFile) || !targetFile.endsWith(".md")) continue;
        if (!anchorsOf(targetFile).has(anchor)) {
          broken.push(`${NodePath.relative(repoRoot, file)} -> ${target}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });
});
