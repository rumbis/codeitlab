import {
  DEFAULT_CODEITLAB_SETTINGS,
  DEFAULT_SERVER_SETTINGS,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerSettings,
} from "@codeitlab/contracts";
import { describe, expect, it } from "vite-plus/test";

import { deriveProviderInstanceConfigMap } from "./ProviderInstanceRegistryHydration.ts";

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
