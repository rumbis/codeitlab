import { it as itEffect } from "@effect/vitest";
import {
  DEFAULT_CODEITLAB_SETTINGS,
  DEFAULT_SERVER_SETTINGS,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderInstanceConfigMap,
  type ServerSettings,
} from "@codeitlab/contracts";
import type { AnyProviderDriver, ProviderInstance } from "@codeitlab/provider-core/server/driver";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it, vi } from "vite-plus/test";

import { makeProviderInstanceRegistry } from "./ProviderInstanceRegistry.ts";
import { deriveProviderInstanceConfigMap } from "./ProviderInstanceRegistryHydration.ts";

vi.mock("@anthropic-ai/claude-agent-sdk", { spy: true });

const projectId = ProjectId.make("project-a");
const instanceId = ProviderInstanceId.make("codex_work");

function settingsWith(overrides: Partial<ServerSettings>): ServerSettings {
  return { ...DEFAULT_SERVER_SETTINGS, ...overrides };
}

describe("deriveProviderInstanceConfigMap", () => {
  it("turns a machine-disabled instance on when a project enables it", () => {
    const settings = settingsWith({
      providerInstances: {
        [instanceId]: { driver: ProviderDriverKind.make("codex"), enabled: false },
      },
      projectSettingsOverrides: {
        [projectId]: { providerInstances: { [instanceId]: { enabled: true } } },
      },
    });

    const merged = deriveProviderInstanceConfigMap(settings);

    expect(merged[instanceId]).toEqual({ driver: ProviderDriverKind.make("codex"), enabled: true });
  });

  it("clears a nested config.enabled:false flag when a project enables the instance", () => {
    const settings = settingsWith({
      providerInstances: {
        [instanceId]: {
          driver: ProviderDriverKind.make("codex"),
          config: { enabled: false },
        },
      },
      projectSettingsOverrides: {
        [projectId]: { providerInstances: { [instanceId]: { enabled: true } } },
      },
    });

    const merged = deriveProviderInstanceConfigMap(settings);

    expect(merged[instanceId]).toEqual({
      driver: ProviderDriverKind.make("codex"),
      enabled: true,
      config: { enabled: true },
    });
  });

  it("leaves an already machine-enabled instance untouched", () => {
    const settings = settingsWith({
      providerInstances: {
        [instanceId]: { driver: ProviderDriverKind.make("codex"), enabled: true },
      },
      projectSettingsOverrides: {
        [projectId]: { providerInstances: { [instanceId]: { enabled: true } } },
      },
    });

    const merged = deriveProviderInstanceConfigMap(settings);

    expect(merged[instanceId]).toBe(settings.providerInstances[instanceId]);
  });

  it("does not revive an instance a project override references but settings no longer configure", () => {
    const settings = settingsWith({
      providerInstances: {},
      projectSettingsOverrides: {
        [projectId]: { providerInstances: { [instanceId]: { enabled: true } } },
      },
    });

    const merged = deriveProviderInstanceConfigMap(settings);

    expect(merged[instanceId]).toBeUndefined();
  });

  it("ignores a project override that disables an instance, leaving the machine's config in charge", () => {
    const settings = settingsWith({
      providerInstances: {
        [instanceId]: { driver: ProviderDriverKind.make("codex"), enabled: true },
      },
      projectSettingsOverrides: {
        [projectId]: { providerInstances: { [instanceId]: { enabled: false } } },
      },
    });

    const merged = deriveProviderInstanceConfigMap(settings);

    expect(merged[instanceId]).toBe(settings.providerInstances[instanceId]);
  });

  it("folds overrides from multiple projects", () => {
    const otherInstanceId = ProviderInstanceId.make("claudeAgent_personal");
    const otherProjectId = ProjectId.make("project-b");
    const settings = settingsWith({
      providerInstances: {
        [instanceId]: { driver: ProviderDriverKind.make("codex"), enabled: false },
        [otherInstanceId]: { driver: ProviderDriverKind.make("claudeAgent"), enabled: false },
      },
      projectSettingsOverrides: {
        [projectId]: { providerInstances: { [instanceId]: { enabled: true } } },
        [otherProjectId]: { providerInstances: { [otherInstanceId]: { enabled: true } } },
      },
    });

    const merged = deriveProviderInstanceConfigMap(settings);

    expect(merged[instanceId]).toEqual({ driver: ProviderDriverKind.make("codex"), enabled: true });
    expect(merged[otherInstanceId]).toEqual({
      driver: ProviderDriverKind.make("claudeAgent"),
      enabled: true,
    });
  });
});

describe("deriveProviderInstanceConfigMap custom ACP agents", () => {
  const agent = (
    overrides: Partial<{
      id: string;
      transport: "local" | "ssh" | "tailscale";
      enabled: boolean;
    }> = {},
  ) => ({
    id: "hermes-vps",
    name: "Hermes (VPS)",
    command: "hermes",
    args: ["acp"],
    env: { HERMES_HOME: "/opt/hermes" },
    transport: "local" as const,
    host: undefined,
    enabled: true,
    ...overrides,
  });

  const settingsWithAgents = (
    agents: ReadonlyArray<ReturnType<typeof agent>>,
    overrides: Partial<ServerSettings> = {},
  ): ServerSettings =>
    settingsWith({
      ...overrides,
      codeitlab: {
        ...DEFAULT_CODEITLAB_SETTINGS,
        nexus: { ...DEFAULT_CODEITLAB_SETTINGS.nexus, customAcpAgents: [...agents] },
      },
    });

  it("turns a local custom ACP agent into an acpRegistry instance", () => {
    const merged = deriveProviderInstanceConfigMap(settingsWithAgents([agent()]));

    expect(merged[ProviderInstanceId.make("hermes-vps")]).toEqual({
      driver: ProviderDriverKind.make("acpRegistry"),
      config: {
        source: "local",
        agentId: "hermes-vps",
        commandPath: "hermes",
        commandArgs: ["acp"],
        env: { HERMES_HOME: "/opt/hermes" },
        enabled: true,
      },
    });
  });

  it("skips disabled and remote agents, and never overrides an explicit instance", () => {
    const merged = deriveProviderInstanceConfigMap(
      settingsWithAgents(
        [
          agent({ id: "off", enabled: false }),
          agent({ id: "vps", transport: "ssh" }),
          agent({ id: "explicit" }),
        ],
        {
          providerInstances: {
            [ProviderInstanceId.make("explicit")]: {
              driver: ProviderDriverKind.make("acpRegistry"),
              config: { source: "local", commandPath: "custom-agent" },
            },
          },
        },
      ),
    );

    expect(merged[ProviderInstanceId.make("off")]).toBeUndefined();
    expect(merged[ProviderInstanceId.make("vps")]).toBeUndefined();
    expect(merged[ProviderInstanceId.make("explicit")]?.config).toEqual({
      source: "local",
      commandPath: "custom-agent",
    });
  });
});

// The seed contract the hydration layer depends on: with seed: false the reconcile is the caller's
// job, so construction returns while a provider startup is still in flight.
describe("ProviderInstanceRegistryHydration seeder", () => {
  itEffect.live("makes the registry without waiting on the seed it asks callers to run", () =>
    Effect.gen(function* () {
      const seedStarted = yield* Deferred.make<void>();
      const seedRelease = yield* Deferred.make<void>();

      // A driver whose create parks is enough here: reconcile awaits create, so a build that ran the
      // seed inline would park inside construction and never return.
      const blockingDriver: AnyProviderDriver<never> = {
        driverKind: ProviderDriverKind.make("codex"),
        metadata: { displayName: "Blocking" },
        configSchema: Schema.Unknown,
        defaultConfig: () => ({}),
        create: () =>
          Deferred.succeed(seedStarted, undefined).pipe(
            Effect.andThen(Deferred.await(seedRelease)),
            Effect.as({}),
          ) as Effect.Effect<ProviderInstance, never, never>,
      } as unknown as AnyProviderDriver<never>;

      const configMap = {
        [instanceId]: {
          driver: ProviderDriverKind.make("codex"),
          enabled: true,
          config: {},
        },
      } satisfies ProviderInstanceConfigMap;

      // seed: false is what the hydration layer passes. Returning here is the whole point.
      const { registry, mutator } = yield* makeProviderInstanceRegistry({
        drivers: [blockingDriver],
        configMap,
        seed: false,
      });
      expect(yield* registry.listInstances).toEqual([]);

      // The caller's seed is the one that reaches the driver.
      yield* mutator.reconcile(configMap).pipe(Effect.ignoreCause, Effect.forkChild);
      yield* Deferred.await(seedStarted);
      yield* Deferred.succeed(seedRelease, undefined);
    }),
  );
});
