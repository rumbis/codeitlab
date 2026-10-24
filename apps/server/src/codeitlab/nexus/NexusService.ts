import * as NodeOS from "node:os";

import { CodeitlabServiceError, NexusCatalog, NexusService } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import { runSshCommand } from "@t3tools/ssh/command";

import { ServerConfig } from "../../config.ts";
import { ProviderInstanceRegistry } from "../../provider/ProviderInstanceRegistry.ts";
import { ProviderRegistry } from "../../provider/ProviderRegistry.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { buildNexusCatalog } from "./catalog.ts";
import type { RemoteCommandRunner } from "./remote.ts";

const decodeCatalog = Schema.decodeUnknownOption(NexusCatalog);

export type NexusServiceEnv =
  | ServerConfig
  | ServerSettingsService
  | ProviderRegistry
  | ProviderInstanceRegistry
  | FileSystem.FileSystem
  | Path.Path
  | ChildProcessSpawner.ChildProcessSpawner;

interface CachedCatalog {
  readonly catalog: NexusCatalog;
  readonly generatedAtMs: number;
}

const causeMessage = (cause: Cause.Cause<unknown>): string => {
  const squashed = Cause.squash(cause);
  return squashed instanceof Error ? squashed.message : String(squashed);
};

/**
 * Live Nexus catalog. The catalog is a cache over read-only harness state, so
 * a stale copy is always better than a failed RPC: refresh failures keep the
 * last good catalog and surface the reason as a warning entry.
 */
export const make = Effect.fn("NexusService.make")(function* () {
  const config = yield* ServerConfig;
  const settingsService = yield* ServerSettingsService;
  const providerRegistry = yield* ProviderRegistry;
  const instanceRegistry = yield* ProviderInstanceRegistry;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const catalogPath = path.join(config.stateDir, "codeitlab", "nexus", "catalog.json");
  // Captured once so the remote runner effect needs no environment of its own.
  const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const fileSystemService = yield* FileSystem.FileSystem;
  const pathService = yield* Path.Path;
  const cache = yield* Ref.make<CachedCatalog | undefined>(undefined);

  const readCachedCatalog = Effect.gen(function* () {
    const contents = yield* fs
      .readFileString(catalogPath)
      .pipe(Effect.orElseSucceed(() => undefined));
    if (contents === undefined) return undefined;
    const decoded = decodeCatalog(
      (() => {
        try {
          return JSON.parse(contents);
        } catch {
          return undefined;
        }
      })(),
    );
    return decoded._tag === "Some" ? decoded.value : undefined;
  });

  const persistCatalog = (catalog: NexusCatalog) =>
    writeFileStringAtomically({
      filePath: catalogPath,
      contents: `${JSON.stringify(catalog, null, 2)}\n`,
    }).pipe(
      Effect.orElseSucceed(() => undefined),
      Effect.asVoid,
    );

  const listAcpSessions = Effect.gen(function* () {
    const instances = yield* instanceRegistry.listInstances;
    const generatedAt = DateTime.formatIso(DateTime.nowUnsafe());
    const sessions: Array<{
      readonly id: string;
      readonly providerInstanceId: string;
      readonly providerKind: string;
      readonly title: string;
      readonly updatedAt: string;
      readonly cwd?: string;
      readonly threadId?: string;
      readonly remote: boolean;
    }> = [];
    const warnings: Array<string> = [];
    yield* Effect.forEach(
      instances,
      (instance) => {
        const management = instance.acpSessionManagement;
        if (management === undefined) return Effect.void;
        return management.listSessions({ cwd: config.cwd }).pipe(
          Effect.map((result) => {
            for (const session of result.sessions) {
              sessions.push({
                id: session.sessionId,
                providerInstanceId: instance.instanceId,
                providerKind: instance.driverKind,
                title: session.title ?? `${instance.driverKind} session`,
                updatedAt: session.updatedAt ?? generatedAt,
                cwd: session.cwd,
                ...(session.importedThreadId === null
                  ? {}
                  : { threadId: session.importedThreadId }),
                remote: false,
              });
            }
          }),
          Effect.catchCause((cause) =>
            Effect.sync(() => {
              warnings.push(
                `ACP session listing failed for '${instance.instanceId}': ${causeMessage(cause)}`,
              );
            }),
          ),
        );
      },
      { concurrency: 4, discard: true },
    );
    return { sessions, warnings };
  });

  const remoteRunner: RemoteCommandRunner = (input) =>
    runSshCommand(
      { alias: input.host, hostname: input.host, username: null, port: null },
      {
        // The script goes over stdin so no remote shell quoting is involved;
        // `tailscale` transports are tailnet hostnames reached through ssh.
        remoteCommandArgs: ["sh", "-s"],
        stdin: input.command,
        timeoutMs: input.timeoutMs ?? 20_000,
      },
    ).pipe(
      Effect.mapError((cause) => ({
        message: cause instanceof Error ? cause.message : "SSH command failed.",
      })),
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, childProcessSpawner),
      Effect.provideService(FileSystem.FileSystem, fileSystemService),
      Effect.provideService(Path.Path, pathService),
    );

  const buildCatalog = Effect.gen(function* () {
    const settings = yield* settingsService.getSettings;
    const nexusSettings = settings.codeitlab.nexus;
    const providers = yield* providerRegistry.getProviders;
    const acp = nexusSettings.includeSessions
      ? yield* listAcpSessions
      : { sessions: [], warnings: [] as ReadonlyArray<string> };
    const generatedAt = DateTime.formatIso(DateTime.nowUnsafe());
    const catalog = yield* buildNexusCatalog({
      generatedAt,
      homeDir: NodeOS.homedir(),
      appSkillsDir: path.join(config.stateDir, "codeitlab", "skills"),
      appMcpDir: path.join(config.stateDir, "codeitlab", "mcp"),
      settings: nexusSettings,
      providers,
      acpSessions: acp.sessions,
      customAcpAgents: nexusSettings.customAcpAgents,
      remoteRunner,
    });
    const withWarnings = {
      ...catalog,
      warnings: [...new Set([...catalog.warnings, ...acp.warnings])],
    };
    yield* persistCatalog(withWarnings);
    const nowMs = yield* Clock.currentTimeMillis;
    yield* Ref.set(cache, {
      catalog: withWarnings,
      generatedAtMs: nowMs,
    });
    return withWarnings;
  }).pipe(Effect.provideService(FileSystem.FileSystem, fs), Effect.provideService(Path.Path, path));

  const withFailure = <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    operation: string,
  ): Effect.Effect<A, CodeitlabServiceError, R> =>
    effect.pipe(
      Effect.catchCause((cause) =>
        Effect.fail(
          new CodeitlabServiceError({
            operation,
            message: `Nexus ${operation} failed: ${causeMessage(cause)}`,
            cause,
          }),
        ),
      ),
    );

  const refresh = withFailure(buildCatalog, "nexus.refresh");

  const catalog = Effect.gen(function* () {
    const settings = yield* settingsService.getSettings;
    const intervalMs = Math.max(1, settings.codeitlab.nexus.refreshIntervalMins) * 60_000;
    const nowMs = yield* Clock.currentTimeMillis;
    const cached = yield* Ref.get(cache);
    if (cached !== undefined && nowMs - cached.generatedAtMs < intervalMs) {
      return cached.catalog;
    }
    const fromDisk = cached === undefined ? yield* readCachedCatalog : undefined;
    if (fromDisk !== undefined) {
      const age = nowMs - Date.parse(fromDisk.generatedAt);
      if (Number.isFinite(age) && age >= 0 && age < intervalMs) {
        yield* Ref.set(cache, { catalog: fromDisk, generatedAtMs: nowMs - age });
        return fromDisk;
      }
    }
    return yield* buildCatalog;
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.fail(
        new CodeitlabServiceError({
          operation: "nexus.catalog",
          message: `Nexus nexus.catalog failed: ${causeMessage(cause)}`,
          cause,
        }),
      ),
    ),
  );

  return NexusService.of({ catalog, refresh });
});

export const layer = Layer.effect(NexusService, make());
