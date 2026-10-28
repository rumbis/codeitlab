// @effect-diagnostics globalTimers:off -- version/SSH probes own their timeout through Effect.
// @effect-diagnostics preferSchemaOverJson:off -- the CLI prints one stable JSON document; JSON.stringify keeps it pretty-printed and key-ordered.
import {
  DEFAULT_SERVER_SETTINGS,
  NexusCatalog,
  ProviderInstanceId,
  resolveProjectProviderInstanceEnabled,
  ServerSettings,
  type CodeItLabCustomAcpAgent,
  type ServerSettings as ServerSettingsType,
} from "@codeitlab/contracts";
import * as HostProcess from "@codeitlab/shared/HostProcess";
import { isCommandAvailable } from "@codeitlab/shared/shell";
import * as Console from "effect/Console";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { Argument, Command, Flag } from "effect/cli";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import { resolveBaseDir } from "../os-jank.ts";
import { baseDirFlag } from "./config.ts";

const LIST_JSON_SCHEMA_VERSION = 1;
const VERSION_PROBE_TIMEOUT = "2 seconds";
const SSH_PROBE_TIMEOUT = "6 seconds";

export type HarnessTransport = "local" | "ssh" | "tailscale";

export interface HarnessCapabilities {
  readonly skills: boolean;
  readonly sessions: boolean;
  readonly mcp: boolean;
  readonly acp: boolean;
  readonly streaming: boolean;
}

export interface HarnessCounts {
  readonly skills: number;
  readonly sessions: number;
  readonly mcpServers: number;
}

/** How availability can be checked for one row; `none` means catalog data only. */
type HarnessProbe =
  | { readonly kind: "binary"; readonly command: string; readonly versionProbe: boolean }
  | { readonly kind: "remote"; readonly host: string }
  | { readonly kind: "none" };

export interface HarnessRow {
  readonly id: string;
  readonly name: string;
  readonly driver: string;
  readonly transport: HarnessTransport;
  readonly enabled: boolean;
  /** `null` means the local probe could not decide (for example a remote host in `list`). */
  readonly available: boolean | null;
  readonly version: string | null;
  readonly capabilities: HarnessCapabilities;
  readonly counts: HarnessCounts;
  readonly detail?: string;
  readonly host?: string;
  readonly probe: HarnessProbe;
}

export interface HarnessInventory {
  readonly rows: ReadonlyArray<HarnessRow>;
  readonly settings: ServerSettingsType;
  readonly stateDir: string;
  readonly baseDir: string;
  readonly catalogGeneratedAt: string | null;
  readonly notes: ReadonlyArray<string>;
}

/**
 * FALLBACK capability matrix. The Nexus catalog records what each harness
 * *has* (skills/sessions counts, availability, transport, failure detail); it
 * does not model protocol capabilities. This is the single fallback table for
 * those flags, keyed by the driver kinds registered in
 * `apps/server/src/provider/builtInDrivers.ts` plus the ACP flavors. When a
 * catalog row reports observed skills or sessions, the observation wins.
 */
const DRIVER_FALLBACK: Readonly<
  Record<string, { readonly binary?: string; readonly capabilities: HarnessCapabilities }>
> = {
  claudeAgent: {
    binary: "claude",
    capabilities: { skills: true, sessions: true, mcp: true, acp: false, streaming: true },
  },
  codex: {
    binary: "codex",
    capabilities: { skills: true, sessions: false, mcp: true, acp: false, streaming: true },
  },
  cursor: {
    binary: "cursor-agent",
    capabilities: { skills: true, sessions: false, mcp: false, acp: false, streaming: true },
  },
  grok: {
    binary: "grok",
    capabilities: { skills: false, sessions: false, mcp: false, acp: false, streaming: true },
  },
  opencode: {
    binary: "opencode",
    capabilities: { skills: true, sessions: false, mcp: true, acp: false, streaming: true },
  },
  antigravity: {
    capabilities: { skills: true, sessions: false, mcp: false, acp: false, streaming: true },
  },
  pi: {
    binary: "pi",
    capabilities: { skills: false, sessions: false, mcp: false, acp: false, streaming: true },
  },
  muse: {
    binary: "muse",
    capabilities: { skills: false, sessions: false, mcp: false, acp: false, streaming: true },
  },
  hermes: {
    binary: "hermes",
    capabilities: { skills: true, sessions: true, mcp: true, acp: true, streaming: true },
  },
  acpRegistry: {
    capabilities: { skills: true, sessions: true, mcp: true, acp: true, streaming: true },
  },
  customAcp: {
    capabilities: { skills: false, sessions: true, mcp: true, acp: true, streaming: true },
  },
};

/** ACP-protocol drivers; CodeItLab spawns these through the ACP runtime. */
const ACP_DRIVER_KINDS: ReadonlySet<string> = new Set(["acpRegistry", "hermes", "customAcp"]);

const EMPTY_CAPABILITIES: HarnessCapabilities = {
  skills: false,
  sessions: false,
  mcp: false,
  acp: false,
  streaming: true,
};

export const capabilitiesForHarness = (
  driver: string,
  counts: HarnessCounts,
): HarnessCapabilities => {
  const fallback = DRIVER_FALLBACK[driver]?.capabilities ?? EMPTY_CAPABILITIES;
  return {
    skills: fallback.skills || counts.skills > 0,
    sessions: fallback.sessions || counts.sessions > 0 || ACP_DRIVER_KINDS.has(driver),
    mcp: fallback.mcp,
    acp: ACP_DRIVER_KINDS.has(driver),
    // Every provider adapter streams turn events; the registry rejects adapters
    // that do not, so this is structural, not a per-harness probe.
    streaming: true,
  };
};

const isHarnessTransport = (value: unknown): value is HarnessTransport =>
  value === "local" || value === "ssh" || value === "tailscale";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const readConfigString = (config: unknown, key: string): string | undefined => {
  if (!isRecord(config)) return undefined;
  const value = config[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
};

const readConfigBoolean = (config: unknown, key: string): boolean | undefined => {
  if (!isRecord(config)) return undefined;
  const value = config[key];
  return typeof value === "boolean" ? value : undefined;
};

const readConfigArgs = (config: unknown, key: string): ReadonlyArray<string> => {
  if (!isRecord(config)) return [];
  const value = config[key];
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
};

const providerConfig = (settings: ServerSettingsType, instanceId: string): unknown =>
  settings.providerInstances[ProviderInstanceId.make(instanceId)]?.config;

const customAgentById = (
  settings: ServerSettingsType,
  id: string,
): CodeItLabCustomAcpAgent | undefined =>
  settings.codeitlab.nexus.customAcpAgents.find((agent) => agent.id === id);

const isEnabledInstance = (settings: ServerSettingsType, instanceId: string): boolean =>
  resolveProjectProviderInstanceEnabled(settings, null, ProviderInstanceId.make(instanceId));

export interface HarnessRowSources {
  readonly catalog: NexusCatalog | undefined;
  readonly settings: ServerSettingsType;
}

/**
 * Pure row assembly from the two persisted sources: the Nexus catalog written
 * by `NexusService` and `settings.json`. Availability that needs a live probe is
 * filled in later by {@link applyHarnessProbes}; catalog availability is used
 * as-is because the server already probed it.
 */
export const buildHarnessRows = (sources: HarnessRowSources): ReadonlyArray<HarnessRow> => {
  const { catalog, settings } = sources;
  const rows = new Map<string, HarnessRow>();

  for (const provider of catalog?.providers ?? []) {
    const customAgent = customAgentById(settings, provider.instanceId);
    const transport = isHarnessTransport(provider.transport) ? provider.transport : "local";
    const counts: HarnessCounts = {
      skills: provider.skills,
      sessions: provider.sessions,
      mcpServers: provider.mcpServers,
    };
    const probeCommand =
      transport === "local"
        ? (customAgent?.command ??
          binaryForInstance(settings, provider.instanceId, provider.driverKind))
        : undefined;
    const remoteHost = transport === "local" ? undefined : (customAgent?.host ?? undefined);
    rows.set(provider.instanceId, {
      id: provider.instanceId,
      name: customAgent?.name ?? provider.name,
      driver: provider.driverKind,
      transport,
      enabled: customAgent?.enabled ?? isEnabledInstance(settings, provider.instanceId),
      // Remote availability is a reachability question; `list` leaves it open
      // and `doctor` probes it over SSH.
      available: transport === "local" ? provider.available : null,
      version: null,
      capabilities: capabilitiesForHarness(provider.driverKind, counts),
      counts,
      ...(provider.detail === undefined ? {} : { detail: provider.detail }),
      ...(remoteHost === undefined ? {} : { host: remoteHost }),
      probe:
        transport === "local"
          ? probeCommand === undefined
            ? { kind: "none" }
            : { kind: "binary", command: probeCommand, versionProbe: true }
          : remoteHost === undefined
            ? { kind: "none" }
            : { kind: "remote", host: remoteHost },
    });
  }

  for (const agent of settings.codeitlab.nexus.customAcpAgents) {
    if (rows.has(agent.id)) continue;
    const transport = isHarnessTransport(agent.transport) ? agent.transport : "local";
    const counts: HarnessCounts = { skills: 0, sessions: 0, mcpServers: 0 };
    const remoteHost = transport === "local" ? undefined : agent.host;
    rows.set(agent.id, {
      id: agent.id,
      name: agent.name,
      driver: "customAcp",
      transport,
      enabled: agent.enabled,
      available: null,
      version: null,
      capabilities: capabilitiesForHarness("customAcp", counts),
      counts,
      ...(transport === "local"
        ? {}
        : {
            detail: `Remote harness on ${remoteHost ?? "(no host configured)"}; catalog-only until a remote provider host exists.`,
          }),
      ...(remoteHost === undefined ? {} : { host: remoteHost }),
      probe:
        transport === "local"
          ? { kind: "binary", command: agent.command, versionProbe: true }
          : remoteHost === undefined
            ? { kind: "none" }
            : { kind: "remote", host: remoteHost },
    });
  }

  // Settings can carry provider instances the catalog has not refreshed yet.
  for (const [rawId, instance] of Object.entries(settings.providerInstances)) {
    if (rows.has(rawId)) continue;
    const driver = instance.driver;
    const counts: HarnessCounts = { skills: 0, sessions: 0, mcpServers: 0 };
    const command = binaryForInstance(settings, rawId, driver);
    rows.set(rawId, {
      id: rawId,
      name: instance.displayName ?? driver,
      driver,
      transport: "local",
      enabled: isEnabledInstance(settings, rawId),
      available: null,
      version: null,
      capabilities: capabilitiesForHarness(driver, counts),
      counts,
      probe:
        command === undefined ? { kind: "none" } : { kind: "binary", command, versionProbe: true },
    });
  }

  return Array.from(rows.values()).toSorted((left, right) => left.id.localeCompare(right.id));
};

const binaryForInstance = (
  settings: ServerSettingsType,
  instanceId: string,
  driver: string,
): string | undefined => {
  const config = providerConfig(settings, instanceId);
  const configured =
    readConfigString(config, "binaryPath") ?? readConfigString(config, "commandPath");
  if (configured !== undefined) return configured;
  if (driver === "hermes") return DRIVER_FALLBACK.hermes?.binary;
  return DRIVER_FALLBACK[driver]?.binary;
};

/** Probe the local binaries the catalog has no fresh answer for, and versions. */
const applyHarnessProbes = (
  rows: ReadonlyArray<HarnessRow>,
  options: { readonly probeVersions: boolean },
) =>
  Effect.forEach(
    rows,
    (
      row,
    ): Effect.Effect<
      HarnessRow,
      never,
      FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner
    > =>
      Effect.gen(function* () {
        if (row.probe.kind !== "binary") return row;
        const available =
          row.available ??
          (yield* isCommandAvailable(row.probe.command).pipe(Effect.orElseSucceed(() => false)));
        const version =
          options.probeVersions && available && row.probe.versionProbe
            ? yield* probeVersion(row.probe.command)
            : null;
        return { ...row, available, version };
      }),
    { concurrency: 4 },
  );

const probeVersion = Effect.fn("Harness.probeVersion")(function* (command: string) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const output = yield* spawner
    .string(
      ChildProcess.make(command, ["--version"], {
        stdin: "ignore",
        stdout: "pipe",
        stderr: "ignore",
      }),
    )
    .pipe(
      Effect.timeout(VERSION_PROBE_TIMEOUT),
      Effect.orElseSucceed(() => ""),
    );
  const firstLine = output.split(/\r?\n/u)[0]?.trim() ?? "";
  return firstLine.length === 0 ? null : firstLine;
});

interface RemoteProbeResult {
  readonly reachable: boolean;
  readonly detail: string;
}

const probeRemoteHost = Effect.fn("Harness.probeRemoteHost")(function* (host: string) {
  const sshAvailable = yield* isCommandAvailable("ssh").pipe(Effect.orElseSucceed(() => false));
  if (!sshAvailable) {
    return {
      reachable: false,
      detail: "`ssh` was not found on PATH, so the remote harness cannot be reached.",
    } satisfies RemoteProbeResult;
  }
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const exitCode = yield* spawner
    .exitCode(
      ChildProcess.make(
        "ssh",
        [
          "-o",
          "BatchMode=yes",
          "-o",
          "ConnectTimeout=4",
          "-o",
          "StrictHostKeyChecking=yes",
          host,
          "true",
        ],
        { stdin: "ignore", stdout: "ignore", stderr: "ignore" },
      ),
    )
    .pipe(
      Effect.map((code) => Number(code)),
      Effect.timeout(SSH_PROBE_TIMEOUT),
      Effect.orElseSucceed(() => -1),
    );
  return exitCode === 0
    ? { reachable: true, detail: `SSH to ${host} succeeded.` }
    : {
        reachable: false,
        detail: `SSH to ${host} failed (exit ${exitCode}); check the host alias, ssh keys and tailnet membership.`,
      };
});

/** Doctor probes every enabled remote harness over SSH; `list` stays offline. */
export const applyRemoteProbes = (rows: ReadonlyArray<HarnessRow>) =>
  Effect.forEach(
    rows,
    (
      row,
    ): Effect.Effect<
      HarnessRow,
      never,
      FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner
    > =>
      row.probe.kind === "remote"
        ? probeRemoteHost(row.probe.host).pipe(
            Effect.map((result) => {
              const detail = row.enabled && !result.reachable ? result.detail : row.detail;
              return {
                ...row,
                available: result.reachable,
                ...(detail === undefined ? {} : { detail }),
              };
            }),
          )
        : Effect.succeed(row),
    { concurrency: 2 },
  );

const UnknownFromJsonString = Schema.fromJsonString(Schema.Unknown);
const decodeJsonUnknown = Schema.decodeUnknownOption(UnknownFromJsonString);
const decodeServerSettingsJson = Schema.decodeUnknownOption(ServerSettings);
const decodeNexusCatalogJson = Schema.decodeUnknownOption(NexusCatalog);

const readJsonFile = Effect.fn("Harness.readJsonFile")(function* (filePath: string) {
  const fs = yield* FileSystem.FileSystem;
  const exists = yield* fs.exists(filePath).pipe(Effect.orElseSucceed(() => false));
  if (!exists) return undefined;
  const text = yield* fs.readFileString(filePath).pipe(Effect.orElseSucceed(() => undefined));
  if (text === undefined) return undefined;
  const decoded = decodeJsonUnknown(text);
  return Option.isSome(decoded) ? decoded.value : undefined;
});

const readSettings = Effect.fn("Harness.readSettings")(function* (settingsPath: string) {
  const raw = yield* readJsonFile(settingsPath);
  if (raw === undefined)
    return { settings: DEFAULT_SERVER_SETTINGS, note: undefined as string | undefined };
  const decoded = decodeServerSettingsJson(raw);
  return Option.isSome(decoded)
    ? { settings: decoded.value, note: undefined as string | undefined }
    : {
        settings: DEFAULT_SERVER_SETTINGS,
        note: `Could not decode ${settingsPath}; using built-in defaults.`,
      };
});

const readCatalog = Effect.fn("Harness.readCatalog")(function* (catalogPath: string) {
  const raw = yield* readJsonFile(catalogPath);
  if (raw === undefined)
    return {
      catalog: undefined as NexusCatalog | undefined,
      note: undefined as string | undefined,
    };
  const decoded = decodeNexusCatalogJson(raw);
  return Option.isSome(decoded)
    ? { catalog: decoded.value, note: undefined as string | undefined }
    : {
        catalog: undefined,
        note: `Could not decode the Nexus catalog at ${catalogPath}; falling back to settings.`,
      };
});

const pathExists = Effect.fn("Harness.pathExists")(function* (filePath: string) {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.exists(filePath).pipe(Effect.orElseSucceed(() => false));
});

const hasStateLayout = Effect.fn("Harness.hasStateLayout")(function* (directory: string) {
  const path = yield* Path.Path;
  return (
    (yield* pathExists(path.join(directory, "settings.json"))) ||
    (yield* pathExists(path.join(directory, "codeitlab", "nexus", "catalog.json")))
  );
});

/**
 * Resolve the state directory like the server does, but tolerate the dev
 * layout: an explicit `--base-dir` / `CIL_HOME` wins, otherwise `userdata`
 * is preferred and `dev` is used when only that layout has settings/catalog.
 */
const resolveHarnessPaths = Effect.fn("Harness.resolveHarnessPaths")(function* (
  explicitBaseDir: Option.Option<string>,
) {
  const environment = yield* HostProcess.Environment;
  const configured =
    Option.getOrUndefined(explicitBaseDir) ?? environment.CIL_HOME?.trim() ?? undefined;
  const baseDir = yield* resolveBaseDir(configured === "" ? undefined : configured);
  const path = yield* Path.Path;
  const userdata = path.join(baseDir, "userdata");
  const dev = path.join(baseDir, "dev");
  const stateDir =
    configured !== undefined
      ? userdata
      : (yield* hasStateLayout(userdata))
        ? userdata
        : (yield* hasStateLayout(dev))
          ? dev
          : userdata;
  return { baseDir, stateDir };
});

export const loadHarnessInventory = Effect.fn("Harness.loadInventory")(function* (
  explicitBaseDir: Option.Option<string>,
  options: { readonly probeVersions?: boolean } = {},
) {
  const { baseDir, stateDir } = yield* resolveHarnessPaths(explicitBaseDir);
  const path = yield* Path.Path;
  const notes: Array<string> = [];
  const settingsResult = yield* readSettings(path.join(stateDir, "settings.json"));
  if (settingsResult.note !== undefined) notes.push(settingsResult.note);
  const catalogPath = path.join(stateDir, "codeitlab", "nexus", "catalog.json");
  const catalogResult = yield* readCatalog(catalogPath);
  if (catalogResult.note !== undefined) notes.push(catalogResult.note);
  if (catalogResult.catalog === undefined) {
    notes.push(
      `No Nexus catalog at ${catalogPath}. Start the CodeItLab server once (Nexus refresh) to enumerate built-in harnesses; showing settings only.`,
    );
  }
  const built = buildHarnessRows({
    catalog: catalogResult.catalog,
    settings: settingsResult.settings,
  });
  const rows = yield* applyHarnessProbes(built, {
    probeVersions: options.probeVersions ?? false,
  });
  return {
    rows,
    settings: settingsResult.settings,
    baseDir,
    stateDir,
    catalogGeneratedAt: catalogResult.catalog?.generatedAt ?? null,
    notes,
  } satisfies HarnessInventory;
});

const statusOf = (row: HarnessRow): string => {
  if (!row.enabled) return "disabled";
  if (row.available === true) return "available";
  if (row.available === false) return "unavailable";
  return "unknown";
};

const capabilityLabels = (row: HarnessRow): string => {
  const parts: Array<string> = [];
  if (row.capabilities.skills) {
    parts.push(row.counts.skills > 0 ? `skills(${row.counts.skills})` : "skills");
  }
  if (row.capabilities.sessions) {
    parts.push(row.counts.sessions > 0 ? `sessions(${row.counts.sessions})` : "sessions");
  }
  if (row.capabilities.mcp) parts.push("mcp");
  if (row.capabilities.acp) parts.push("acp");
  if (row.capabilities.streaming) parts.push("streaming");
  return parts.length === 0 ? "-" : parts.join(", ");
};

export const formatHarnessTable = (rows: ReadonlyArray<HarnessRow>): string => {
  const headers = [
    "ID",
    "NAME",
    "DRIVER",
    "TRANSPORT",
    "STATUS",
    "VERSION",
    "CAPABILITIES",
  ] as const;
  const cells = rows.map((row) => [
    row.id,
    row.name,
    row.driver,
    row.transport,
    statusOf(row),
    row.version ?? "-",
    capabilityLabels(row),
  ]);
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...cells.map((row) => (row[index] ?? "").length)),
  );
  const formatRow = (row: ReadonlyArray<string>) =>
    row
      .map((cell, index) => (index === row.length - 1 ? cell : cell.padEnd(widths[index] ?? 0)))
      .join("  ")
      .trimEnd();
  return [formatRow(headers), ...cells.map(formatRow)].join("\n");
};

const toHarnessJson = (row: HarnessRow) => ({
  id: row.id,
  name: row.name,
  driver: row.driver,
  transport: row.transport,
  enabled: row.enabled,
  available: row.available,
  status: statusOf(row),
  version: row.version,
  capabilities: {
    skills: row.capabilities.skills,
    sessions: row.capabilities.sessions,
    mcp: row.capabilities.mcp,
    acp: row.capabilities.acp,
    streaming: row.capabilities.streaming,
  },
  counts: {
    skills: row.counts.skills,
    sessions: row.counts.sessions,
    mcpServers: row.counts.mcpServers,
  },
  ...(row.host === undefined ? {} : { host: row.host }),
  ...(row.detail === undefined ? {} : { detail: row.detail }),
});

export const harnessListJson = (inventory: HarnessInventory) => ({
  schemaVersion: LIST_JSON_SCHEMA_VERSION,
  generatedAt: DateTime.formatIso(DateTime.nowUnsafe()),
  catalogGeneratedAt: inventory.catalogGeneratedAt,
  stateDir: inventory.stateDir,
  harnesses: inventory.rows.map(toHarnessJson),
});

interface HarnessDoctorEntry {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly enabled: boolean;
  readonly available: boolean | null;
  readonly reasons: ReadonlyArray<string>;
  readonly next: ReadonlyArray<string>;
}

const doctorEntry = (row: HarnessRow): HarnessDoctorEntry => {
  const reasons: Array<string> = [];
  const next: Array<string> = [];
  if (!row.enabled) {
    reasons.push(row.detail ?? "Disabled in CodeItLab settings.");
  } else if (row.available === false) {
    reasons.push(
      row.detail ??
        (row.probe.kind === "binary"
          ? `\`${row.probe.command}\` was not found on PATH.`
          : `\`${row.name}\` is enabled but not usable.`),
    );
    if (row.transport !== "local") {
      next.push(
        `Check the host alias, ssh keys and tailnet membership for ${row.host ?? "the host"}.`,
      );
    } else if (row.probe.kind === "binary") {
      next.push(
        `Install \`${row.probe.command}\` or set its binary path in Settings → Providers → ${row.name}.`,
      );
    }
  } else if (row.available === null) {
    reasons.push(row.detail ?? "Availability could not be determined.");
  }
  return {
    id: row.id,
    name: row.name,
    status: statusOf(row),
    enabled: row.enabled,
    available: row.available,
    reasons,
    next,
  };
};

export const harnessDoctorReport = (inventory: HarnessInventory) => {
  const entries = inventory.rows.map(doctorEntry);
  const unusable = inventory.rows.filter((row) => row.enabled && row.available === false);
  return {
    ok: unusable.length === 0,
    generatedAt: DateTime.formatIso(DateTime.nowUnsafe()),
    catalogGeneratedAt: inventory.catalogGeneratedAt,
    stateDir: inventory.stateDir,
    notes: [...inventory.notes],
    harnesses: entries,
  };
};

export const formatHarnessDoctor = (inventory: HarnessInventory): string => {
  const report = harnessDoctorReport(inventory);
  const lines: Array<string> = [];
  for (const row of inventory.rows) {
    const entry = report.harnesses.find((candidate) => candidate.id === row.id);
    if (entry === undefined) continue;
    const mark =
      entry.status === "available" ? "ok  " : entry.status === "disabled" ? "off " : "FAIL";
    lines.push(
      `${mark} ${entry.id} (${entry.name}, ${row.driver}, ${row.transport}) — ${entry.status}`,
    );
    for (const reason of entry.reasons) lines.push(`       ${reason}`);
    for (const hint of entry.next) lines.push(`       next: ${hint}`);
  }
  lines.push(
    report.ok ? "All enabled harnesses are usable." : "Some enabled harnesses are not usable.",
  );
  for (const note of inventory.notes) lines.push(`note: ${note}`);
  return lines.join("\n");
};

export class HarnessNotFoundError extends Schema.TaggedError<HarnessNotFoundError>()(
  "HarnessNotFoundError",
  { id: Schema.String, known: Schema.Array(Schema.String) },
) {
  override get message(): string {
    const known = this.known.length === 0 ? "none" : this.known.join(", ");
    return `Unknown harness '${this.id}'. Known harnesses: ${known}.`;
  }
}

export interface CachedAcpRegistryAgent {
  readonly id: string;
  readonly version: string;
  readonly distribution: {
    readonly binary?: Readonly<
      Record<
        string,
        {
          readonly cmd: string;
          readonly args?: ReadonlyArray<string>;
          readonly env?: Readonly<Record<string, string>>;
        }
      >
    >;
    readonly npx?: {
      readonly package: string;
      readonly args?: ReadonlyArray<string>;
      readonly env?: Readonly<Record<string, string>>;
    };
    readonly uvx?: {
      readonly package: string;
      readonly args?: ReadonlyArray<string>;
      readonly env?: Readonly<Record<string, string>>;
    };
  };
}

/** Narrow the cached ACP Registry index the server writes before spawning an agent. */
export const parseCachedAcpRegistry = (
  value: unknown,
): ReadonlyArray<CachedAcpRegistryAgent> | undefined => {
  if (!isRecord(value) || !Array.isArray(value.agents)) return undefined;
  const agents: Array<CachedAcpRegistryAgent> = [];
  for (const candidate of value.agents) {
    if (!isRecord(candidate)) continue;
    const { id, version, distribution } = candidate;
    if (typeof id !== "string" || typeof version !== "string" || !isRecord(distribution)) continue;
    type BinaryEntry = {
      cmd: string;
      args?: ReadonlyArray<string>;
      env?: Readonly<Record<string, string>>;
    };
    const binary: Record<string, BinaryEntry> = {};
    if (isRecord(distribution.binary)) {
      for (const [target, entry] of Object.entries(distribution.binary)) {
        if (!isRecord(entry) || typeof entry.cmd !== "string") continue;
        binary[target] = {
          cmd: entry.cmd,
          ...(Array.isArray(entry.args)
            ? { args: entry.args.filter((arg): arg is string => typeof arg === "string") }
            : {}),
          ...(isRecord(entry.env) ? { env: stringRecord(entry.env) } : {}),
        };
      }
    }
    const packageDistribution = (kind: "npx" | "uvx") => {
      const entry = distribution[kind];
      if (!isRecord(entry) || typeof entry.package !== "string") return undefined;
      return {
        package: entry.package,
        ...(Array.isArray(entry.args)
          ? { args: entry.args.filter((arg): arg is string => typeof arg === "string") }
          : {}),
        ...(isRecord(entry.env) ? { env: stringRecord(entry.env) } : {}),
      };
    };
    const npx = packageDistribution("npx");
    const uvx = packageDistribution("uvx");
    agents.push({
      id,
      version,
      distribution: {
        ...(Object.keys(binary).length > 0 ? { binary } : {}),
        ...(npx === undefined ? {} : { npx }),
        ...(uvx === undefined ? {} : { uvx }),
      },
    });
  }
  return agents;
};

const stringRecord = (value: Record<string, unknown>): Readonly<Record<string, string>> =>
  Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );

export interface AcpInvocation {
  readonly kind: "acp" | "native" | "unknown";
  readonly argv: ReadonlyArray<string>;
  readonly envKeys: ReadonlyArray<string>;
  readonly note?: string;
}

const shellQuote = (value: string): string =>
  /^[A-Za-z0-9_./:=@+-]+$/u.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;

export const formatCommandLine = (argv: ReadonlyArray<string>): string =>
  argv.map(shellQuote).join(" ");

const platformTarget = (
  platform: NodeJS.Platform,
  architecture: NodeJS.Architecture,
): string | undefined => {
  const os =
    platform === "darwin"
      ? "darwin"
      : platform === "linux"
        ? "linux"
        : platform === "win32"
          ? "windows"
          : undefined;
  const arch = architecture === "arm64" ? "aarch64" : architecture === "x64" ? "x86_64" : undefined;
  return os === undefined || arch === undefined ? undefined : `${os}-${arch}`;
};

const resolveDistributionArgs = (
  agent: CachedAcpRegistryAgent,
  preference: string,
  platform: NodeJS.Platform,
  architecture: NodeJS.Architecture,
):
  | {
      readonly kind: string;
      readonly args: ReadonlyArray<string>;
      readonly packageName?: string;
      readonly binaryCmd?: string;
    }
  | undefined => {
  const target = platformTarget(platform, architecture);
  const binary =
    target === undefined ? undefined : (agent.distribution.binary?.[target] ?? undefined);
  const candidates = preference === "auto" ? ["binary", "npx", "uvx"] : [preference];
  for (const kind of candidates) {
    if (kind === "binary" && binary !== undefined) {
      return { kind, args: binary.args ?? [], binaryCmd: binary.cmd };
    }
    if (kind === "npx" && agent.distribution.npx !== undefined) {
      return {
        kind,
        args: agent.distribution.npx.args ?? [],
        packageName: agent.distribution.npx.package,
      };
    }
    if (kind === "uvx" && agent.distribution.uvx !== undefined) {
      return {
        kind,
        args: agent.distribution.uvx.args ?? [],
        packageName: agent.distribution.uvx.package,
      };
    }
  }
  return undefined;
};

export interface ResolveAcpInvocationInput {
  readonly row: HarnessRow;
  readonly settings: ServerSettingsType;
  readonly registryAgents?: ReadonlyArray<CachedAcpRegistryAgent>;
  readonly platform: NodeJS.Platform;
  readonly architecture: NodeJS.Architecture;
}

/**
 * Print the command CodeItLab would spawn, without spawning it. Custom agents
 * (the remote/tailnet debugging case) and Hermes are exact; ACP Registry agents
 * resolve the distribution from the cached registry index and its install
 * receipts; native drivers have no ACP handshake at all.
 */
export const resolveAcpInvocation = (input: ResolveAcpInvocationInput): AcpInvocation => {
  const { row, settings } = input;
  const customAgent = customAgentById(settings, row.id);
  if (customAgent !== undefined) {
    const base = [customAgent.command, ...customAgent.args];
    const envKeys = Object.keys(customAgent.env).toSorted();
    if (customAgent.transport === "local") {
      return {
        kind: "acp",
        argv: base,
        envKeys,
        note: "Local ACP process; CodeItLab spawns this directly.",
      };
    }
    const host = customAgent.host ?? "";
    if (host.trim().length === 0) {
      return {
        kind: "unknown",
        argv: base,
        envKeys,
        note: `Custom ACP agent '${row.id}' has transport '${customAgent.transport}' but no host.`,
      };
    }
    return {
      kind: "acp",
      argv: ["ssh", host, ...base],
      envKeys,
      note: `Remote ACP over ssh (${customAgent.transport}); CodeItLab has no remote provider host yet, so this is the command a future host would run.`,
    };
  }

  const config = providerConfig(settings, row.id);
  if (row.driver === "hermes") {
    const binary =
      readConfigString(config, "binaryPath") ?? DRIVER_FALLBACK.hermes?.binary ?? "hermes";
    const acpSubcommand = readConfigBoolean(config, "acpSubcommand") ?? true;
    const envKeys = Object.keys(
      isRecord(config) && isRecord(config.env) ? stringRecord(config.env) : {},
    ).toSorted();
    return {
      kind: "acp",
      argv: acpSubcommand ? [binary, "acp"] : [binary],
      envKeys,
      note: "Hermes is a local ACP command (`hermes acp` unless the subcommand is disabled).",
    };
  }

  if (row.driver === "acpRegistry") {
    const source = readConfigString(config, "source") ?? "registry";
    const commandPath = readConfigString(config, "commandPath");
    const commandArgs = readConfigArgs(config, "commandArgs");
    const envKeys = Object.keys(
      isRecord(config) && isRecord(config.env) ? stringRecord(config.env) : {},
    ).toSorted();
    if (source === "local") {
      const command = commandPath ?? readConfigString(config, "agentId");
      if (command === undefined) {
        return {
          kind: "unknown",
          argv: [],
          envKeys,
          note: `Provider instance '${row.id}' uses source=local but has no commandPath/agentId in settings.json.`,
        };
      }
      return {
        kind: "acp",
        argv: [command, ...commandArgs],
        envKeys,
        note: "Local ACP command from settings.json (providerInstances config).",
      };
    }
    const agentId = readConfigString(config, "agentId");
    if (agentId === undefined) {
      return {
        kind: "unknown",
        argv: [],
        envKeys,
        note: `Provider instance '${row.id}' uses the ACP Registry but has no agentId in settings.json.`,
      };
    }
    const agent = input.registryAgents?.find((candidate) => candidate.id === agentId);
    if (agent === undefined) {
      return {
        kind: "unknown",
        argv: commandPath === undefined ? [] : [commandPath, ...commandArgs],
        envKeys,
        note: `ACP Registry index is not cached (or has no agent '${agentId}'), so the distribution executable cannot be resolved offline. Start the server once to cache it.`,
      };
    }
    const preference = readConfigString(config, "distribution") ?? "auto";
    const distribution = resolveDistributionArgs(
      agent,
      preference,
      input.platform,
      input.architecture,
    );
    if (distribution === undefined) {
      return {
        kind: "unknown",
        argv: [],
        envKeys,
        note: `ACP Registry agent '${agentId}' has no '${preference}' distribution for ${platformTarget(input.platform, input.architecture) ?? "this platform"}.`,
      };
    }
    const envFromDistribution =
      distribution.kind === "binary"
        ? agent.distribution.binary?.[platformTarget(input.platform, input.architecture) ?? ""]?.env
        : distribution.kind === "npx"
          ? agent.distribution.npx?.env
          : agent.distribution.uvx?.env;
    const mergedEnvKeys = Array.from(
      new Set([...envKeys, ...Object.keys(envFromDistribution ?? {})]),
    ).toSorted();
    if (commandPath !== undefined) {
      return {
        kind: "acp",
        argv: [commandPath, ...distribution.args, ...commandArgs],
        envKeys: mergedEnvKeys,
        note: `Registry agent '${agentId}@${agent.version}' with a command override; args come from the cached registry index.`,
      };
    }
    if (distribution.kind === "binary" && distribution.binaryCmd !== undefined) {
      return {
        kind: "acp",
        argv: [distribution.binaryCmd, ...distribution.args, ...commandArgs],
        envKeys: mergedEnvKeys,
        note: `Registry agent '${agentId}@${agent.version}' binary distribution; CodeItLab installs it under <base-dir>/tools before spawning.`,
      };
    }
    const packageSpec = distribution.packageName ?? agentId;
    const argv =
      distribution.kind === "npx"
        ? ["npx", "--yes", packageSpec, ...distribution.args, ...commandArgs]
        : ["uvx", packageSpec, ...distribution.args, ...commandArgs];
    return {
      kind: "acp",
      argv,
      envKeys: mergedEnvKeys,
      note: `Registry agent '${agentId}@${agent.version}' ${distribution.kind} distribution; CodeItLab installs it once, then spawns the installed executable.`,
    };
  }

  const nativeBinary = binaryForInstance(settings, row.id, row.driver);
  return {
    kind: "native",
    argv: nativeBinary === undefined ? [] : [nativeBinary],
    envKeys: [],
    note: `'${row.driver}' is a native provider driver: CodeItLab spawns it directly, with no ACP handshake and no ACP command line.`,
  };
};

const readCachedRegistry = Effect.fn("Harness.readCachedRegistry")(function* (baseDir: string) {
  const path = yield* Path.Path;
  const raw = yield* readJsonFile(path.join(baseDir, "caches", "acp-registry", "registry.json"));
  return raw === undefined ? [] : (parseCachedAcpRegistry(raw) ?? []);
});

const jsonFlag = Flag.Boolean("json").pipe(
  Flag.withDescription("Print stable JSON instead of a human table."),
  Flag.withDefault(false),
);

const harnessListCommand = Command.make("list", {
  baseDir: baseDirFlag,
  json: jsonFlag,
}).pipe(
  Command.withDescription("List every harness CodeItLab knows about with its capability flags."),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const inventory = yield* loadHarnessInventory(flags.baseDir, { probeVersions: true });
      if (flags.json) {
        yield* Console.log(JSON.stringify(harnessListJson(inventory), null, 2));
      } else {
        yield* Console.log(formatHarnessTable(inventory.rows));
        for (const note of inventory.notes) yield* Console.log(`\nnote: ${note}`);
      }
    }),
  ),
);

const harnessDoctorCommand = Command.make("doctor", {
  baseDir: baseDirFlag,
  json: jsonFlag,
}).pipe(
  Command.withDescription(
    "Explain why harnesses are unavailable; exits 1 when an enabled harness is unusable.",
  ),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const inventory = yield* loadHarnessInventory(flags.baseDir, { probeVersions: false });
      const probed: HarnessInventory = {
        ...inventory,
        rows: yield* applyRemoteProbes(inventory.rows),
      };
      const report = harnessDoctorReport(probed);
      if (flags.json) {
        yield* Console.log(JSON.stringify(report, null, 2));
      } else {
        yield* Console.log(formatHarnessDoctor(probed));
      }
      if (!report.ok) yield* Effect.sync(() => void (process.exitCode = 1));
    }),
  ),
);

const harnessAcpCommand = Command.make("acp", {
  baseDir: baseDirFlag,
  id: Argument.String("id").pipe(
    Argument.withDescription("Harness id from `codeitlab harness list`."),
  ),
}).pipe(
  Command.withDescription(
    "Print the ACP command line CodeItLab would spawn for a harness, without spawning it.",
  ),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const inventory = yield* loadHarnessInventory(flags.baseDir, { probeVersions: false });
      const row = inventory.rows.find((candidate) => candidate.id === flags.id.trim());
      if (row === undefined) {
        return yield* new HarnessNotFoundError({
          id: flags.id.trim(),
          known: inventory.rows.map((candidate) => candidate.id),
        });
      }
      const environment = yield* HostProcess.Environment;
      const platform = yield* HostProcess.Platform;
      const architecture = yield* HostProcess.Architecture;
      const registryAgents = yield* readCachedRegistry(inventory.baseDir);
      const invocation = resolveAcpInvocation({
        row,
        settings: inventory.settings,
        registryAgents,
        platform,
        architecture,
      });
      const lines: Array<string> = [];
      lines.push(
        `Harness: ${row.id} (${row.name}) — driver ${row.driver}, transport ${row.transport}`,
      );
      if (invocation.argv.length === 0) {
        lines.push("Command: (not resolvable)");
      } else {
        lines.push(`Command: ${formatCommandLine(invocation.argv)}`);
      }
      if (invocation.envKeys.length > 0) {
        lines.push(`Env keys: ${invocation.envKeys.join(", ")}`);
      }
      if (invocation.note !== undefined) lines.push(`Note: ${invocation.note}`);
      if (invocation.kind === "native") {
        lines.push("This harness has no ACP command line.");
      }
      if (invocation.kind === "unknown" && row.transport === "local") {
        lines.push(`Current PATH: ${environment.PATH ?? "(unset)"}`);
      }
      yield* Console.log(lines.join("\n"));
    }),
  ),
);

export const harnessCommand = Command.make("harness").pipe(
  Command.withDescription(
    "Enumerate harnesses (local + remote), their capabilities, and the ACP command CodeItLab would run.",
  ),
  Command.withSubcommands([harnessListCommand, harnessDoctorCommand, harnessAcpCommand]),
);
