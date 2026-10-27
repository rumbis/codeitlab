import { CodeItLabServiceError } from "@codeitlab/core";
import type { CodeItLabEcosystemSettings } from "@codeitlab/core/ecosystem";
import { ECOSYSTEM_ATTRIBUTION, graftInstructionLine } from "@codeitlab/core/ecosystem";
import {
  EcosystemService as EcosystemServiceTag,
  type CodeItLabEcosystemInstallResult,
  type CodeItLabEcosystemIntegration,
  type CodeItLabEcosystemStatus,
} from "@codeitlab/core/services";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import { writeFileStringAtomically } from "@codeitlab/shared/atomicWrite";

import * as ProcessRunner from "../../processRunner.ts";
import * as ServerConfig from "../../config.ts";
import * as ServerSettings from "../../serverSettings.ts";

const encodeJsonUnknown = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

/**
 * Ecosystem integrations: Graft (repo context graph MCP server), Ponytail and
 * Caveman/terse (instruction packs).
 *
 * Activation is server policy: `install` seeds everything CodeItLab needs on
 * disk — the Graft MCP registration, the vendored skills, and the rendered pack
 * text — under the app-managed state directory, where the Nexus catalog already
 * ingests `<stateDir>/codeitlab/{skills,mcp}`. Nothing is written to another
 * harness's config, and a missing `graft` binary is a warning, never a crash.
 */

const STATUS_TTL_MS = 60_000;
const PROBE_TIMEOUT = "10 seconds";

const SKILL_FILES = {
  graft: "graft",
  ponytail: "ponytail",
  terse: "caveman",
} as const;

const GRAFT_SKILL = `# Graft — repo context graph

Graft indexes a repository as linked markdown cards with exact \`file:line\` spans and serves them
over MCP, so you can ask about the repo instead of reading all of it.

## When to use it

Only when the repository root contains a \`graft/\` directory. Without an index the MCP tools return
nothing useful; check \`graft_check_freshness\` first when the graph may be stale.

## Tools

- \`graft_repo_map\` — the repo's shape: directories, key files, entry points.
- \`graft_find_code\` — find definitions/usages by name or concept.
- \`graft_trace_calls\` — callers and callees around a symbol.
- \`graft_file_api\` — one file's public surface.
- \`graft_find_all\` — every match for a query across the graph.
- \`graft_check_freshness\` — is the graph stale relative to the working tree?

## CLI fallback

\`graft build [dir]\` (index, \`$0\`), \`graft ask "<question>" [dir]\`, \`graft skeleton <file> [dir]\`,
\`graft check [dir]\`. Prefer the MCP tools inside a session.

${ECOSYSTEM_ATTRIBUTION.graft}
`;

const PONYTAIL_SKILL = `# Ponytail — minimal-change engineering policy

Vendored from Ponytail v5.1.1 (${ECOSYSTEM_ATTRIBUTION.ponytail}). CodeItLab renders the ruleset
into each turn; these are the rules in long form.

## Modes

- \`off\` — disabled.
- \`lite\` — smallest complete change, one-line intent before writing.
- \`full\` (default) — plus no unrequested abstractions, scope check, no unrequested tests/docs.
- \`ultra\` — one concern per response, zero new files unless unavoidable.

## Rules

1. Make the smallest complete change that satisfies the request.
2. No unrequested abstractions, options, flags, or helper layers.
3. Scope check before writing: name the files you will touch.
4. Prefer editing existing code over adding files; prefer deleting over commenting out.
5. Match the surrounding style instead of importing your own.
6. End with one line: what you skipped and the risk of skipping it.

The closing risk line is never removed by another pack.
`;

const CAVEMAN_SKILL = `# Caveman — terse communication

Vendored from the user's Hermes \`caveman-lite\` pre-LLM hook (${ECOSYSTEM_ATTRIBUTION.terse}).
CodeItLab renders it server-side, so there is no per-turn subprocess.

## Rules

- Answer first, no preamble, no restating the question, no closing summary.
- Short words, short sentences (~20 words max), one idea per sentence.
- Quote payloads, errors, and file paths verbatim.
- Report tool runs as one bounded line each.
- Never perform the style; the content is plain English, compressed.
- Auto-clarity exceptions: security warnings, irreversible actions, step order, and user confusion
  get plain prose, then resume.
- Stop on "stop caveman", "normal mode", or "stop terse".
`;

const skillBody = (id: keyof typeof SKILL_FILES): string => {
  switch (id) {
    case "graft":
      return GRAFT_SKILL;
    case "ponytail":
      return PONYTAIL_SKILL;
    case "terse":
      return CAVEMAN_SKILL;
  }
};

const integrationDetail = (
  id: "graft" | "ponytail" | "terse",
  settings: CodeItLabEcosystemSettings,
  graftVersion: string | undefined,
): string => {
  if (id === "graft") {
    if (!settings.graft.enabled || settings.graft.mode === "off") return "Disabled in settings.";
    return graftVersion === undefined
      ? "Not installed: the `graft` binary was not found on the server PATH."
      : `graft ${graftVersion} — registers \`graft mcp\` for git projects; the graph is built on demand.`;
  }
  if (id === "ponytail") {
    if (!settings.ponytail.enabled) return "Disabled in settings.";
    return `Instruction pack rendered into every turn (mode: ${settings.ponytail.mode}).`;
  }
  if (!settings.terse.enabled) {
    return 'Disabled in settings. Enable it or say "normal mode" in a thread to turn it off.';
  }
  return `Terseness pack rendered after Ponytail (mode: ${settings.terse.mode}).`;
};

export const make = Effect.fn("codeitlab.ecosystem.service.make")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const settings = yield* ServerSettings.ServerSettingsService;
  const processRunner = yield* ProcessRunner.ProcessRunner;

  const stateDir = config.stateDir;
  const skillsDirectory = path.join(stateDir, "codeitlab", "skills");
  const mcpDirectory = path.join(stateDir, "codeitlab", "mcp");
  const mcpConfigPath = path.join(mcpDirectory, "ecosystem.json");

  const writeAtomic = (filePath: string, contents: string) =>
    writeFileStringAtomically({ filePath, contents }).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
    );

  const statusCache = yield* Ref.make<
    { readonly status: CodeItLabEcosystemStatus; readonly atMs: number } | undefined
  >(undefined);

  const readSettings: Effect.Effect<CodeItLabEcosystemSettings> = settings.getSettings.pipe(
    Effect.map((current) => current.codeitlab.ecosystem),
    Effect.catch((cause) =>
      Effect.logWarning("Falling back to default ecosystem settings.", { cause }).pipe(
        Effect.as({
          graft: {
            enabled: true,
            mode: "auto" as const,
            deep: false,
            maxBuildMinutes: 10,
            freshnessTtlMins: 60,
            autoFileThreshold: 200,
            excludeGlobs: ["node_modules/**", ".git/**", "dist/**", "build/**"],
            mcpCommand: "graft",
            mcpArgs: ["mcp"],
            telemetryOff: true,
          },
          ponytail: {
            enabled: true,
            mode: "full" as const,
            commandsEnabled: true,
            attribution: true,
          },
          terse: { enabled: false, mode: "lite" as const, autoDetect: true },
        } satisfies CodeItLabEcosystemSettings),
      ),
    ),
  );

  const probeGraftVersion = Effect.fn("codeitlab.ecosystem.probeGraftVersion")(function* (
    ecosystem: CodeItLabEcosystemSettings,
  ) {
    if (!ecosystem.graft.enabled || ecosystem.graft.mode === "off") return undefined;
    const result = yield* processRunner
      .run({
        command: ecosystem.graft.mcpCommand,
        args: ["--version"],
        timeout: PROBE_TIMEOUT,
        maxOutputBytes: 64 * 1024,
        outputMode: "truncate",
      })
      .pipe(Effect.option);
    if (result._tag === "None" || result.value.code !== 0) return undefined;
    const match = result.value.stdout.match(/\b(\d+\.\d+\.\d+(?:[-+][\w.]+)?)\b/u);
    return match?.[1];
  });

  const buildStatus = (
    ecosystem: CodeItLabEcosystemSettings,
    graftVersion: string | undefined,
  ): CodeItLabEcosystemStatus => {
    const warnings: Array<string> = [];
    if (ecosystem.graft.enabled && ecosystem.graft.mode !== "off" && graftVersion === undefined) {
      warnings.push(
        "Graft is enabled but the `graft` binary was not found. Install `@nanonets/graft` or set the binary path in settings.",
      );
    }
    const integrations: ReadonlyArray<CodeItLabEcosystemIntegration> = [
      {
        id: "graft",
        name: "Graft",
        kind: "mcp",
        enabled: ecosystem.graft.enabled && ecosystem.graft.mode !== "off",
        mode: ecosystem.graft.mode,
        ...(graftVersion === undefined ? {} : { version: graftVersion }),
        available: graftVersion !== undefined,
        detail: integrationDetail("graft", ecosystem, graftVersion),
        warnings: graftVersion === undefined && ecosystem.graft.enabled ? [...warnings] : [],
      },
      {
        id: "ponytail",
        name: "Ponytail",
        kind: "policy-pack",
        enabled: ecosystem.ponytail.enabled,
        mode: ecosystem.ponytail.mode,
        version: "5.1.1",
        available: true,
        detail: integrationDetail("ponytail", ecosystem, graftVersion),
        warnings: [],
      },
      {
        id: "terse",
        name: "Caveman (terse)",
        kind: "policy-pack",
        enabled: ecosystem.terse.enabled,
        mode: ecosystem.terse.mode,
        version: "1.0.0",
        available: true,
        detail: integrationDetail("terse", ecosystem, graftVersion),
        warnings: [],
      },
    ];
    return {
      integrations,
      generatedAt: DateTime.formatIso(DateTime.nowUnsafe()),
      warnings,
    };
  };

  const status: EcosystemServiceTag["Service"]["status"] = Effect.gen(function* () {
    const now = DateTime.nowUnsafe();
    const cached = yield* Ref.get(statusCache);
    if (cached !== undefined && DateTime.toEpochMillis(now) - cached.atMs < STATUS_TTL_MS) {
      return cached.status;
    }
    const ecosystem = yield* readSettings;
    const graftVersion = yield* probeGraftVersion(ecosystem);
    const next = buildStatus(ecosystem, graftVersion);
    yield* Ref.set(statusCache, { status: next, atMs: DateTime.toEpochMillis(now) });
    return next;
  }).pipe(
    Effect.mapError(
      (cause) =>
        new CodeItLabServiceError({
          operation: "ecosystem.status",
          message: "Could not read the ecosystem integration status.",
          cause,
        }),
    ),
  );

  const install: EcosystemServiceTag["Service"]["install"] = Effect.gen(function* () {
    const ecosystem = yield* readSettings;
    const written: Array<string> = [];

    yield* fs.makeDirectory(skillsDirectory, { recursive: true });
    yield* fs.makeDirectory(mcpDirectory, { recursive: true });

    for (const id of ["graft", "ponytail", "terse"] as const) {
      const enabled =
        id === "graft"
          ? ecosystem.graft.enabled && ecosystem.graft.mode !== "off"
          : id === "ponytail"
            ? ecosystem.ponytail.enabled
            : ecosystem.terse.enabled;
      if (!enabled) continue;
      const directory = path.join(skillsDirectory, SKILL_FILES[id]);
      yield* fs.makeDirectory(directory, { recursive: true });
      const skillPath = path.join(directory, "SKILL.md");
      yield* writeAtomic(skillPath, skillBody(id));
      written.push(skillPath);
    }

    if (ecosystem.graft.enabled && ecosystem.graft.mode !== "off") {
      const registration = {
        mcpServers: {
          graft: {
            command: ecosystem.graft.mcpCommand,
            args: ecosystem.graft.mcpArgs,
            env: ecosystem.graft.telemetryOff ? { DO_NOT_TRACK: "1" } : {},
            transport: "stdio",
            source: "codeitlab-ecosystem",
            version: "0.21.1",
          },
        },
      };
      const encoded = yield* encodeJsonUnknown(registration);
      yield* writeAtomic(mcpConfigPath, `${encoded}\n`);
      written.push(mcpConfigPath);
    }

    const graftVersion = yield* probeGraftVersion(ecosystem);
    yield* Ref.set(statusCache, {
      status: buildStatus(ecosystem, graftVersion),
      atMs: DateTime.toEpochMillis(DateTime.nowUnsafe()),
    });
    const current = yield* Ref.get(statusCache);
    const result: CodeItLabEcosystemInstallResult = {
      status: current?.status ?? buildStatus(ecosystem, graftVersion),
      written,
    };
    return result;
  }).pipe(
    Effect.mapError(
      (cause) =>
        new CodeItLabServiceError({
          operation: "ecosystem.install",
          message: "Could not install the ecosystem integrations.",
          cause,
        }),
    ),
  );

  return { status, install } satisfies EcosystemServiceTag["Service"];
});

export const layer = Layer.effect(EcosystemServiceTag, make());

/** One appContext line for a turn when a Graft graph may exist. */
export const graftTurnLine = (ecosystem: CodeItLabEcosystemSettings): string =>
  ecosystem.graft.enabled && ecosystem.graft.mode !== "off" ? graftInstructionLine() : "";
