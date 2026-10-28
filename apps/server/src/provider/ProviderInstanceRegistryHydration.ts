import {
  defaultInstanceIdForDriver,
  providerInstanceConfigEnabledFlag,
  resolveProviderInstanceEnabled,
  type ProviderInstanceConfig,
  type ProviderInstanceConfigMap,
  type ProviderInstanceId,
  ProviderDriverKind,
  ServerSettings,
} from "@codeitlab/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as Settings from "../serverSettings.ts";
import { BUILT_IN_DRIVERS, type BuiltInDriversEnv } from "./builtInDrivers.ts";
import * as ProviderInstanceRegistry from "./ProviderInstanceRegistry.ts";
import * as ProviderInstanceRegistryMutator from "./ProviderInstanceRegistryMutator.ts";
import * as ProviderOrchestrationAdapterInfrastructure from "./ProviderOrchestrationAdapterInfrastructure.ts";
import * as AcpRegistrySupport from "@codeitlab/provider-acp-registry/server/AcpRegistrySupport";
import * as ProviderHostLive from "./ProviderHostLive.ts";
import type * as ProviderHost from "@codeitlab/provider-core/server/ProviderHost";
import type * as BackgroundPolicy from "../background/BackgroundPolicy.ts";
import type * as ServerConfig from "../config.ts";

type ProviderInstanceRegistryHydrationEnv =
  | Exclude<
      BuiltInDriversEnv,
      | ProviderOrchestrationAdapterInfrastructure.ProviderOrchestrationAdapterInfrastructure
      | AcpRegistrySupport.AcpRegistryCatalog
      | ProviderHost.ProviderHost
    >
  | Settings.ServerSettingsService
  | BackgroundPolicy.BackgroundPolicy
  | ServerConfig.ServerConfig;

export const deriveProviderInstanceConfigMap = (
  settings: ServerSettings,
): ProviderInstanceConfigMap => {
  const merged: Record<string, ProviderInstanceConfig> = { ...settings.providerInstances };

  for (const driver of BUILT_IN_DRIVERS) {
    if (driver.metadata.hasDefaultInstance === false) continue;
    const instanceId = defaultInstanceIdForDriver(driver.driverKind);
    if (instanceId in merged) continue;
    merged[instanceId] = { driver: driver.driverKind };
  }

  // CodeItLab custom ACP agents are local ACP commands, so they run through the
  // generic acpRegistry driver. Remote (ssh/tailscale) agents are catalog-only
  // until a remote provider host exists, and an explicit providerInstances entry
  // always wins over this derivation.
  for (const agent of settings.codeitlab.nexus.customAcpAgents) {
    if (!agent.enabled || agent.transport !== "local") continue;
    const instanceId = agent.id.trim();
    if (instanceId.length === 0 || instanceId in merged) continue;
    merged[instanceId] = {
      driver: ProviderDriverKind.make("acpRegistry"),
      config: {
        source: "local",
        agentId: instanceId,
        commandPath: agent.command,
        commandArgs: [...agent.args],
        env: { ...agent.env },
        enabled: true,
      },
    };
  }

  // A project that turns an instance on needs it alive and probed even when the machine itself
  // has it off, or a thread in that project would route to an instance nobody ever checked in
  // on.
  for (const overrides of Object.values(settings.projectSettingsOverrides)) {
    for (const [rawInstanceId, projectOverride] of Object.entries(
      overrides?.providerInstances ?? {},
    )) {
      if (projectOverride.enabled !== true) continue;
      const instanceId = rawInstanceId as ProviderInstanceId;
      const existing = merged[instanceId];
      if (existing === undefined || resolveProviderInstanceEnabled(existing)) continue;
      merged[instanceId] = {
        ...existing,
        enabled: true,
        ...(providerInstanceConfigEnabledFlag(existing.config) === false
          ? { config: { ...(existing.config as Record<string, unknown>), enabled: true } }
          : {}),
      };
    }
  }

  return merged as ProviderInstanceConfigMap;
};

const layerSettingsWatcher = (
  settingsChanges: Stream.Stream<ServerSettings>,
  seedConfigMap: ProviderInstanceConfigMap,
) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const mutator = yield* ProviderInstanceRegistryMutator.ProviderInstanceRegistryMutator;
      const serverSettings = yield* Settings.ServerSettingsService;
      const consumeChanges = settingsChanges.pipe(
        Stream.runForEach(() =>
          // The subscription predates the seed read, so a queued change can be
          // older than the seed. A failed current read must leave the registry intact.
          serverSettings.getSettings.pipe(
            Effect.flatMap((current) =>
              mutator.reconcile(deriveProviderInstanceConfigMap(current)),
            ),
            Effect.catchCause((cause) =>
              Effect.logError("ProviderInstanceRegistry reconcile failed", cause),
            ),
          ),
        ),
      );
      // Seeding runs in this same fiber ahead of the queued changes so layer
      // construction never waits on provider startup while reconciles stay
      // serialized in one consumer.
      yield* Effect.forkScoped(
        mutator.reconcile(seedConfigMap).pipe(
          Effect.catchCause((cause) =>
            Effect.logError("ProviderInstanceRegistry reconcile failed", cause),
          ),
          Effect.andThen(consumeChanges),
        ),
      );
    }),
  );

export const layer: Layer.Layer<
  ProviderInstanceRegistry.ProviderInstanceRegistry,
  never,
  ProviderInstanceRegistryHydrationEnv
> = Layer.unwrap(
  Effect.gen(function* () {
    const serverSettings = yield* Settings.ServerSettingsService;
    // Subscribe before the seed read so saves during registry construction are queued.
    const settingsChanges = yield* serverSettings.subscribeChanges;
    const initialSettings: ServerSettings | undefined = yield* serverSettings.getSettings.pipe(
      Effect.orElseSucceed(() => undefined),
    );
    const initialConfigMap =
      initialSettings === undefined
        ? ({} as ProviderInstanceConfigMap)
        : deriveProviderInstanceConfigMap(initialSettings);

    const layerMutable = ProviderInstanceRegistry.layer({
      drivers: BUILT_IN_DRIVERS,
      configMap: initialConfigMap,
      // The watcher below seeds from the settings snapshot in a background
      // fiber, so registry construction doesn't wait on provider startup.
      seed: false,
    }).pipe(
      Layer.provide(ProviderOrchestrationAdapterInfrastructure.layer),
      Layer.provide(AcpRegistrySupport.layerFromHost),
      Layer.provide(ProviderHostLive.layer),
    );

    return layerSettingsWatcher(settingsChanges, initialConfigMap).pipe(
      Layer.provideMerge(layerMutable),
    );
  }),
) as Layer.Layer<
  ProviderInstanceRegistry.ProviderInstanceRegistry,
  never,
  ProviderInstanceRegistryHydrationEnv
>;
