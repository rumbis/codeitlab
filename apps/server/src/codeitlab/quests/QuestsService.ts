import { CodeItLabServiceError } from "@codeitlab/core";
import {
  buildCodeItLabQuestBoard,
  type CodeItLabQuestBoard,
  type CodeItLabQuestFacts,
} from "@codeitlab/core/quests";
import {
  CodeItLabTasksService,
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
import type { CodeItLabTask } from "@codeitlab/core/board";
import type { CodeItLabCredentialsStatus } from "@codeitlab/core/credentials";
import type { CodeItLabEcosystemStatus } from "@codeitlab/core/ecosystem";
import type { CodeItLabIntegrationList } from "@codeitlab/core/integrations";
import type { MemoryStats } from "@codeitlab/core/memory";
import type { NexusCatalog } from "@codeitlab/core/nexus";
import type { ReaStatus } from "@codeitlab/core/rea";
import type { CodeItLabRemoteStatus } from "@codeitlab/core/remote";
import type { RoutingCatalog } from "@codeitlab/core/routing";
import type { StudioProject } from "@codeitlab/core/studio";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

/** What each probe returned; `undefined` means the probe failed and the fact degrades to "not yet". */
export interface QuestProbes {
  readonly memoryStats?: MemoryStats | undefined;
  readonly reaStatus?: ReaStatus | undefined;
  readonly routingCatalog?: RoutingCatalog | undefined;
  readonly ecosystemStatus?: CodeItLabEcosystemStatus | undefined;
  readonly projects?: ReadonlyArray<StudioProject> | undefined;
  readonly integrationList?: CodeItLabIntegrationList | undefined;
  readonly remoteStatus?: CodeItLabRemoteStatus | undefined;
  readonly credentialsStatus?: CodeItLabCredentialsStatus | undefined;
  readonly nexusCatalog?: NexusCatalog | undefined;
  readonly boardTasks?: ReadonlyArray<CodeItLabTask> | undefined;
}

/**
 * Pure mapping from service probes to board facts. Exported so the degradation
 * rules (a failed probe can only make a quest "not done") are testable without
 * standing up every service.
 */
export const questFactsFrom = (probes: QuestProbes): CodeItLabQuestFacts => ({
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
  // The board is real work, so it is a quest fact too: adding a task and
  // finishing one close the loop between learning and doing.
  boardTasks: probes.boardTasks?.filter((task) => task.archivedAt === "").length ?? 0,
  boardCompleted: probes.boardTasks?.filter((task) => task.column === "completed").length ?? 0,
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
  const board = yield* CodeItLabTasksService;

  const optional = <A>(effect: Effect.Effect<A, CodeItLabServiceError>) =>
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
        boardTasks,
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
          optional(board.list),
        ],
        { concurrency: "unbounded" },
      );

      return buildCodeItLabQuestBoard(
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
          boardTasks,
        }),
      );
    },
  )();

  return QuestsServiceTag.of({ list });
});

export const layer = Layer.effect(QuestsServiceTag, make());

export type { CodeItLabQuestBoard };
