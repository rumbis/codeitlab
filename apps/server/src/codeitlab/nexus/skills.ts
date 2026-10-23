import type { NexusSkill, NexusSkillSource } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import { skillId } from "./fingerprint.ts";

/** Caps keep one enormous harness install from turning refresh into a scan of the disk. */
const MAX_SKILL_FILES = 500;
const MAX_SKILL_FILE_BYTES = 64 * 1024;
const MAX_SKILL_DEPTH = 5;

export interface NexusSourceResult<T> {
  readonly items: ReadonlyArray<T>;
  readonly warnings: ReadonlyArray<string>;
}

export interface NexusSkillRoot {
  readonly source: NexusSkillSource;
  readonly root: string;
}

/**
 * Skill directories are read-only: Nexus never writes into a harness's own
 * config, so a harness update can never be corrupted by a catalog refresh.
 */
export function nexusSkillRoots(input: {
  readonly homeDir: string;
  readonly appSkillsDir: string;
}): ReadonlyArray<NexusSkillRoot> {
  const { homeDir, appSkillsDir } = input;
  const join = (...parts: ReadonlyArray<string>) => [homeDir, ...parts].join("/");
  return [
    { source: "hermes", root: join(".hermes", "skills") },
    { source: "claude", root: join(".claude", "skills") },
    { source: "codex", root: join(".codex", "skills") },
    { source: "cursor", root: join(".cursor", "skills") },
    { source: "opencode", root: join(".config", "opencode", "skills") },
    // App-managed skills (REA seed and future CodeitLab skills) are written by
    // the server itself, so they are safe to treat as first-class sources.
    { source: "codeitlab", root: appSkillsDir },
  ];
}

/** Parse the YAML-ish frontmatter every harness skill uses; only name/description matter. */
export function parseSkillDocument(contents: string): {
  readonly name?: string;
  readonly description?: string;
} {
  const lines = contents.split(/\r?\n/u);
  if (lines[0]?.trim() !== "---") return {};
  const fields: Record<string, string> = {};
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.trim() === "---") break;
    const match = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/u.exec(line);
    if (match === null) continue;
    const [, key, rawValue] = match;
    if (key === undefined || rawValue === undefined) continue;
    const value = rawValue
      .trim()
      .replace(/^["']|["']$/gu, "")
      .trim();
    if (value.length > 0) fields[key] = value;
  }
  return {
    ...(fields.name !== undefined ? { name: fields.name } : {}),
    ...(fields.description !== undefined ? { description: fields.description } : {}),
  };
}

const fallbackDescription = (contents: string): string => {
  const body = contents.replace(/^---[\s\S]*?---\r?\n/u, "");
  const line = body
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0 && !entry.startsWith("#"));
  return line === undefined ? "" : line.slice(0, 240);
};

const skillNameFromPath = (filePath: string): string => {
  const parent =
    filePath
      .replace(/\/SKILL\.md$/u, "")
      .split("/")
      .pop() ?? "";
  return parent.replace(/[-_]+/gu, " ").trim();
};

const readSkillFile = Effect.fn("Nexus.readSkillFile")(function* (
  root: NexusSkillRoot,
  filePath: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const stat = yield* fs.stat(filePath).pipe(Effect.orElseSucceed(() => undefined));
  if (stat === undefined || stat.type !== "File" || Number(stat.size) > MAX_SKILL_FILE_BYTES) {
    return undefined;
  }
  const contents = yield* fs.readFileString(filePath).pipe(Effect.orElseSucceed(() => undefined));
  if (contents === undefined) return undefined;
  const frontmatter = parseSkillDocument(contents);
  const name = frontmatter.name ?? skillNameFromPath(filePath);
  if (name.length === 0) return undefined;
  const description = frontmatter.description ?? fallbackDescription(contents);
  return {
    id: skillId(root.source, name),
    name,
    description,
    source: root.source,
    path: filePath,
    alsoAvailableIn: [],
  } satisfies NexusSkill;
});

const findSkillFiles = Effect.fn("Nexus.findSkillFiles")(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const files: Array<string> = [];
  const walk = (directory: string, depth: number): Effect.Effect<void> =>
    Effect.gen(function* () {
      if (depth > MAX_SKILL_DEPTH || files.length >= MAX_SKILL_FILES) return;
      const entries = yield* fs
        .readDirectory(directory)
        .pipe(Effect.orElseSucceed((): Array<string> => []));
      for (const entry of entries.toSorted()) {
        if (files.length >= MAX_SKILL_FILES) return;
        if (entry.startsWith(".") || entry === "node_modules") continue;
        const child = `${directory}/${entry}`;
        const stat = yield* fs.stat(child).pipe(Effect.orElseSucceed(() => undefined));
        if (stat === undefined) continue;
        if (stat.type === "Directory") {
          yield* walk(child, depth + 1);
        } else if (stat.type === "File" && entry === "SKILL.md") {
          files.push(child);
        }
      }
    });
  yield* walk(root, 0);
  return files;
});

export const readNexusSkills = Effect.fn("Nexus.readNexusSkills")(function* (
  roots: ReadonlyArray<NexusSkillRoot>,
) {
  const items: Array<NexusSkill> = [];
  const warnings: Array<string> = [];
  for (const root of roots) {
    const files = yield* findSkillFiles(root.root);
    for (const file of files) {
      const skill = yield* readSkillFile(root, file);
      if (skill === undefined) {
        warnings.push(`Skipped unreadable or oversized skill file ${file}.`);
        continue;
      }
      items.push(skill);
    }
  }
  return { items, warnings } satisfies NexusSourceResult<NexusSkill>;
});
