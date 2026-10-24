import { CodeitlabServiceError } from "@codeitlab/core";
import {
  buildCodeitlabQuestBoard,
  type CodeitlabQuestBoard,
  type CodeitlabQuestFacts,
} from "@codeitlab/core/quests";
import {
  CredentialsService,
  EcosystemService,
  IntegrationsService,
  MemoryService,
  NexusService,
  QuestsService as QuestsServiceTag,
  ReaService,
  RemoteService,
  RoutingService,
  StudioService,
} from "@codeitlab/core/services";
import type { CodeitlabCredentialsStatus } from "@codeitlab/core/credentials";
import type { CodeitlabEcosystemStatus } from "@codeitlab/core/ecosystem";
import type { CodeitlabIntegrationList } from "@codeitlab/core/integrations";
import type { MemoryStats } from "@codeitlab/core/memory";
import type { NexusCatalog } from "@codeitlab/core/nexus";
import type { ReaStatus } from "@codeitlab/core/rea";
import type { CodeitlabRemoteStatus } from "@codeitlab/core/remote";
import type { RoutingCatalog } from "@codeitlab/core/routing";
import type { StudioProject } from "@codeitlab/core/studio";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

/** What each probe returned; `undefined` means the probe failed and the fact degrades to "not yet". */
export interface QuestProbes {
  readonly memoryStats?: MemoryStats | undefined;
  readonly reaStatus?: ReaStatus | undefined;
  readonly routingCatalog?: RoutingCatalog | undefined;
  readonly ecosystemStatus?: CodeitlabEcosystemStatus | undefined;
  readonly projects?: ReadonlyArray<StudioProject> | undefined;
  readonly integrationList?: CodeitlabIntegrationList | undefined;
  readonly remoteStatus?: CodeitlabRemoteStatus | undefined;
  readonly credentialsStatus?: CodeitlabCredentialsStatus | undefined;
  readonly nexusCatalog?: NexusCatalog | undefined;
}

/**
 * Pure mapping from service probes to board facts. Exported so the degradation
 * rules (a failed probe can only make a quest "not done") are testable without
 * standing up every service.
 */
export const questFactsFrom = (probes: QuestProbes): CodeitlabQuestFacts => ({
  agentsInstalled:
    probes.ecosystemStatus === undefined
      ? 0
      : probes.ecosystemStatus.integrations.filter(
          (integration) => integration.enabled && integration.available,
        ).length,
  modelsConfigured:
    probes.routingCatalog === undefined
      ? 0
      : probes.routingCatalog.providers.reduce(
          (total, provider) => total + provider.models.length,
          0,
        ),
  memoryEntries: probes.memoryStats?.total ?? 0,
  reaInstalled: probes.reaStatus?.installed ?? false,
  studioProjects: probes.projects?.length ?? 0,
  studioVideos: probes.projects?.filter((project) => project.kind === "video").length ?? 0,
  integrationsConfigured:
    probes.integrationList?.integrations.filter((integration) => integration.configured).length ??
    0,
  remoteReachable:
    probes.remoteStatus === undefined
      ? false
      : probes.remoteStatus.tunnel.running || !probes.remoteStatus.server.loopbackOnly,
  credentialsActive:
    probes.credentialsStatus === undefined
      ? false
      : probes.credentialsStatus.enabled && probes.credentialsStatus.running,
});

/**
 * The quest board is derived, never stored: every tick comes from a service the
 * server already owns, so progress cannot drift from reality and there is no
 * second source of truth to migrate. A failing probe degrades that one quest to
 * "not done yet" instead of taking the whole board down.
 */
export const make = Effect.fn("codeitlab.quests.make")(function* () {
  const memory = yield* MemoryService;
  const rea = yield* ReaService;
  const routing = yield* RoutingService;
  const ecosystem = yield* EcosystemService;
  const studio = yield* StudioService;
  const integrations = yield* IntegrationsService;
  const remote = yield* RemoteService;
  const credentials = yield* CredentialsService;
  const nexus = yield* NexusService;

  const optional = <A>(effect: Effect.Effect<A, CodeitlabServiceError>) =>
    effect.pipe(Effect.catch(() => Effect.succeed(undefined)));

  const list: QuestsServiceTag["Service"]["list"] = Effect.fn("codeitlab.quests.list")(
    function* () {
      const [
        memoryStats,
        reaStatus,
        routingCatalog,
        ecosystemStatus,
        projects,
        integrationList,
        remoteStatus,
        credentialsStatus,
        nexusCatalog,
      ] = yield* Effect.all(
        [
          optional(memory.stats),
          optional(rea.status),
          optional(routing.catalog),
          optional(ecosystem.status),
          optional(studio.list),
          optional(integrations.list),
          optional(remote.status),
          optional(credentials.status),
          optional(nexus.catalog),
        ],
        { concurrency: "unbounded" },
      );

      return buildCodeitlabQuestBoard(
        questFactsFrom({
          memoryStats,
          reaStatus,
          routingCatalog,
          ecosystemStatus,
          projects,
          integrationList,
          remoteStatus,
          credentialsStatus,
          nexusCatalog,
        }),
      );
    },
  )();

  return QuestsServiceTag.of({ list });
});

export const layer = Layer.effect(QuestsServiceTag, make());

export type { CodeitlabQuestBoard };
