import { CodeitlabServiceError } from "@codeitlab/core";
import type { ReaCapability, ReaHealthCheck, ReaStatus } from "@codeitlab/core/rea";
import { ReaService as ReaServiceTag } from "@codeitlab/core/services";
import type { CodeitlabReaSettings } from "@codeitlab/core/settings";
import { NexusMcpServer } from "@codeitlab/core/nexus";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";

import * as ProcessRunner from "../../processRunner.ts";
import * as ServerConfig from "../../config.ts";
import * as ServerSettings from "../../serverSettings.ts";
import { reaCliArgs, reaMcpServer, reaServerArgs, REA_MCP_SERVER_ID } from "./mcp.ts";
import { ensureReaSkill, reaSkillPaths } from "./skill.ts";

/**
 * REA health and installation. The CLI is reached through the server's
 * ProcessRunner (no shell interpolation, bounded output, hard timeout), and the
 * result is cached briefly because a probe spawns `npx` twice.
 */

const STATUS_TTL_MS = 60_000;
const PROBE_TIMEOUT = "30 seconds";
const MAX_HEALTH_CHECKS = 24;

const decodeJsonUnknown = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));
const encodeMcpServer = Schema.encodeSync(Schema.fromJsonString(NexusMcpServer));

const asRecord = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;

const readString = (record: Readonly<Record<string, unknown>>, key: string): string | undefined => {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
};

const readBoolean = (
  record: Readonly<Record<string, unknown>>,
  key: string,
): boolean | undefined => {
  const value = record[key];
  return typeof value === "boolean" ? value : undefined;
};

const readNumber = (record: Readonly<Record<string, unknown>>, key: string): number | undefined => {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

const readArray = (
  record: Readonly<Record<string, unknown>>,
  key: string,
): ReadonlyArray<unknown> => {
  const value = record[key];
  return Array.isArray(value) ? value : [];
};

const parseJsonOutput = (stdout: string): unknown => {
  const trimmed = stdout.trim();
  const start = trimmed.search(/[[{]/u);
  if (start < 0) return undefined;
  return Option.getOrUndefined(decodeJsonUnknown(trimmed.slice(start)));
};

export const parseReaVersion = (stdout: string): string | undefined => {
  const match = stdout.match(/\b(\d+\.\d+\.\d+(?:[-+][\w.]+)?)\b/u);
  return match?.[1];
};

const doctorCheckToHealth = (value: unknown, prefix: string): ReaHealthCheck | undefined => {
  const record = asRecord(value);
  if (record === undefined) return undefined;
  const name = readString(record, "name");
  const ok = readBoolean(record, "ok");
  if (name === undefined || ok === undefined) return undefined;
  const classification = readString(record, "classification");
  const detail = readString(record, "detail") ?? classification ?? "";
  const remediation = readString(record, "remediation") ?? "";
  return { name: `${prefix}:${name}`, ok, detail, remediation };
};

export const parseDoctorHealth = (stdout: string): ReadonlyArray<ReaHealthCheck> => {
  const document = asRecord(parseJsonOutput(stdout));
  if (document === undefined) return [];
  return readArray(document, "scope_checks")
    .map((check) => doctorCheckToHealth(check, "doctor"))
    .filter((check): check is ReaHealthCheck => check !== undefined)
    .slice(0, MAX_HEALTH_CHECKS);
};

export const parseMcpDoctorHealth = (stdout: string): ReadonlyArray<ReaHealthCheck> => {
  const document = asRecord(parseJsonOutput(stdout));
  if (document === undefined) return [];
  const checks = readArray(document, "checks")
    .map((check) => doctorCheckToHealth(check, "mcp"))
    .filter((check): check is ReaHealthCheck => check !== undefined);
  const server = asRecord(document["server"]);
  const inventory = asRecord(document["inventory"]);
  const tools = inventory === undefined ? undefined : asRecord(inventory["tools"]);
  const observed = tools === undefined ? undefined : readNumber(tools, "observed");
  const expected = tools === undefined ? undefined : readNumber(tools, "expected");
  const version = server === undefined ? undefined : readString(server, "version");
  if (observed !== undefined) {
    checks.push({
      name: "mcp:inventory",
      ok: expected === undefined || observed === expected,
      detail: `${observed} tools${expected === undefined ? "" : ` (expected ${expected})`}${version === undefined ? "" : `, REA ${version}`}`,
      remediation: "",
    });
  }
  return checks.slice(0, MAX_HEALTH_CHECKS);
};

export const parseCapabilities = (stdout: string): ReadonlyArray<ReaCapability> => {
  const document = asRecord(parseJsonOutput(stdout));
  if (document === undefined) return [];
  const capabilities: ReaCapability[] = [];
  for (const provider of readArray(document, "capabilities")) {
    const record = asRecord(provider);
    if (record === undefined) continue;
    const providerRecord = asRecord(record["provider"]);
    if (providerRecord === undefined) continue;
    const id = readString(providerRecord, "id");
    const name = readString(providerRecord, "name");
    if (id === undefined || name === undefined) continue;
    const sideEffects = new Set<string>();
    for (const group of readArray(record, "groups")) {
      const groupRecord = asRecord(group);
      if (groupRecord === undefined) continue;
      for (const effect of readArray(groupRecord, "effects")) {
        if (typeof effect === "string") sideEffects.add(effect);
      }
    }
    const limitations = readArray(record, "shared_limitations")
      .filter((entry): entry is string => typeof entry === "string")
      .join(" ");
    capabilities.push({
      id,
      title: name,
      description:
        limitations.length > 0
          ? limitations
          : `REA analysis provider '${id}' (operations are listed by \`rea capabilities\`).`,
      sideEffects: [...sideEffects].sort(),
    });
  }
  return capabilities.slice(0, 12);
};

/** Offline fallback so the panel never shows an empty capability list. */
export const FALLBACK_REA_CAPABILITIES: ReadonlyArray<ReaCapability> = [
  {
    id: "application-overview",
    title: "Application overview",
    description:
      "Static overview of an app bundle, directory, asar, or package with an evidence id.",
    sideEffects: [],
  },
  {
    id: "decompile",
    title: "Decompile a function or class",
    description: "Read one part of an app as code, backed by evidence.",
    sideEffects: ["launches_process"],
  },
  {
    id: "compare",
    title: "Compare versions or evidence",
    description: "Compare two canonical evidence bundles or application versions.",
    sideEffects: [],
  },
  {
    id: "capture",
    title: "Capture runtime evidence",
    description:
      "Bounded capture/observe operations for a selected target. Disclose side effects first.",
    sideEffects: ["launches_process", "may_show_ui", "may_write_filesystem"],
  },
  {
    id: "evidence-export",
    title: "Export evidence",
    description: "Validate and export canonical evidence JSON for a reconstruction.",
    sideEffects: ["may_write_filesystem"],
  },
];

export const make = Effect.fn("codeitlab.rea.service.make")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const settings = yield* ServerSettings.ServerSettingsService;
  const processRunner = yield* ProcessRunner.ProcessRunner;

  const stateDir = config.stateDir;
  const mcpConfigDirectory = path.join(stateDir, "codeitlab", "mcp");
  const mcpConfigPath = path.join(mcpConfigDirectory, "rea.json");
  const skillPaths = reaSkillPaths(stateDir, (parts) => path.join(...parts));

  const statusCache = yield* Ref.make<
    { readonly status: ReaStatus; readonly atMs: number } | undefined
  >(undefined);

  const readSettings: Effect.Effect<CodeitlabReaSettings> = settings.getSettings.pipe(
    Effect.map((current) => current.codeitlab.rea),
    Effect.catch((cause) =>
      Effect.logWarning("Falling back to default REA settings.", { cause }).pipe(
        Effect.as({
          enabled: true,
          autoActivate: true,
          mcpCommand: "npx",
          mcpArgs: ["-y", "rea-agents@6.7.0", "--mcp"],
          installSkill: true,
        } satisfies CodeitlabReaSettings),
      ),
    ),
  );

  const runRea = (reaSettings: CodeitlabReaSettings, args: ReadonlyArray<string>) =>
    processRunner.run({
      command: reaSettings.mcpCommand,
      args: [...reaCliArgs(reaSettings), ...args],
      timeout: PROBE_TIMEOUT,
      maxOutputBytes: 512 * 1024,
      outputMode: "truncate",
    });

  const probe = Effect.fn("codeitlab.rea.probe")(function* () {
    const reaSettings = yield* readSettings;
    const health: ReaHealthCheck[] = [];
    let version = "";
    let installed = false;

    const versionResult = yield* runRea(reaSettings, ["--version"]).pipe(Effect.option);
    if (Option.isSome(versionResult)) {
      const parsed = parseReaVersion(versionResult.value.stdout);
      if (parsed !== undefined) {
        version = parsed;
        installed = true;
      }
    }
    health.push(
      installed
        ? {
            name: "rea:cli",
            ok: true,
            detail: `rea ${version} (${reaSettings.mcpCommand})`,
            remediation: "",
          }
        : {
            name: "rea:cli",
            ok: false,
            detail: "REA CLI is not reachable.",
            remediation: `Install Node.js and verify \`${reaSettings.mcpCommand} -y rea-agents@6.7.0 --version\` runs.`,
          },
    );

    if (installed) {
      const doctorResult = yield* runRea(reaSettings, ["doctor", "--format", "json"]).pipe(
        Effect.option,
      );
      const doctorHealth = Option.isSome(doctorResult)
        ? parseDoctorHealth(doctorResult.value.stdout)
        : [];
      if (doctorHealth.length > 0) {
        health.push(...doctorHealth);
      } else {
        health.push({
          name: "doctor",
          ok: false,
          detail: "`rea doctor` did not return a JSON health report.",
          remediation: "Run `npx -y rea-agents@6.7.0 doctor --format json` in a terminal.",
        });
      }

      const mcpDoctorResult = yield* runRea(reaSettings, [
        "mcp",
        "doctor",
        "--format",
        "json",
      ]).pipe(Effect.option);
      const mcpHealth = Option.isSome(mcpDoctorResult)
        ? parseMcpDoctorHealth(mcpDoctorResult.value.stdout)
        : [];
      if (mcpHealth.length > 0) {
        health.push(...mcpHealth);
      } else {
        health.push({
          name: "mcp:startup",
          ok: false,
          detail: "`rea mcp doctor` did not return a JSON report.",
          remediation: "Run `npx -y rea-agents@6.7.0 mcp doctor --format json` in a terminal.",
        });
      }
    }

    const skillExists = yield* fs
      .exists(skillPaths.skillPath)
      .pipe(Effect.orElseSucceed(() => false));
    health.push({
      name: "skill",
      ok: skillExists,
      detail: skillExists ? skillPaths.skillPath : "REA skill is not seeded.",
      remediation: skillExists ? "" : "Call codeitlab.rea.install to seed the skill.",
    });

    const mcpConfigExists = yield* fs.exists(mcpConfigPath).pipe(Effect.orElseSucceed(() => false));
    health.push({
      name: "mcp:registration",
      ok: mcpConfigExists,
      detail: mcpConfigExists ? mcpConfigPath : "App-managed REA MCP registration is missing.",
      remediation: mcpConfigExists ? "" : "Call codeitlab.rea.install to register the MCP server.",
    });

    const checkedAt = DateTime.formatIso(DateTime.makeUnsafe(yield* Clock.currentTimeMillis));
    return {
      installed,
      version,
      mcpCommand: reaSettings.mcpCommand,
      mcpArgs: [...reaServerArgs(reaSettings)],
      mcpServerId: REA_MCP_SERVER_ID,
      skillInstalled: skillExists,
      skillPath: skillPaths.skillPath,
      autoActivate: reaSettings.autoActivate,
      health: health.slice(0, MAX_HEALTH_CHECKS),
      checkedAt,
    } satisfies ReaStatus;
  });

  const refreshStatus = Effect.gen(function* () {
    const status = yield* probe();
    yield* Ref.set(statusCache, {
      status,
      atMs: yield* Clock.currentTimeMillis,
    });
    return status;
  });

  const status = Effect.gen(function* () {
    const cached = yield* Ref.get(statusCache);
    const nowMs = yield* Clock.currentTimeMillis;
    if (cached !== undefined && nowMs - cached.atMs < STATUS_TTL_MS) return cached.status;
    return yield* refreshStatus;
  }).pipe(
    Effect.mapError(
      (cause) =>
        new CodeitlabServiceError({
          operation: "rea.status",
          message: "Failed to read REA status.",
          cause,
        }),
    ),
  );

  const ensureInstalled = Effect.gen(function* () {
    const reaSettings = yield* readSettings;
    if (reaSettings.installSkill) {
      yield* ensureReaSkill({ stateDir }).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, path),
        Effect.mapError(
          (cause) =>
            new CodeitlabServiceError({
              operation: "rea.install",
              message: "Failed to seed the REA skill.",
              cause,
            }),
        ),
      );
    }
    const server = reaMcpServer(reaSettings);
    yield* writeFileStringAtomically({
      filePath: mcpConfigPath,
      contents: `${encodeMcpServer(server)}\n`,
    }).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
      Effect.mapError(
        (cause) =>
          new CodeitlabServiceError({
            operation: "rea.install",
            message: "Failed to write the app-managed REA MCP registration.",
            cause,
          }),
      ),
    );
    return yield* refreshStatus.pipe(
      Effect.mapError(
        (cause) =>
          new CodeitlabServiceError({
            operation: "rea.install",
            message: "REA was installed but its status probe failed.",
            cause,
          }),
      ),
    );
  });

  const capabilities = Effect.gen(function* () {
    const reaSettings = yield* readSettings;
    const result = yield* runRea(reaSettings, ["capabilities", "--format", "json"]).pipe(
      Effect.option,
    );
    const parsed = Option.isSome(result) ? parseCapabilities(result.value.stdout) : [];
    return parsed.length > 0 ? parsed : FALLBACK_REA_CAPABILITIES;
  }).pipe(
    Effect.mapError(
      (cause) =>
        new CodeitlabServiceError({
          operation: "rea.capabilities",
          message: "Failed to read REA capabilities.",
          cause,
        }),
    ),
  );

  return ReaServiceTag.of({ status, ensureInstalled, capabilities });
});

export const layer = Layer.effect(ReaServiceTag, make());

export { reaMcpServer, REA_MCP_SERVER_ID } from "./mcp.ts";
export { reaAutoActivationBlock } from "./instructions.ts";
export { FALLBACK_REA_SKILL, reaSkillPaths, resolveReaSkillContent } from "./skill.ts";
