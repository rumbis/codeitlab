// @effect-diagnostics nodeBuiltinImport:off - the guard reads the repository from disk.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

/**
 * macOS and Windows resolve imports case-insensitively; Linux does not. A file
 * renamed to a different casing than its importers therefore builds locally and
 * fails on CI, which is how every web build broke at once. Resolve each relative
 * specifier against the directory listing to catch the mismatch on any host.
 */
const ROOT = NodePath.resolve(new URL("../../../", import.meta.url).pathname);

const SKIPPED_DIRECTORIES = new Set([
  ".cil",
  ".generated",
  ".git",
  ".next",
  ".repos",
  ".turbo",
  "Pods",
  "android",
  "build",
  "coverage",
  "dist",
  "ios",
  "node_modules",
  "out",
  "release",
]);

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts"];
const RESOLVE_SUFFIXES = ["", ".ts", ".tsx", ".mts", ".cts", ".d.ts"];
const SPECIFIER =
  /(?:from|import)\s*\(\s*["'](\.[^"']*)["']\s*\)|(?:from|import)\s+["'](\.[^"']*)["']/g;

const walk = (directory: string, files: Array<string>): Array<string> => {
  for (const entry of NodeFS.readdirSync(directory, { withFileTypes: true })) {
    const full = NodePath.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      walk(full, files);
    } else if (entry.isFile() && SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      files.push(full);
    }
  }
  return files;
};

/** Directory listings, cached: the walk asks about most directories many times. */
const listings = new Map<string, Set<string>>();
const listing = (directory: string): Set<string> => {
  const cached = listings.get(directory);
  if (cached !== undefined) return cached;
  const entries = NodeFS.existsSync(directory)
    ? new Set(NodeFS.readdirSync(directory))
    : new Set<string>();
  listings.set(directory, entries);
  return entries;
};

/** The file a specifier means, or null when it resolves through a path alias. */
const resolveExactly = (fromFile: string, specifier: string): string | null => {
  const base = NodePath.resolve(NodePath.dirname(fromFile), specifier);
  const directory = NodePath.dirname(base);
  const name = NodePath.basename(base);
  const entries = listing(directory);
  for (const suffix of RESOLVE_SUFFIXES) {
    if (entries.has(name + suffix)) return base + suffix;
  }
  const indexDirectory = listing(base);
  for (const index of ["index.ts", "index.tsx"]) {
    if (indexDirectory.has(index)) return NodePath.join(base, index);
  }
  return null;
};

/** A case-insensitive sibling is the bug: the import only works on some hosts. */
const caseInsensitiveMatch = (fromFile: string, specifier: string): string | null => {
  const base = NodePath.resolve(NodePath.dirname(fromFile), specifier);
  const name = NodePath.basename(base).toLowerCase();
  const hit = [...listing(NodePath.dirname(base))].find((entry) => {
    const lowered = entry.toLowerCase();
    return lowered === name || RESOLVE_SUFFIXES.some((suffix) => lowered === name + suffix);
  });
  return hit ?? null;
};

describe("relative import casing", () => {
  it("resolves every relative import with the casing on disk", () => {
    const offenders: Array<string> = [];
    for (const file of walk(ROOT, [])) {
      const text = NodeFS.readFileSync(file, "utf8");
      for (const match of text.matchAll(SPECIFIER)) {
        const specifier = match[1] ?? match[2];
        if (specifier === undefined) continue;
        if (resolveExactly(file, specifier) !== null) continue;
        const hit = caseInsensitiveMatch(file, specifier);
        if (hit !== null) {
          offenders.push(`${NodePath.relative(ROOT, file)}: ${specifier} -> ${hit}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  }, 30_000);
});
