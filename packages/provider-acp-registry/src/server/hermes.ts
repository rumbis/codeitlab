import { ProviderDriverKind, type ServerProvider } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import { ProviderDriverError } from "@t3tools/provider-core/server/errors";
import {
  ProviderAdapterDriverCreateError,
  type ProviderAdapterDriver,
} from "@t3tools/provider-core/server/adapterDriver";
import {
  defaultProviderContinuationIdentity,
  type ProviderDriver,
  type ProviderInstance,
} from "@t3tools/provider-core/server/driver";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import type * as Scope from "effect/Scope";

import { DEFAULT_HERMES_SETTINGS, HermesSettings, hermesAcpSettings } from "../settings.ts";
import { AcpRegistryAdapterV2Driver, type AcpRegistryAdapterV2DriverEnv } from "./adapter.ts";
import { AcpRegistryDriver, type AcpRegistryDriverEnv } from "./driver.ts";

/**
 * Hermes Agent is a local ACP command, so this driver is a flavor over the
 * generic local-ACP path: it translates {@link HermesSettings} into the ACP
 * Registry's local-command config and then reuses that driver for spawning,
 * probing, authentication, models and ACP session management. Only identity
 * differs — Hermes must publish snapshots under its own driver kind, otherwise
 * ProviderRegistry rejects the snapshot as a driver mismatch.
 */
export const HERMES_DRIVER_KIND = ProviderDriverKind.make("hermes");

export const HERMES_DRIVER_METADATA = {
  displayName: "Hermes",
  supportsMultipleInstances: true,
  // A built-in local agent should exist in the provider list without setup;
  // it stays disabled until the user turns it on.
  hasDefaultInstance: true,
} as const;

export type HermesDriverEnv = AcpRegistryDriverEnv;

export const restampHermesProvider = (provider: ServerProvider): ServerProvider =>
  provider.driver === HERMES_DRIVER_KIND ? provider : { ...provider, driver: HERMES_DRIVER_KIND };

/**
 * Re-stamp every snapshot the inherited driver publishes. `ProviderRegistry`
 * dies on `snapshot.driver !== instance.driverKind`, and the managed provider
 * publishes through both `getSnapshot` and `streamChanges`, so all three
 * surfaces are mapped.
 */
function withHermesIdentity(
  instance: ProviderInstance,
  instanceId: ProviderInstance["instanceId"],
): ProviderInstance {
  return {
    ...instance,
    driverKind: HERMES_DRIVER_KIND,
    continuationIdentity: defaultProviderContinuationIdentity({
      driverKind: HERMES_DRIVER_KIND,
      instanceId,
    }),
    snapshot: {
      ...instance.snapshot,
      getSnapshot: instance.snapshot.getSnapshot.pipe(Effect.map(restampHermesProvider)),
      refresh: instance.snapshot.refresh.pipe(Effect.map(restampHermesProvider)),
      streamChanges: Stream.map(instance.snapshot.streamChanges, restampHermesProvider),
    },
  };
}

export const HermesDriver: ProviderDriver<HermesSettings, HermesDriverEnv> = {
  driverKind: HERMES_DRIVER_KIND,
  metadata: HERMES_DRIVER_METADATA,
  configSchema: HermesSettings,
  defaultConfig: () => DEFAULT_HERMES_SETTINGS,
  create: Effect.fn("HermesDriver.create")(
    function* (input) {
      const instance = yield* AcpRegistryDriver.create({
        ...input,
        config: hermesAcpSettings({ ...input.config, enabled: input.enabled }),
      });
      return withHermesIdentity(instance, input.instanceId);
    },
    (effect, input) =>
      effect.pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: HERMES_DRIVER_KIND,
              instanceId: input.instanceId,
              detail: "Failed to build the Hermes provider.",
              cause,
            }),
        ),
      ),
  ),
};

export type HermesAdapterV2DriverEnv = AcpRegistryAdapterV2DriverEnv;

export const HermesAdapterV2Driver: ProviderAdapterDriver<
  HermesSettings,
  HermesAdapterV2DriverEnv
> = {
  driverKind: HERMES_DRIVER_KIND,
  configSchema: HermesSettings,
  defaultConfig: () => DEFAULT_HERMES_SETTINGS,
  create: Effect.fn("HermesAdapterV2Driver.create")(
    function* (
      input,
    ): Effect.fn.Return<
      ProviderAdapter.ProviderAdapterV2["Service"],
      ProviderAdapterDriverCreateError,
      HermesAdapterV2DriverEnv | Scope.Scope
    > {
      return yield* AcpRegistryAdapterV2Driver.create({
        ...input,
        config: hermesAcpSettings({ ...input.config, enabled: input.enabled }),
      });
    },
    (effect, input) =>
      effect.pipe(
        Effect.mapError(
          (cause) =>
            new ProviderAdapterDriverCreateError({
              driver: HERMES_DRIVER_KIND,
              instanceId: input.instanceId,
              detail: "Failed to create the Hermes adapter.",
              cause,
            }),
        ),
      ),
  ),
};
