import {
  type CodeitlabEcosystemInstallResult,
  type CodeitlabEcosystemStatus,
  type CodeitlabServiceError,
  EcosystemService,
  type EffectivePolicy,
  type MemoryEntry,
  type MemorySearchHit,
  type MemoryStats,
  MemoryService,
  type NexusCatalog,
  NexusService,
  PolicyService,
  type ReaStatus,
  ReaService,
  type RoutingCatalog,
  type RoutingDecision,
  type RoutingHealth,
  RoutingService,
  type StudioDeleteResult,
  type StudioExportResult,
  type StudioProject,
  type StudioProjectInput,
  type StudioProjectList,
  StudioService,
  type CodeitlabRemotePairingLink,
  type CodeitlabRemoteStatus,
  RemoteService,
  type CodeitlabIntegrationList,
  type CodeitlabIntegrationPatch,
  type CodeitlabShortsJob,
  type CodeitlabShortsJobCreated,
  type CodeitlabShortsJobRequest,
  IntegrationsService,
  type CodeitlabCredentialsModel,
  type CodeitlabCredentialsRestoreResult,
  type CodeitlabCredentialsScanInput,
  type CodeitlabCredentialsScanResult,
  type CodeitlabCredentialsSettings,
  type CodeitlabCredentialsStatus,
  CredentialsService,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

/**
 * Typed handler map for the CodeitLab feature RPCs.
 *
 * The interface uses the literal wire names so the object keeps an exact type:
 * a computed-key object widens to an index signature and erases the handler
 * payload types. Optional payload fields carry `| undefined` because the wire
 * schema uses `optionalKey`.
 *
 * Every handler is a thin transport: decode already happened in the RPC layer,
 * and each call delegates to exactly one feature service. Failures are the
 * shared `CodeitlabServiceError`, which is also the wire error schema, so no
 * translation is needed.
 */
export interface CodeitlabRpcHandlers {
  readonly "codeitlab.nexus.catalog": () => Effect.Effect<NexusCatalog, CodeitlabServiceError>;
  readonly "codeitlab.nexus.refresh": () => Effect.Effect<NexusCatalog, CodeitlabServiceError>;
  readonly "codeitlab.nexus.skills.list": () => Effect.Effect<
    ReadonlyArray<NexusCatalog["skills"][number]>,
    CodeitlabServiceError
  >;
  readonly "codeitlab.nexus.mcp.merge": () => Effect.Effect<
    ReadonlyArray<NexusCatalog["mcpServers"][number]>,
    CodeitlabServiceError
  >;
  readonly "codeitlab.nexus.sessions.list": () => Effect.Effect<
    ReadonlyArray<NexusCatalog["sessions"][number]>,
    CodeitlabServiceError
  >;
  readonly "codeitlab.memory.list": (input: {
    readonly scope?: "global" | "project" | undefined;
    readonly projectId?: string | null | undefined;
    readonly limit?: number | undefined;
  }) => Effect.Effect<ReadonlyArray<MemoryEntry>, CodeitlabServiceError>;
  readonly "codeitlab.memory.search": (input: {
    readonly query: string;
    readonly projectId?: string | null | undefined;
    readonly limit?: number | undefined;
    readonly minScore?: number | undefined;
  }) => Effect.Effect<ReadonlyArray<MemorySearchHit>, CodeitlabServiceError>;
  readonly "codeitlab.memory.add": (input: {
    readonly scope: "global" | "project";
    readonly projectId?: string | null | undefined;
    readonly kind: MemoryEntry["kind"];
    readonly text: string;
    readonly tags?: ReadonlyArray<string> | undefined;
    readonly confidence?: number | undefined;
    readonly source?: MemoryEntry["source"] | undefined;
  }) => Effect.Effect<MemoryEntry, CodeitlabServiceError>;
  readonly "codeitlab.memory.update": (input: {
    readonly id: string;
    readonly text?: string | undefined;
    readonly tags?: ReadonlyArray<string> | undefined;
  }) => Effect.Effect<MemoryEntry, CodeitlabServiceError>;
  readonly "codeitlab.memory.delete": (input: {
    readonly id: string;
  }) => Effect.Effect<{}, CodeitlabServiceError>;
  readonly "codeitlab.memory.stats": () => Effect.Effect<MemoryStats, CodeitlabServiceError>;
  readonly "codeitlab.routing.catalog": () => Effect.Effect<RoutingCatalog, CodeitlabServiceError>;
  readonly "codeitlab.routing.decide": (input: {
    readonly prompt: string;
    readonly projectId?: string | null | undefined;
    readonly attachments?: ReadonlyArray<string> | undefined;
    readonly taskClass?: RoutingDecision["taskClass"] | undefined;
  }) => Effect.Effect<RoutingDecision, CodeitlabServiceError>;
  readonly "codeitlab.routing.history": (input: {
    readonly limit?: number | undefined;
  }) => Effect.Effect<ReadonlyArray<RoutingDecision>, CodeitlabServiceError>;
  readonly "codeitlab.routing.health": () => Effect.Effect<RoutingHealth, CodeitlabServiceError>;
  readonly "codeitlab.routing.checkHealth": () => Effect.Effect<
    RoutingHealth,
    CodeitlabServiceError
  >;
  readonly "codeitlab.policy.effective": (input: {
    readonly providerInstanceId?: string | undefined;
  }) => Effect.Effect<EffectivePolicy, CodeitlabServiceError>;
  readonly "codeitlab.policy.setProfile": (input: {
    readonly profile: "standard" | "permissive";
  }) => Effect.Effect<EffectivePolicy, CodeitlabServiceError>;
  readonly "codeitlab.rea.status": () => Effect.Effect<ReaStatus, CodeitlabServiceError>;
  readonly "codeitlab.rea.install": () => Effect.Effect<ReaStatus, CodeitlabServiceError>;
  readonly "codeitlab.ecosystem.status": () => Effect.Effect<
    CodeitlabEcosystemStatus,
    CodeitlabServiceError
  >;
  readonly "codeitlab.ecosystem.install": () => Effect.Effect<
    CodeitlabEcosystemInstallResult,
    CodeitlabServiceError
  >;
  readonly "codeitlab.studio.list": () => Effect.Effect<StudioProjectList, CodeitlabServiceError>;
  readonly "codeitlab.studio.save": (input: {
    readonly project: StudioProjectInput;
  }) => Effect.Effect<StudioProject, CodeitlabServiceError>;
  readonly "codeitlab.studio.delete": (input: {
    readonly id: string;
  }) => Effect.Effect<StudioDeleteResult, CodeitlabServiceError>;
  readonly "codeitlab.studio.export": (input: {
    readonly id: string;
  }) => Effect.Effect<StudioExportResult, CodeitlabServiceError>;
  readonly "codeitlab.remote.status": () => Effect.Effect<
    CodeitlabRemoteStatus,
    CodeitlabServiceError
  >;
  readonly "codeitlab.remote.createPairingLink": () => Effect.Effect<
    CodeitlabRemotePairingLink,
    CodeitlabServiceError
  >;
  readonly "codeitlab.integrations.list": () => Effect.Effect<
    CodeitlabIntegrationList,
    CodeitlabServiceError
  >;
  readonly "codeitlab.integrations.set": (input: {
    readonly patch: CodeitlabIntegrationPatch;
  }) => Effect.Effect<CodeitlabIntegrationList, CodeitlabServiceError>;
  readonly "codeitlab.integrations.shorts.createJob": (
    input: CodeitlabShortsJobRequest,
  ) => Effect.Effect<CodeitlabShortsJobCreated, CodeitlabServiceError>;
  readonly "codeitlab.integrations.shorts.jobStatus": (input: {
    readonly jobId: string;
  }) => Effect.Effect<CodeitlabShortsJob, CodeitlabServiceError>;
  readonly "codeitlab.credentials.status": () => Effect.Effect<
    CodeitlabCredentialsStatus,
    CodeitlabServiceError
  >;
  readonly "codeitlab.credentials.update": (input: {
    readonly settings: CodeitlabCredentialsSettings;
  }) => Effect.Effect<CodeitlabCredentialsStatus, CodeitlabServiceError>;
  readonly "codeitlab.credentials.scan": (
    input: CodeitlabCredentialsScanInput,
  ) => Effect.Effect<CodeitlabCredentialsScanResult, CodeitlabServiceError>;
  readonly "codeitlab.credentials.restore": (input: {
    readonly text: string;
  }) => Effect.Effect<CodeitlabCredentialsRestoreResult, CodeitlabServiceError>;
  readonly "codeitlab.credentials.start": () => Effect.Effect<
    CodeitlabCredentialsStatus,
    CodeitlabServiceError
  >;
  readonly "codeitlab.credentials.stop": () => Effect.Effect<
    CodeitlabCredentialsStatus,
    CodeitlabServiceError
  >;
  readonly "codeitlab.credentials.downloadModel": () => Effect.Effect<
    CodeitlabCredentialsModel,
    CodeitlabServiceError
  >;
}

/**
 * Builds the handler map from the live feature services. The composition layer
 * in `./index.ts` provides them once per server lifetime.
 */
export const makeCodeitlabRpcHandlers: Effect.Effect<
  CodeitlabRpcHandlers,
  never,
  | EcosystemService
  | MemoryService
  | NexusService
  | PolicyService
  | ReaService
  | RoutingService
  | StudioService
  | RemoteService
  | IntegrationsService
  | CredentialsService
> = Effect.gen(function* () {
  const memory = yield* MemoryService;
  const nexus = yield* NexusService;
  const policy = yield* PolicyService;
  const rea = yield* ReaService;
  const routing = yield* RoutingService;
  const ecosystem = yield* EcosystemService;
  const studio = yield* StudioService;
  const remote = yield* RemoteService;
  const integrations = yield* IntegrationsService;
  const credentials = yield* CredentialsService;

  return {
    "codeitlab.nexus.catalog": () => nexus.catalog,
    "codeitlab.nexus.refresh": () => nexus.refresh,
    "codeitlab.nexus.skills.list": () =>
      nexus.catalog.pipe(Effect.map((catalog) => catalog.skills)),
    "codeitlab.nexus.mcp.merge": () =>
      nexus.catalog.pipe(Effect.map((catalog) => catalog.mcpServers)),
    "codeitlab.nexus.sessions.list": () =>
      nexus.catalog.pipe(Effect.map((catalog) => catalog.sessions)),
    "codeitlab.memory.list": (input) =>
      memory.list({
        ...(input.scope === undefined ? {} : { scope: input.scope }),
        ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
        ...(input.limit === undefined ? {} : { limit: input.limit }),
      }),
    "codeitlab.memory.search": (input) =>
      memory.search({
        query: input.query,
        projectId: input.projectId ?? null,
        limit: input.limit ?? 8,
        minScore: input.minScore ?? 0.2,
      }),
    "codeitlab.memory.add": (input) =>
      memory.add({
        scope: input.scope,
        kind: input.kind,
        text: input.text,
        ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
        ...(input.tags === undefined ? {} : { tags: input.tags }),
        ...(input.confidence === undefined ? {} : { confidence: input.confidence }),
        ...(input.source === undefined ? {} : { source: input.source }),
      }),
    "codeitlab.memory.update": (input) =>
      memory.update(input.id, {
        ...(input.text === undefined ? {} : { text: input.text }),
        ...(input.tags === undefined ? {} : { tags: input.tags }),
      }),
    "codeitlab.memory.delete": (input) => memory.remove(input.id).pipe(Effect.as({})),
    "codeitlab.memory.stats": () => memory.stats,
    "codeitlab.routing.catalog": () => routing.catalog,
    "codeitlab.routing.decide": (input) =>
      routing.decide({
        prompt: input.prompt,
        projectId: input.projectId ?? null,
        attachments: input.attachments ?? [],
        ...(input.taskClass === undefined ? {} : { taskClass: input.taskClass }),
      }),
    "codeitlab.routing.history": (input) => routing.history(input.limit),
    "codeitlab.routing.health": () => routing.health,
    "codeitlab.routing.checkHealth": () => routing.checkHealth,
    "codeitlab.policy.effective": (input) =>
      policy.effective(
        input.providerInstanceId === undefined
          ? {}
          : { providerInstanceId: input.providerInstanceId },
      ),
    "codeitlab.policy.setProfile": (input) =>
      policy.setProfile(input.profile).pipe(Effect.andThen(policy.effective())),
    "codeitlab.rea.status": () => rea.status,
    "codeitlab.rea.install": () => rea.ensureInstalled,
    "codeitlab.ecosystem.status": () => ecosystem.status,
    "codeitlab.ecosystem.install": () => ecosystem.install,
    "codeitlab.studio.list": () => studio.list.pipe(Effect.map((projects) => ({ projects }))),
    "codeitlab.studio.save": (input) => studio.save(input.project),
    "codeitlab.studio.delete": (input) =>
      studio.remove(input.id).pipe(Effect.map((deleted) => ({ deleted }))),
    "codeitlab.studio.export": (input) => studio.exportHtml(input.id),
    "codeitlab.remote.status": () => remote.status,
    "codeitlab.remote.createPairingLink": () => remote.createPairingLink,
    "codeitlab.integrations.list": () => integrations.list,
    "codeitlab.integrations.set": (input) => integrations.set(input.patch),
    "codeitlab.integrations.shorts.createJob": (input) => integrations.createShortsJob(input),
    "codeitlab.integrations.shorts.jobStatus": (input) => integrations.shortsJobStatus(input.jobId),
    "codeitlab.credentials.status": () => credentials.status,
    "codeitlab.credentials.update": (input) => credentials.update(input.settings),
    "codeitlab.credentials.scan": (input) => credentials.scan(input),
    "codeitlab.credentials.restore": (input) => credentials.restore(input),
    "codeitlab.credentials.start": () => credentials.start,
    "codeitlab.credentials.stop": () => credentials.stop,
    "codeitlab.credentials.downloadModel": () => credentials.downloadModel,
  };
});
