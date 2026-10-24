import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import * as HostProcess from "@t3tools/shared/HostProcess";

import { REA_SKILL_NAME } from "./mcp.ts";

/**
 * The REA npm package ships an MIT-licensed skill with the same tool inventory as
 * its MCP server. When a local installation is discoverable we copy it verbatim;
 * otherwise we write a bundled fallback so the skill exists offline and Nexus
 * always has a row for it.
 */

export const FALLBACK_REA_SKILL = `---
name: ${REA_SKILL_NAME}
description: Reverse engineer native, managed, Electron/JavaScript, packaged, firmware, and browser targets with the REA MCP server. Use shipped-artifact or runtime evidence to explain features, compare versions, decompile code, or guide a reconstruction.
metadata:
  version: "codeitlab-fallback"
---

# REA

REA is connected to this session as the \`codeitlab-rea\` MCP server. It answers
questions that need shipped-artifact evidence: a packaged app, an Electron asar,
a native binary, an APK, firmware, or a page bundle.

## When to use it

Reach for REA without being asked when the user asks about an installed app, a
binary, a packaged/asar build, a native addon, an APK, firmware, or "how does
this shipped thing work". Do not use it for ordinary analysis of a complete
source repository; normal repository tools are faster and more precise there.

## Working rules

1. Start with \`analyze\` (or \`inspect\`) to get an overview and an evidence id
   before drilling into functions.
2. Treat evidence as the source of truth. Quote the evidence id and the exact
   operation you ran; do not claim behavior the evidence does not show.
3. REA never executes the analyzed app unless a capture/observe operation is
   explicitly chosen. Prefer static analysis first, and disclose any operation
   with side effects (\`capabilities\` lists them) before running it.
4. Analysis engines are optional. If Hopper, Ghidra, IDA, JADX or Kuna are
   missing, use the operations that are available and report the missing engine
   instead of installing or guessing.
5. If the REA tools are absent from the tool list, say so and fall back to
   repository-level inspection; do not invent REA output.

## Recovery

If a REA tool call fails, inspect the error. Missing tools mean the MCP server
is not registered in this session; missing providers affect only operations that
need that engine. Report the concrete blocker rather than retrying setup.
`;

const REA_PACKAGE_SKILL_PATH = ["rea-agents", "skills", REA_SKILL_NAME, "SKILL.md"] as const;

export interface ReaSkillPaths {
  readonly skillDirectory: string;
  readonly skillPath: string;
}

export const reaSkillPaths = (
  stateDir: string,
  join: (parts: ReadonlyArray<string>) => string,
): ReaSkillPaths => {
  const skillDirectory = join([stateDir, "codeitlab", "skills", "rea"]);
  return { skillDirectory, skillPath: join([skillDirectory, "SKILL.md"]) };
};

/** Candidate locations for the upstream MIT skill, cheapest checks first. */
export const reaSkillSourceCandidates = (input: {
  readonly homeDirectory: string;
  readonly workingDirectory: string;
}): ReadonlyArray<string> => [
  `${input.workingDirectory}/node_modules/${REA_PACKAGE_SKILL_PATH.join("/")}`,
  `/opt/homebrew/lib/node_modules/${REA_PACKAGE_SKILL_PATH.join("/")}`,
  `/usr/local/lib/node_modules/${REA_PACKAGE_SKILL_PATH.join("/")}`,
  `/usr/lib/node_modules/${REA_PACKAGE_SKILL_PATH.join("/")}`,
  `${input.homeDirectory}/.npm-global/lib/node_modules/${REA_PACKAGE_SKILL_PATH.join("/")}`,
];

const npxCacheCandidates = Effect.fn("codeitlab.rea.npxCacheCandidates")(function* (input: {
  readonly homeDirectory: string;
  readonly join: (parts: ReadonlyArray<string>) => string;
}) {
  const fs = yield* FileSystem.FileSystem;
  const cacheDirectory = input.join([input.homeDirectory, ".npm", "_npx"]);
  const entries = yield* fs.readDirectory(cacheDirectory).pipe(Effect.orElseSucceed(() => []));
  return entries
    .filter((entry) => !entry.startsWith("."))
    .map((entry) => input.join([cacheDirectory, entry, "node_modules", ...REA_PACKAGE_SKILL_PATH]));
});

export interface ResolvedReaSkill {
  readonly content: string;
  readonly sourcePath: string | null;
  readonly bundled: boolean;
}

export const resolveReaSkillContent = Effect.fn("codeitlab.rea.resolveSkill")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const environment = yield* HostProcess.Environment;
  const homeDirectory = yield* HostProcess.HomeDirectory;
  const workingDirectory = yield* HostProcess.WorkingDirectory;

  const explicit = environment.CODEITLAB_REA_SKILL_SOURCE?.trim();
  const cached = yield* npxCacheCandidates({
    homeDirectory,
    join: (parts) => path.join(...parts),
  });
  const allCandidates = [
    ...(explicit ? [explicit] : []),
    ...reaSkillSourceCandidates({ homeDirectory, workingDirectory }),
    ...cached,
  ];

  for (const candidate of allCandidates) {
    const exists = yield* fs.exists(candidate).pipe(Effect.orElseSucceed(() => false));
    if (!exists) continue;
    const content = yield* fs.readFileString(candidate).pipe(Effect.orElseSucceed(() => ""));
    if (content.trim().length === 0) continue;
    return { content, sourcePath: candidate, bundled: false } satisfies ResolvedReaSkill;
  }

  return {
    content: FALLBACK_REA_SKILL,
    sourcePath: null,
    bundled: true,
  } satisfies ResolvedReaSkill;
});

export interface EnsureReaSkillResult {
  readonly skillPath: string;
  readonly installed: boolean;
  readonly sourcePath: string | null;
  readonly bundled: boolean;
}

export const ensureReaSkill = Effect.fn("codeitlab.rea.ensureSkill")(function* (input: {
  readonly stateDir: string;
}) {
  const path = yield* Path.Path;
  const paths = reaSkillPaths(input.stateDir, (parts) => path.join(...parts));
  const resolved = yield* resolveReaSkillContent();
  yield* writeFileStringAtomically({ filePath: paths.skillPath, contents: resolved.content });
  const seededAt = DateTime.formatIso(DateTime.makeUnsafe(yield* Clock.currentTimeMillis));
  const metaPath = path.join(paths.skillDirectory, "source.json");
  const meta = [
    "{",
    `  "name": "${REA_SKILL_NAME}",`,
    `  "bundled": ${resolved.bundled},`,
    `  "sourcePath": ${resolved.sourcePath === null ? "null" : `"${resolved.sourcePath.replaceAll("\\", "\\\\")}"`},`,
    `  "seededAt": "${seededAt}"`,
    "}",
    "",
  ].join("\n");
  yield* writeFileStringAtomically({
    filePath: metaPath,
    contents: meta,
  }).pipe(Effect.orElseSucceed(() => undefined));
  return {
    skillPath: paths.skillPath,
    installed: true,
    sourcePath: resolved.sourcePath,
    bundled: resolved.bundled,
  } satisfies EnsureReaSkillResult;
});
