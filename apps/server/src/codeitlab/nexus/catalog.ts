import type {
  CodeitlabCustomAcpAgent,
  CodeitlabNexusSettings,
  NexusCatalog,
  NexusMcpServer,
  NexusProviderSummary,
  NexusSession,
  NexusSkill,
  NexusSkillSource,
  ServerProvider,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import {
  mergeNexusMcpServers,
  mergeNexusSessions,
  mergeNexusSkills,
  skillId,
} from "./fingerprint.ts";
import { readNexusMcpServers } from "./mcp.ts";
import { readRemoteHarnessCatalog, type RemoteCommandRunner } from "./remote.ts";
import { readNexusSessions } from "./sessions.ts";
import { nexusSkillRoots, readNexusSkills, type NexusSourceResult } from "./skills.ts";

const MAX_CATALOG_SKILLS = 1_000;
const MAX_CATALOG_SESSIONS = 400;

const SOURCE_FOR_DRIVER: Readonly<Record<string, NexusSkillSource>> = {
  hermes: "hermes",
  claudeAgent: "claude",
  codex: "codex",
  cursor: "cursor",
  opencode: "opencode",
  acpRegistry: "acp-registry",
};

const skillSourceForDriver = (driver: string): NexusSkillSource =>
  SOURCE_FOR_DRIVER[driver] ?? "filesystem";

const INSTANCE_FOR_SOURCE: Readonly<Record<NexusSkillSource, string>> = {
  hermes: "hermes",
  claude: "claudeAgent",
  codex: "codex",
  cursor: "cursor",
  opencode: "opencode",
  "acp-registry": "acpRegistry",
  codeitlab: "codeitlab",
  filesystem: "filesystem",
};

const providerName = (provider: ServerProvider): string => provider.displayName ?? provider.driver;

export interface NexusCatalogBuildInput {
  readonly generatedAt: string;
  readonly homeDir: string;
  readonly appSkillsDir: string;
  readonly appMcpDir: string;
  readonly settings: CodeitlabNexusSettings;
  readonly providers: ReadonlyArray<ServerProvider>;
  /** ACP-native session listings, already read from provider instances. */
  readonly acpSessions?: ReadonlyArray<NexusSession>;
  /** Injected in tests; the live layer shells out over SSH. */
  readonly remoteRunner?: RemoteCommandRunner;
  /** Remote custom agents whose harness should be ingested. */
  readonly customAcpAgents?: ReadonlyArray<CodeitlabCustomAcpAgent>;
}

const emptySource = <T>(): NexusSourceResult<T> => ({ items: [], warnings: [] });

const remoteAgents = (input: NexusCatalogBuildInput): ReadonlyArray<CodeitlabCustomAcpAgent> =>
  (input.customAcpAgents ?? []).filter(
    (agent) => agent.enabled && (agent.transport === "ssh" || agent.transport === "tailscale"),
  );

/**
 * Compose the persisted catalog. Read-only: every reader tolerates a missing
 * harness directory and reports a warning instead of failing the refresh, so
 * one broken harness never hides the rest of the catalog.
 */
export const buildNexusCatalog = Effect.fn("Nexus.buildCatalog")(function* (
  input: NexusCatalogBuildInput,
) {
  const fs = yield* FileSystem.FileSystem;
  const warnings: Array<string> = [];
  const settings = input.settings;

  const providerSummaries: Array<NexusProviderSummary> = [];
  const providerBySource = new Map<NexusSkillSource, string>();
  for (const provider of input.providers) {
    const source = skillSourceForDriver(provider.driver);
    if (!providerBySource.has(source)) providerBySource.set(source, provider.instanceId);
    providerSummaries.push({
      instanceId: provider.instanceId,
      driverKind: provider.driver,
      name: providerName(provider),
      transport: "local",
      available: provider.enabled && provider.installed,
      skills: 0,
      sessions: 0,
      mcpServers: 0,
      ...(provider.message === undefined ? {} : { detail: provider.message }),
    });
  }
  for (const agent of input.customAcpAgents ?? []) {
    if (providerSummaries.some((summary) => summary.instanceId === agent.id)) continue;
    providerSummaries.push({
      instanceId: agent.id,
      driverKind: "customAcp",
      name: agent.name,
      transport: agent.transport,
      available: agent.enabled,
      skills: 0,
      sessions: 0,
      mcpServers: 0,
      ...(agent.host === undefined ? {} : { detail: `Remote harness on ${agent.host}.` }),
    });
  }

  if (!settings.enabled) {
    return {
      generatedAt: input.generatedAt,
      providers: providerSummaries,
      skills: [],
      mcpServers: [],
      sessions: [],
      warnings: ["Nexus is disabled in CodeitLab settings; catalog ingestion is skipped."],
    } satisfies NexusCatalog;
  }

  const skills: Array<NexusSkill> = [];
  const mcpServers: Array<NexusMcpServer> = [];
  const sessions: Array<NexusSession> = [];

  const localSkills: NexusSourceResult<NexusSkill> = settings.includeSkills
    ? yield* readNexusSkills(
        nexusSkillRoots({ homeDir: input.homeDir, appSkillsDir: input.appSkillsDir }),
      )
    : emptySource<NexusSkill>();
  warnings.push(...localSkills.warnings);
  if (settings.includeSkills) {
    for (const skill of localSkills.items) {
      skills.push({
        ...skill,
        providerInstanceId: providerBySource.get(skill.source) ?? INSTANCE_FOR_SOURCE[skill.source],
      });
    }
    // Skills a provider advertised through its own probe (ACP `skills` list).
    for (const provider of input.providers) {
      for (const skill of provider.skills) {
        skills.push({
          id: skillId(skillSourceForDriver(provider.driver), skill.name),
          name: skill.name,
          description: skill.description ?? "",
          source: skillSourceForDriver(provider.driver),
          providerInstanceId: provider.instanceId,
          path: skill.path,
          alsoAvailableIn: [],
        });
      }
    }
  }

  const localMcp: NexusSourceResult<NexusMcpServer> = settings.includeMcp
    ? yield* readNexusMcpServers({
        homeDir: input.homeDir,
        appMcpDir: input.appMcpDir,
      })
    : emptySource<NexusMcpServer>();
  warnings.push(...localMcp.warnings);
  if (settings.includeMcp) mcpServers.push(...localMcp.items);

  const localSessions: NexusSourceResult<NexusSession> = settings.includeSessions
    ? yield* readNexusSessions({ homeDir: input.homeDir })
    : emptySource<NexusSession>();
  warnings.push(...localSessions.warnings);
  if (settings.includeSessions) sessions.push(...localSessions.items);

  if (settings.includeSessions && input.acpSessions !== undefined) {
    sessions.push(...input.acpSessions);
  }

  if (input.remoteRunner !== undefined) {
    for (const agent of remoteAgents(input)) {
      if (agent.host === undefined || agent.host.trim().length === 0) {
        warnings.push(`Custom ACP agent '${agent.name}' has no host; remote ingestion skipped.`);
        continue;
      }
      const remote = yield* readRemoteHarnessCatalog({
        host: agent.host,
        transport: agent.transport === "tailscale" ? "tailscale" : "ssh",
        providerInstanceId: agent.id,
        generatedAt: input.generatedAt,
        runner: input.remoteRunner,
      });
      warnings.push(...remote.warnings);
      if (settings.includeSkills) skills.push(...remote.skills);
      if (settings.includeMcp) mcpServers.push(...remote.mcpServers);
      if (settings.includeSessions) sessions.push(...remote.sessions);
    }
  }

  const mergedSkills = mergeNexusSkills(skills).slice(0, MAX_CATALOG_SKILLS);
  const mergedMcp = mergeNexusMcpServers(mcpServers);
  const mergedSessions = mergeNexusSessions(sessions).slice(0, MAX_CATALOG_SESSIONS);

  const skillCounts = new Map<string, number>();
  for (const skill of mergedSkills) {
    if (skill.providerInstanceId === undefined) continue;
    skillCounts.set(skill.providerInstanceId, (skillCounts.get(skill.providerInstanceId) ?? 0) + 1);
  }
  const sessionCounts = new Map<string, number>();
  for (const session of mergedSessions) {
    sessionCounts.set(
      session.providerInstanceId,
      (sessionCounts.get(session.providerInstanceId) ?? 0) + 1,
    );
  }
  const providers = providerSummaries.map((summary) => ({
    ...summary,
    skills: skillCounts.get(summary.instanceId) ?? 0,
    sessions: sessionCounts.get(summary.instanceId) ?? 0,
  }));

  // Surface a missing harness home once instead of per reader.
  if (settings.includeSkills && mergedSkills.length === 0) {
    warnings.push("No harness skills were found on this environment.");
  }

  const appDirs = yield* Effect.all([
    fs.exists(input.appSkillsDir).pipe(Effect.orElseSucceed(() => false)),
    fs.exists(input.appMcpDir).pipe(Effect.orElseSucceed(() => false)),
  ]);
  if (!appDirs.some(Boolean)) {
    // App-managed dirs are created by the features that use them; absence is normal.
  }

  return {
    generatedAt: input.generatedAt,
    providers,
    skills: mergedSkills,
    mcpServers: mergedMcp,
    sessions: mergedSessions,
    warnings: [...new Set(warnings)],
  } satisfies NexusCatalog;
});
