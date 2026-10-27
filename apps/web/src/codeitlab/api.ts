import { useAtomValue } from "@effect/atom-react";
import * as Result from "effect/Result";
import { useState } from "react";
import {
  WS_METHODS,
  type CodeItLabEcosystemInstallResult,
  type CodeItLabEcosystemStatus,
  type CodeItLabCredentialsModel,
  type CodeItLabCredentialsRestoreResult,
  type CodeItLabCredentialsScanInput,
  type CodeItLabCredentialsScanResult,
  type CodeItLabCredentialsSettings,
  type CodeItLabCredentialsStatus,
  type CodeItLabIntegrationList,
  type CodeItLabIntegrationPatch,
  type CodeItLabModelEndpointProbeInput,
  type CodeItLabModelEndpointProbeResult,
  type CodeItLabRemotePairingLink,
  type CodeItLabRemoteStatus,
  type CodeItLabRemoteTunnelAction,
  type EffectivePolicy,
  type MemoryEntry,
  type MemoryStats,
  type NexusCatalog,
  type PolicyProfile,
  type ReaCapability,
  type ReaStatus,
  type RoutingCatalog,
  type RoutingDecision,
  type RoutingDecideInput,
  type RoutingHealth,
  type SandboxBackendId,
  type SandboxHealth,
  type SandboxInstallInput,
  type SandboxInstallResult,
  type SandboxMachineCreateResult,
  type SandboxMachineRemoveResult,
  type SandboxMachineStartResult,
  type SandboxMachineStopResult,
  type SandboxRunResult,
  type SandboxStatus,
  type StudioProject,
  type StudioProjectInput,
} from "@codeitlab/contracts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@codeitlab/client-runtime/state/runtime";
import type { CodeItLabTask } from "@codeitlab/core/board";
import { buildCodeItLabQuestBoard, type CodeItLabQuestBoard } from "@codeitlab/core/quests";

import { connectionAtomRuntime } from "../connection/runtime";
import { usePrimaryEnvironmentId } from "../state/environments";
import { primaryEnvironmentIdAtom } from "../state/primaryEnvironment";
import { useEnvironmentQuery } from "../state/query";
import { useAtomCommand } from "../state/use-atom-command";
import { useStudioStore, type StudioStore } from "./studio/store";

/**
 * Typed client adapter for the CodeItLab feature RPCs.
 *
 * The contracts and `WS_METHODS` entries exist (packages/contracts/src/rpc.ts,
 * `codeitlab.*`); the server handlers land separately. Every read hook falls
 * back to a realistic local catalogue when the environment is missing or the
 * method is not implemented yet, and reports `source` so the panel can label
 * preview data honestly. Mutations return `null` in that state; callers keep a
 * local copy so the UI still responds.
 *
 * Wiring point: once the server handlers land, the `source === "local"`
 * branches in the pages can be deleted — these hooks already return the real
 * typed RPC result, so no call site has to change shape.
 */
export interface CodeItLabDataView<T> {
  readonly data: T;
  /** `server` once the RPC succeeds; `local` for the preview catalogue. */
  readonly source: "server" | "local";
  readonly error: string | null;
  readonly isPending: boolean;
  readonly refresh: () => void;
}

export const codeitlabNexusCatalogQuery = createEnvironmentRpcQueryAtomFamily(
  connectionAtomRuntime,
  {
    label: "codeitlab:nexus:catalog",
    tag: WS_METHODS.codeitlabNexusCatalog,
    staleTimeMs: 15_000,
    idleTtlMs: 120_000,
  },
);

export const codeitlabMemoryListQuery = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "codeitlab:memory:list",
  tag: WS_METHODS.codeitlabMemoryList,
  staleTimeMs: 5_000,
  idleTtlMs: 60_000,
});

export const codeitlabMemoryStatsQuery = createEnvironmentRpcQueryAtomFamily(
  connectionAtomRuntime,
  {
    label: "codeitlab:memory:stats",
    tag: WS_METHODS.codeitlabMemoryStats,
    staleTimeMs: 10_000,
    idleTtlMs: 120_000,
  },
);

export const codeitlabRoutingCatalogQuery = createEnvironmentRpcQueryAtomFamily(
  connectionAtomRuntime,
  {
    label: "codeitlab:routing:catalog",
    tag: WS_METHODS.codeitlabRoutingCatalog,
    staleTimeMs: 15_000,
    idleTtlMs: 120_000,
  },
);

export const codeitlabRoutingHistoryQuery = createEnvironmentRpcQueryAtomFamily(
  connectionAtomRuntime,
  {
    label: "codeitlab:routing:history",
    tag: WS_METHODS.codeitlabRoutingHistory,
    staleTimeMs: 10_000,
    idleTtlMs: 120_000,
  },
);

export const codeitlabRoutingHealthQuery = createEnvironmentRpcQueryAtomFamily(
  connectionAtomRuntime,
  {
    label: "codeitlab:routing:health",
    tag: WS_METHODS.codeitlabRoutingHealth,
    staleTimeMs: 30_000,
    idleTtlMs: 120_000,
  },
);

export const codeitlabPolicyEffectiveQuery = createEnvironmentRpcQueryAtomFamily(
  connectionAtomRuntime,
  {
    label: "codeitlab:policy:effective",
    tag: WS_METHODS.codeitlabPolicyEffective,
    staleTimeMs: 15_000,
    idleTtlMs: 120_000,
  },
);

export const codeitlabReaStatusQuery = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "codeitlab:rea:status",
  tag: WS_METHODS.codeitlabReaStatus,
  staleTimeMs: 15_000,
  idleTtlMs: 120_000,
});

export const codeitlabQuestsListQuery = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "codeitlab:quests:list",
  tag: WS_METHODS.codeitlabQuestsList,
  // The quest card is derived from every other service, so a cached answer goes
  // stale as soon as the user does anything. It is one cheap RPC; re-read it on
  // every mount instead of showing a tick that is no longer true.
  staleTimeMs: 0,
  idleTtlMs: 120_000,
});

export const codeitlabTasksListQuery = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "codeitlab:tasks:list",
  tag: WS_METHODS.codeitlabTasksList,
  staleTimeMs: 10_000,
  idleTtlMs: 120_000,
});

export const codeitlabTasksUpsertCommand = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "codeitlab:tasks:upsert",
  tag: WS_METHODS.codeitlabTasksUpsert,
});

export const codeitlabTasksRemoveCommand = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "codeitlab:tasks:remove",
  tag: WS_METHODS.codeitlabTasksRemove,
});

export const codeitlabEcosystemStatusQuery = createEnvironmentRpcQueryAtomFamily(
  connectionAtomRuntime,
  {
    label: "codeitlab:ecosystem:status",
    tag: WS_METHODS.codeitlabEcosystemStatus,
    staleTimeMs: 15_000,
    idleTtlMs: 120_000,
  },
);

export const codeitlabStudioListQuery = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "codeitlab:studio:list",
  tag: WS_METHODS.codeitlabStudioList,
  staleTimeMs: 5_000,
  idleTtlMs: 60_000,
});

export const codeitlabNexusRefreshCommand = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "codeitlab:nexus:refresh",
  tag: WS_METHODS.codeitlabNexusRefresh,
});

export const codeitlabMemoryAddCommand = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "codeitlab:memory:add",
  tag: WS_METHODS.codeitlabMemoryAdd,
});

export const codeitlabMemoryDeleteCommand = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "codeitlab:memory:delete",
  tag: WS_METHODS.codeitlabMemoryDelete,
});

export const codeitlabRoutingDecideCommand = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "codeitlab:routing:decide",
  tag: WS_METHODS.codeitlabRoutingDecide,
});

export const codeitlabRoutingCheckHealthCommand = createEnvironmentRpcCommand(
  connectionAtomRuntime,
  {
    label: "codeitlab:routing:check-health",
    tag: WS_METHODS.codeitlabRoutingCheckHealth,
  },
);

export const codeitlabPolicySetProfileCommand = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "codeitlab:policy:set-profile",
  tag: WS_METHODS.codeitlabPolicySetProfile,
});

export const codeitlabReaInstallCommand = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "codeitlab:rea:install",
  tag: WS_METHODS.codeitlabReaInstall,
});

export const codeitlabEcosystemInstallCommand = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "codeitlab:ecosystem:install",
  tag: WS_METHODS.codeitlabEcosystemInstall,
});

export const codeitlabStudioSaveCommand = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "codeitlab:studio:save",
  tag: WS_METHODS.codeitlabStudioSave,
});

export const codeitlabStudioDeleteCommand = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "codeitlab:studio:delete",
  tag: WS_METHODS.codeitlabStudioDelete,
});

export const codeitlabStudioExportCommand = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "codeitlab:studio:export",
  tag: WS_METHODS.codeitlabStudioExport,
});

export const codeitlabStudioRenderCommand = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "codeitlab:studio:render",
  tag: WS_METHODS.codeitlabStudioRender,
});

export const codeitlabRemoteStatusQuery = createEnvironmentRpcQueryAtomFamily(
  connectionAtomRuntime,
  {
    label: "codeitlab:remote:status",
    tag: WS_METHODS.codeitlabRemoteStatus,
    staleTimeMs: 5_000,
    idleTtlMs: 60_000,
  },
);

export const codeitlabRemoteCreatePairingLinkCommand = createEnvironmentRpcCommand(
  connectionAtomRuntime,
  {
    label: "codeitlab:remote:create-pairing-link",
    tag: WS_METHODS.codeitlabRemoteCreatePairingLink,
  },
);

export const codeitlabRemoteManageTunnelCommand = createEnvironmentRpcCommand(
  connectionAtomRuntime,
  {
    label: "web:codeitlab:remote:manage-tunnel",
    tag: WS_METHODS.codeitlabRemoteManageTunnel,
  },
);

export const codeitlabIntegrationsListQuery = createEnvironmentRpcQueryAtomFamily(
  connectionAtomRuntime,
  {
    label: "codeitlab:integrations:list",
    tag: WS_METHODS.codeitlabIntegrationsList,
    staleTimeMs: 10_000,
    idleTtlMs: 120_000,
  },
);

export const codeitlabIntegrationsSetCommand = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "codeitlab:integrations:set",
  tag: WS_METHODS.codeitlabIntegrationsSet,
});

export const codeitlabShortsCreateJobCommand = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "codeitlab:integrations:shorts:create-job",
  tag: WS_METHODS.codeitlabIntegrationsShortsCreateJob,
});

export const codeitlabShortsJobStatusCommand = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "codeitlab:integrations:shorts:job-status",
  tag: WS_METHODS.codeitlabIntegrationsShortsJobStatus,
});

export const codeitlabCredentialsStatusQuery = createEnvironmentRpcQueryAtomFamily(
  connectionAtomRuntime,
  {
    label: "codeitlab:credentials:status",
    tag: WS_METHODS.codeitlabCredentialsStatus,
    staleTimeMs: 5_000,
    idleTtlMs: 60_000,
  },
);

export const codeitlabCredentialsUpdateCommand = createEnvironmentRpcCommand(
  connectionAtomRuntime,
  {
    label: "codeitlab:credentials:update",
    tag: WS_METHODS.codeitlabCredentialsUpdate,
  },
);

export const codeitlabCredentialsScanCommand = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "codeitlab:credentials:scan",
  tag: WS_METHODS.codeitlabCredentialsScan,
});

export const codeitlabCredentialsRestoreCommand = createEnvironmentRpcCommand(
  connectionAtomRuntime,
  {
    label: "codeitlab:credentials:restore",
    tag: WS_METHODS.codeitlabCredentialsRestore,
  },
);

export const codeitlabCredentialsStartCommand = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "codeitlab:credentials:start",
  tag: WS_METHODS.codeitlabCredentialsStart,
});

export const codeitlabCredentialsStopCommand = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "codeitlab:credentials:stop",
  tag: WS_METHODS.codeitlabCredentialsStop,
});

export const codeitlabCredentialsDownloadModelCommand = createEnvironmentRpcCommand(
  connectionAtomRuntime,
  {
    label: "codeitlab:credentials:download-model",
    tag: WS_METHODS.codeitlabCredentialsDownloadModel,
  },
);

/**
 * Discovery for a custom OpenAI-compatible endpoint. It is a command rather than
 * a query: the answer is a point-in-time probe of someone else's gateway, and a
 * cached "it worked once" would outlive the endpoint.
 */
export const codeitlabModelsProbeEndpointCommand = createEnvironmentRpcCommand(
  connectionAtomRuntime,
  {
    label: "codeitlab:models:probe-endpoint",
    tag: WS_METHODS.codeitlabModelsProbeEndpoint,
  },
);

/**
 * The sandbox probe shells out to version commands, so its answer is a
 * point-in-time fact about this machine rather than cached catalog data.
 */
export const codeitlabSandboxStatusQuery = createEnvironmentRpcQueryAtomFamily(
  connectionAtomRuntime,
  {
    label: "codeitlab:sandbox:status",
    tag: WS_METHODS.codeitlabSandboxStatus,
    staleTimeMs: 10_000,
    idleTtlMs: 120_000,
  },
);

export const codeitlabSandboxHealthQuery = createEnvironmentRpcQueryAtomFamily(
  connectionAtomRuntime,
  {
    label: "codeitlab:sandbox:health",
    tag: WS_METHODS.codeitlabSandboxHealth,
    staleTimeMs: 10_000,
    idleTtlMs: 120_000,
  },
);

export const codeitlabSandboxInstallCommand = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "codeitlab:sandbox:install",
  tag: WS_METHODS.codeitlabSandboxInstall,
});

export const codeitlabSandboxMachineCreateCommand = createEnvironmentRpcCommand(
  connectionAtomRuntime,
  {
    label: "codeitlab:sandbox:machine-create",
    tag: WS_METHODS.codeitlabSandboxMachineCreate,
  },
);

export const codeitlabSandboxMachineRemoveCommand = createEnvironmentRpcCommand(
  connectionAtomRuntime,
  {
    label: "codeitlab:sandbox:machine-remove",
    tag: WS_METHODS.codeitlabSandboxMachineRemove,
  },
);

export const codeitlabSandboxMachineStartCommand = createEnvironmentRpcCommand(
  connectionAtomRuntime,
  {
    label: "codeitlab:sandbox:machine-start",
    tag: WS_METHODS.codeitlabSandboxMachineStart,
  },
);

export const codeitlabSandboxMachineStopCommand = createEnvironmentRpcCommand(
  connectionAtomRuntime,
  {
    label: "codeitlab:sandbox:machine-stop",
    tag: WS_METHODS.codeitlabSandboxMachineStop,
  },
);

export const codeitlabSandboxRunCommand = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "codeitlab:sandbox:run",
  tag: WS_METHODS.codeitlabSandboxRun,
});

const PREVIEW_TIMESTAMP = "2026-10-22T09:15:00.000Z";

const PREVIEW_NEXUS_CATALOG: NexusCatalog = {
  generatedAt: PREVIEW_TIMESTAMP,
  providers: [
    {
      instanceId: "hermes",
      driverKind: "acpRegistry",
      name: "Hermes ACP",
      transport: "local",
      available: true,
      skills: 12,
      sessions: 4,
      mcpServers: 3,
      detail: "hermes acp",
    },
    {
      instanceId: "claude-agent",
      driverKind: "claudeAgent",
      name: "CodeItLab Claude",
      transport: "local",
      available: true,
      skills: 8,
      sessions: 9,
      mcpServers: 2,
    },
    {
      instanceId: "codex",
      driverKind: "codex",
      name: "CodeItLabx",
      transport: "local",
      available: true,
      skills: 5,
      sessions: 6,
      mcpServers: 2,
    },
    {
      instanceId: "deepseek-harness",
      driverKind: "acpRegistry",
      name: "DeepSeek Harness",
      transport: "ssh",
      available: false,
      skills: 0,
      sessions: 0,
      mcpServers: 0,
      detail: "SSH host offline",
    },
  ],
  skills: [
    {
      id: "hermes:reverse-engineering",
      name: "reverse-engineering",
      description: "Recover behaviour and data formats from binaries and captured traffic.",
      source: "hermes",
      providerInstanceId: "hermes",
      path: "~/.hermes/skills/reverse-engineering",
      alsoAvailableIn: ["codeitlab"],
    },
    {
      id: "claude:code-review",
      name: "code-review",
      description: "Review a diff for correctness, regressions, and missing tests.",
      source: "claude",
      providerInstanceId: "claude-agent",
      alsoAvailableIn: ["codeitlab"],
    },
    {
      id: "hermes:memory-curator",
      name: "memory-curator",
      description: "Extract durable facts and preferences from a finished turn.",
      source: "hermes",
      providerInstanceId: "hermes",
      alsoAvailableIn: [],
    },
    {
      id: "codex:test-author",
      name: "test-author",
      description: "Write focused tests for a behaviour change.",
      source: "codex",
      providerInstanceId: "codex",
      alsoAvailableIn: ["codeitlab"],
    },
    {
      id: "filesystem:frontend-design",
      name: "frontend-design",
      description: "Apply the project's visual language to new UI surfaces.",
      source: "filesystem",
      alsoAvailableIn: ["hermes"],
    },
  ],
  mcpServers: [
    {
      id: "rea",
      name: "REA",
      transport: "stdio",
      command: "npx",
      args: ["-y", "rea-agents@6.7.0", "mcp"],
      envKeys: [],
      sources: ["codeitlab", "hermes"],
      enabled: true,
      tools: ["rea_analyze", "rea_doctor", "rea_plan"],
    },
    {
      id: "filesystem",
      name: "Filesystem",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem"],
      envKeys: ["ALLOWED_ROOTS"],
      sources: ["claude"],
      enabled: true,
      tools: ["read_file", "write_file", "list_directory"],
    },
    {
      id: "git",
      name: "Git",
      transport: "stdio",
      command: "uvx",
      args: ["mcp-server-git"],
      envKeys: [],
      sources: ["codex"],
      enabled: true,
      tools: ["status", "diff", "log"],
    },
  ],
  sessions: [
    {
      id: "hermes-session-7f2a",
      providerInstanceId: "hermes",
      providerKind: "acpRegistry",
      title: "Rework the settings shell",
      updatedAt: "2026-10-22T08:40:00.000Z",
      cwd: "/Users/dev/codeitlab",
      messageCount: 24,
      remote: false,
    },
    {
      id: "claude-session-19c3",
      providerInstanceId: "claude-agent",
      providerKind: "claudeAgent",
      title: "Investigate flaky checkpoint test",
      updatedAt: "2026-10-21T18:05:00.000Z",
      cwd: "/Users/dev/codeitlab",
      messageCount: 41,
      remote: false,
    },
    {
      id: "codex-session-51bd",
      providerInstanceId: "codex",
      providerKind: "codex",
      title: "Nexus catalog dedupe",
      updatedAt: "2026-10-21T12:22:00.000Z",
      messageCount: 17,
      remote: true,
    },
  ],
  warnings: ["DeepSeek Harness over SSH is unreachable; cached entries are shown."],
};

const PREVIEW_MEMORY_ENTRIES: ReadonlyArray<MemoryEntry> = [
  {
    id: "mem-1",
    scope: "project",
    projectId: "codeitlab",
    kind: "preference",
    text: "Prefer targeted typecheck + focused tests over repo-wide checks.",
    source: "turn",
    createdAt: "2026-10-20T10:12:00.000Z",
    updatedAt: "2026-10-20T10:12:00.000Z",
    recalls: 6,
    tags: ["workflow", "verification"],
    confidence: 0.92,
  },
  {
    id: "mem-2",
    scope: "global",
    projectId: null,
    kind: "fact",
    text: "The web app uses React Compiler; manual useMemo/useCallback are lint errors.",
    source: "turn",
    createdAt: "2026-10-19T16:44:00.000Z",
    updatedAt: "2026-10-19T16:44:00.000Z",
    recalls: 11,
    tags: ["web", "react"],
    confidence: 0.97,
  },
  {
    id: "mem-3",
    scope: "project",
    projectId: "codeitlab",
    kind: "decision",
    text: "3D scenes stay out of the main bundle and pause whenever the canvas is offscreen.",
    source: "manual",
    createdAt: "2026-10-21T09:03:00.000Z",
    updatedAt: "2026-10-21T09:03:00.000Z",
    recalls: 2,
    tags: ["performance", "three"],
    confidence: 0.88,
  },
  {
    id: "mem-4",
    scope: "global",
    projectId: null,
    kind: "convention",
    text: "Never kill a dev server by pattern; track the PID you spawned.",
    source: "import",
    createdAt: "2026-10-18T13:30:00.000Z",
    updatedAt: "2026-10-18T13:30:00.000Z",
    recalls: 4,
    tags: ["ops"],
    confidence: 0.95,
  },
];

const PREVIEW_MEMORY_STATS: MemoryStats = {
  total: 128,
  global: 41,
  project: 87,
  byKind: {
    fact: 52,
    preference: 31,
    decision: 22,
    convention: 15,
    gotcha: 5,
    "session-summary": 3,
  },
  lastExtractionAt: "2026-10-22T08:55:00.000Z",
};

const PREVIEW_ROUTING_CATALOG: RoutingCatalog = {
  mode: "auto",
  providers: [
    {
      providerInstanceId: "hermes",
      providerKind: "acpRegistry",
      name: "Hermes ACP",
      models: ["deepseek-v4", "qwen3-coder"],
      available: true,
      quota: 0.72,
      speed: 0.64,
      smartness: 0.88,
    },
    {
      providerInstanceId: "claude-agent",
      providerKind: "claudeAgent",
      name: "CodeItLab Claude",
      models: ["claude-sonnet-4-6", "claude-opus-4-6"],
      available: true,
      quota: 0.38,
      speed: 0.55,
      smartness: 0.95,
    },
    {
      providerInstanceId: "codex",
      providerKind: "codex",
      name: "CodeItLabx",
      models: ["gpt-5.4-codex", "gpt-5.4"],
      available: true,
      quota: 0.84,
      speed: 0.78,
      smartness: 0.86,
    },
  ],
  omniRouteModels: [
    "auto/best-coding",
    "auto/best-reasoning",
    "auto/best-fast",
    "auto/best-vision",
    "auto/best-chat",
    "auto/cheap",
  ],
};

const PREVIEW_ROUTING_HISTORY: ReadonlyArray<RoutingDecision> = [
  {
    id: "route-1",
    decidedAt: "2026-10-22T08:41:00.000Z",
    taskClass: "coding",
    providerInstanceId: "codex",
    providerKind: "codex",
    model: "gpt-5.4-codex",
    reason: "Coding task with healthy quota; fastest available coding model.",
    candidates: [
      {
        providerInstanceId: "codex",
        providerKind: "codex",
        model: "gpt-5.4-codex",
        quota: 0.84,
        smartness: 0.86,
        speed: 0.78,
        score: 0.83,
        available: true,
      },
      {
        providerInstanceId: "hermes",
        providerKind: "acpRegistry",
        model: "deepseek-v4",
        quota: 0.72,
        smartness: 0.88,
        speed: 0.64,
        score: 0.76,
        available: true,
      },
    ],
  },
  {
    id: "route-2",
    decidedAt: "2026-10-21T19:12:00.000Z",
    taskClass: "reasoning",
    providerInstanceId: "claude-agent",
    providerKind: "claudeAgent",
    model: "claude-opus-4-6",
    reason: "Deep reasoning request; smartness weight dominates and quota allows it.",
    candidates: [
      {
        providerInstanceId: "claude-agent",
        providerKind: "claudeAgent",
        model: "claude-opus-4-6",
        quota: 0.38,
        smartness: 0.95,
        speed: 0.55,
        score: 0.71,
        available: true,
      },
    ],
  },
];

const PREVIEW_POLICY: EffectivePolicy = {
  profile: "standard",
  appliedTo: [],
  unsupported: [],
  instructionBlock: "",
  limitations: [
    "CodeItLab can only change the instructions it adds to a turn.",
    "Upstream provider policies still apply and may refuse a request.",
    "Some providers do not accept instruction overrides; the panel lists them as unsupported.",
  ],
};

const PREVIEW_REA: ReaStatus = {
  installed: true,
  version: "6.7.0",
  mcpCommand: "npx",
  mcpArgs: ["-y", "rea-agents@6.7.0", "mcp"],
  mcpServerId: "rea",
  skillInstalled: true,
  skillPath: "~/.cil/codeitlab/skills/rea",
  autoActivate: true,
  health: [
    { name: "package", ok: true, detail: "rea-agents@6.7.0 resolvable", remediation: "" },
    { name: "mcp", ok: true, detail: "stdio server responds", remediation: "" },
    { name: "skill", ok: true, detail: "seeded in app-managed skills", remediation: "" },
    {
      name: "doctor",
      ok: false,
      detail: "no auth token for hosted analysis",
      remediation: "Run `npx -y rea-agents@6.7.0 auth login`.",
    },
  ],
  checkedAt: "2026-10-22T08:58:00.000Z",
};

const PREVIEW_REA_CAPABILITIES: ReadonlyArray<ReaCapability> = [
  {
    id: "binary-analysis",
    title: "Binary analysis",
    description: "Disassemble, decompile, and explain native binaries and firmware.",
    sideEffects: ["Runs local analysis tools", "Writes scratch files under the workspace"],
  },
  {
    id: "protocol-recovery",
    title: "Protocol recovery",
    description: "Recover request/response formats from captures and client code.",
    sideEffects: ["Reads captured traffic you provide"],
  },
  {
    id: "dependency-audit",
    title: "Dependency audit",
    description: "Trace transitive dependencies and flag risky behaviour.",
    sideEffects: ["Reads lockfiles and package metadata"],
  },
  {
    id: "app-exploration",
    title: "App exploration",
    description: "Map an unfamiliar app's surfaces and state before changing them.",
    sideEffects: ["Reads source and screenshots"],
  },
];

const PREVIEW_ECOSYSTEM: CodeItLabEcosystemStatus = {
  generatedAt: PREVIEW_TIMESTAMP,
  integrations: [
    {
      id: "graft",
      name: "Graft",
      kind: "mcp",
      enabled: true,
      mode: "auto",
      version: "0.21.1",
      available: false,
      detail: "Preview — server wiring is still landing.",
      warnings: [],
    },
    {
      id: "ponytail",
      name: "Ponytail",
      kind: "policy-pack",
      enabled: true,
      mode: "full",
      version: "5.1.1",
      available: false,
      detail: "Preview — server wiring is still landing.",
      warnings: [],
    },
    {
      id: "terse",
      name: "Caveman / terse",
      kind: "policy-pack",
      enabled: true,
      mode: "full",
      available: false,
      detail: "Preview — server wiring is still landing.",
      warnings: [],
    },
  ],
  warnings: [],
};

function errorText(error: string | null): string | null {
  return error !== null && error.trim().length > 0 ? error : null;
}

export function useCodeItLabNexus(): CodeItLabDataView<NexusCatalog> {
  const environmentId = usePrimaryEnvironmentId();
  const query = useEnvironmentQuery(
    environmentId === null ? null : codeitlabNexusCatalogQuery({ environmentId, input: {} }),
  );
  return {
    data: query.data ?? PREVIEW_NEXUS_CATALOG,
    source: query.data === null ? "local" : "server",
    error: errorText(query.error),
    isPending: query.isPending,
    refresh: query.refresh,
  };
}

export function useCodeItLabMemory(): CodeItLabDataView<ReadonlyArray<MemoryEntry>> & {
  readonly stats: MemoryStats;
  readonly add: (input: {
    readonly scope: "global" | "project";
    readonly projectId?: string | null;
    readonly kind: MemoryEntry["kind"];
    readonly text: string;
    readonly tags?: ReadonlyArray<string>;
  }) => Promise<MemoryEntry | null>;
  readonly remove: (id: string) => Promise<boolean>;
} {
  const environmentId = usePrimaryEnvironmentId();
  const list = useEnvironmentQuery(
    environmentId === null
      ? null
      : codeitlabMemoryListQuery({ environmentId, input: { limit: 200 } }),
  );
  const stats = useEnvironmentQuery(
    environmentId === null ? null : codeitlabMemoryStatsQuery({ environmentId, input: {} }),
  );
  const addCommand = useAtomCommand(codeitlabMemoryAddCommand, { reportFailure: false });
  const deleteCommand = useAtomCommand(codeitlabMemoryDeleteCommand, { reportFailure: false });
  const add = async (input: {
    readonly scope: "global" | "project";
    readonly projectId?: string | null;
    readonly kind: MemoryEntry["kind"];
    readonly text: string;
    readonly tags?: ReadonlyArray<string>;
  }): Promise<MemoryEntry | null> => {
    if (environmentId === null) return null;
    const result = await addCommand({
      environmentId,
      input: {
        ...input,
        ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
        ...(input.tags === undefined ? {} : { tags: [...input.tags] }),
      },
    });
    if (result._tag !== "Success") return null;
    list.refresh();
    stats.refresh();
    return result.value;
  };
  const remove = async (id: string): Promise<boolean> => {
    if (environmentId === null) return false;
    const result = await deleteCommand({ environmentId, input: { id } });
    if (result._tag !== "Success") return false;
    list.refresh();
    stats.refresh();
    return true;
  };
  return {
    data: list.data ?? PREVIEW_MEMORY_ENTRIES,
    stats: stats.data ?? PREVIEW_MEMORY_STATS,
    source: list.data === null ? "local" : "server",
    error: errorText(list.error),
    isPending: list.isPending,
    refresh: list.refresh,
    add,
    remove,
  };
}

const PREVIEW_ROUTING_HEALTH: RoutingHealth = {
  checkedAt: "2026-10-22T09:00:00.000Z",
  intervalMinutes: 30,
  nextCheckAt: "2026-10-22T09:30:00.000Z",
  source: "scheduled",
  entries: [
    {
      providerInstanceId: "hermes",
      providerKind: "acpRegistry",
      name: "Hermes ACP",
      ok: true,
      status: "ok",
      quota: 0.72,
      latencyMs: 1840,
      models: 2899,
    },
    {
      providerInstanceId: "codex",
      providerKind: "codex",
      name: "CodeItLabx",
      ok: false,
      status: "missing",
      quota: 1,
      models: 0,
      detail: "Codex binary is not installed.",
    },
  ],
};

export function useCodeItLabRouting(): CodeItLabDataView<RoutingCatalog> & {
  readonly history: ReadonlyArray<RoutingDecision>;
  readonly health: RoutingHealth;
  readonly healthSource: "local" | "server";
  readonly healthIsPending: boolean;
  readonly refreshHealth: () => void;
  readonly checkHealth: () => Promise<RoutingHealth | null>;
  readonly decide: (input: RoutingDecideInput) => Promise<RoutingDecision | null>;
} {
  const environmentId = usePrimaryEnvironmentId();
  const catalog = useEnvironmentQuery(
    environmentId === null ? null : codeitlabRoutingCatalogQuery({ environmentId, input: {} }),
  );
  const history = useEnvironmentQuery(
    environmentId === null
      ? null
      : codeitlabRoutingHistoryQuery({ environmentId, input: { limit: 20 } }),
  );
  const health = useEnvironmentQuery(
    environmentId === null ? null : codeitlabRoutingHealthQuery({ environmentId, input: {} }),
  );
  const decideCommand = useAtomCommand(codeitlabRoutingDecideCommand, { reportFailure: false });
  const checkHealthCommand = useAtomCommand(codeitlabRoutingCheckHealthCommand, {
    reportFailure: false,
  });
  const decide = async (input: RoutingDecideInput): Promise<RoutingDecision | null> => {
    if (environmentId === null) return null;
    const result = await decideCommand({ environmentId, input });
    if (result._tag !== "Success") return null;
    history.refresh();
    return result.value;
  };
  const checkHealth = async (): Promise<RoutingHealth | null> => {
    if (environmentId === null) return null;
    const result = await checkHealthCommand({ environmentId, input: {} });
    if (result._tag !== "Success") return null;
    health.refresh();
    return result.value;
  };
  return {
    data: catalog.data ?? PREVIEW_ROUTING_CATALOG,
    history: history.data ?? PREVIEW_ROUTING_HISTORY,
    health: health.data ?? PREVIEW_ROUTING_HEALTH,
    healthSource: health.data === null ? "local" : "server",
    healthIsPending: health.isPending,
    refreshHealth: health.refresh,
    checkHealth,
    source: catalog.data === null ? "local" : "server",
    error: errorText(catalog.error),
    isPending: catalog.isPending,
    refresh: catalog.refresh,
    decide,
  };
}

export function useCodeItLabPolicy(): CodeItLabDataView<EffectivePolicy> & {
  readonly setProfile: (profile: PolicyProfile) => Promise<EffectivePolicy | null>;
} {
  const environmentId = usePrimaryEnvironmentId();
  const query = useEnvironmentQuery(
    environmentId === null ? null : codeitlabPolicyEffectiveQuery({ environmentId, input: {} }),
  );
  const setProfileCommand = useAtomCommand(codeitlabPolicySetProfileCommand, {
    reportFailure: false,
  });
  const setProfile = async (profile: PolicyProfile): Promise<EffectivePolicy | null> => {
    if (environmentId === null) return null;
    const result = await setProfileCommand({ environmentId, input: { profile } });
    if (result._tag !== "Success") return null;
    query.refresh();
    return result.value;
  };
  return {
    data: query.data ?? PREVIEW_POLICY,
    source: query.data === null ? "local" : "server",
    error: errorText(query.error),
    isPending: query.isPending,
    refresh: query.refresh,
    setProfile,
  };
}

export function useCodeItLabRea(): CodeItLabDataView<ReaStatus> & {
  readonly capabilities: ReadonlyArray<ReaCapability>;
  readonly install: () => Promise<ReaStatus | null>;
} {
  const environmentId = usePrimaryEnvironmentId();
  const query = useEnvironmentQuery(
    environmentId === null ? null : codeitlabReaStatusQuery({ environmentId, input: {} }),
  );
  const installCommand = useAtomCommand(codeitlabReaInstallCommand, { reportFailure: false });
  const install = async (): Promise<ReaStatus | null> => {
    if (environmentId === null) return null;
    const result = await installCommand({ environmentId, input: {} });
    if (result._tag !== "Success") return null;
    query.refresh();
    return result.value;
  };
  return {
    data: query.data ?? PREVIEW_REA,
    capabilities: PREVIEW_REA_CAPABILITIES,
    source: query.data === null ? "local" : "server",
    error: errorText(query.error),
    isPending: query.isPending,
    refresh: query.refresh,
    install,
  };
}

const PREVIEW_QUESTS: CodeItLabQuestBoard = buildCodeItLabQuestBoard({
  agentsInstalled: 0,
  modelsConfigured: 0,
  memoryEntries: 0,
  reaInstalled: false,
  studioProjects: 0,
  studioVideos: 0,
  integrationsConfigured: 0,
  remoteReachable: false,
  credentialsActive: false,
  boardTasks: 0,
  boardCompleted: 0,
});

/**
 * Board tasks from the database. `source` says which copy answered: `server`
 * means the database, `local` means the query has not answered yet and the
 * caller should fall back to the settings copy.
 */
export function useCodeItLabTasks(): CodeItLabDataView<ReadonlyArray<CodeItLabTask>> & {
  readonly upsert: (task: CodeItLabTask) => Promise<CodeItLabTask | null>;
  readonly remove: (id: string) => Promise<boolean>;
} {
  const environmentId = usePrimaryEnvironmentId();
  const query = useEnvironmentQuery(
    environmentId === null ? null : codeitlabTasksListQuery({ environmentId, input: {} }),
  );
  const upsertCommand = useAtomCommand(codeitlabTasksUpsertCommand, { reportFailure: false });
  const removeCommand = useAtomCommand(codeitlabTasksRemoveCommand, { reportFailure: false });
  return {
    data: query.data?.tasks ?? [],
    source: query.data === null ? "local" : "server",
    error: errorText(query.error),
    isPending: query.isPending,
    refresh: query.refresh,
    upsert: async (task) => {
      if (environmentId === null) return null;
      const result = await upsertCommand({ environmentId, input: { task } });
      if (result._tag !== "Success") return null;
      query.refresh();
      return result.value.task;
    },
    remove: async (id) => {
      if (environmentId === null) return false;
      const result = await removeCommand({ environmentId, input: { id } });
      if (result._tag !== "Success") return false;
      query.refresh();
      return result.value.removed;
    },
  };
}

export function useCodeItLabQuests(): CodeItLabDataView<CodeItLabQuestBoard> {
  const environmentId = usePrimaryEnvironmentId();
  const query = useEnvironmentQuery(
    environmentId === null ? null : codeitlabQuestsListQuery({ environmentId, input: {} }),
  );
  return {
    data: query.data ?? PREVIEW_QUESTS,
    source: query.data === null ? "local" : "server",
    error: errorText(query.error),
    isPending: query.isPending,
    refresh: query.refresh,
  };
}

export function useCodeItLabEcosystem(): CodeItLabDataView<CodeItLabEcosystemStatus> & {
  readonly install: () => Promise<CodeItLabEcosystemInstallResult | null>;
} {
  const environmentId = usePrimaryEnvironmentId();
  const query = useEnvironmentQuery(
    environmentId === null ? null : codeitlabEcosystemStatusQuery({ environmentId, input: {} }),
  );
  const installCommand = useAtomCommand(codeitlabEcosystemInstallCommand, {
    reportFailure: false,
  });
  const install = async (): Promise<CodeItLabEcosystemInstallResult | null> => {
    if (environmentId === null) return null;
    const result = await installCommand({ environmentId, input: {} });
    if (result._tag !== "Success") return null;
    query.refresh();
    return result.value;
  };
  return {
    data: query.data ?? PREVIEW_ECOSYSTEM,
    source: query.data === null ? "local" : "server",
    error: errorText(query.error),
    isPending: query.isPending,
    refresh: query.refresh,
    install,
  };
}

export function useCodeItLabNexusRefresh(): () => Promise<NexusCatalog | null> {
  const environmentId = usePrimaryEnvironmentId();
  const command = useAtomCommand(codeitlabNexusRefreshCommand, { reportFailure: false });
  return async () => {
    if (environmentId === null) return null;
    const result = await command({ environmentId, input: {} });
    return result._tag === "Success" ? result.value : null;
  };
}

/** Reads the primary environment id without starting a query. */
export function useCodeItLabEnvironmentId() {
  return useAtomValue(primaryEnvironmentIdAtom);
}

/**
 * Studio data. The server is authoritative once it answers; until the list
 * query succeeds (no environment, or a server without the Studio RPC) the hook
 * falls back to the local-first store so the tab still works offline.
 */
export function useCodeItLabStudio(): StudioStore {
  const environmentId = usePrimaryEnvironmentId();
  const query = useEnvironmentQuery(
    environmentId === null ? null : codeitlabStudioListQuery({ environmentId, input: {} }),
  );
  const local = useStudioStore();
  const saveCommand = useAtomCommand(codeitlabStudioSaveCommand, { reportFailure: false });
  const deleteCommand = useAtomCommand(codeitlabStudioDeleteCommand, { reportFailure: false });
  const exportCommand = useAtomCommand(codeitlabStudioExportCommand, { reportFailure: false });

  const server = query.data !== null;

  const save = async (input: StudioProjectInput): Promise<StudioProject> => {
    if (!server || environmentId === null) return local.save(input);
    const result = await saveCommand({ environmentId, input: { project: input } });
    if (result._tag !== "Success") throw squashAtomCommandFailure(result);
    query.refresh();
    return result.value;
  };

  const remove = async (id: string): Promise<boolean> => {
    if (!server || environmentId === null) return local.remove(id);
    const result = await deleteCommand({ environmentId, input: { id } });
    if (result._tag !== "Success") throw squashAtomCommandFailure(result);
    query.refresh();
    return result.value.deleted;
  };

  const exportProject = async (id: string) => {
    if (!server || environmentId === null) return local.exportProject(id);
    const result = await exportCommand({ environmentId, input: { id } });
    if (result._tag !== "Success") throw squashAtomCommandFailure(result);
    return result.value;
  };

  return {
    projects: server ? query.data.projects : local.projects,
    source: server ? "server" : "local",
    error: query.error,
    isLoading: query.isPending,
    refresh: query.refresh,
    save,
    remove,
    exportProject,
  };
}

const PREVIEW_REMOTE: CodeItLabRemoteStatus = {
  tailnet: {
    available: false,
    running: false,
    detail: "Preview — server wiring is still landing.",
  },
  server: {
    host: "127.0.0.1",
    port: 0,
    loopbackOnly: true,
    urls: [],
  },
  tunnel: {
    available: false,
    running: false,
    detail: "Preview — server wiring is still landing.",
  },
  pairingAvailable: false,
  detail: "Preview — the remote status RPC has not answered yet.",
};

export function useCodeItLabRemote(): CodeItLabDataView<CodeItLabRemoteStatus> & {
  readonly createPairingLink: () => Promise<CodeItLabRemotePairingLink | null>;
  readonly manageTunnel: (
    action: CodeItLabRemoteTunnelAction,
  ) => Promise<CodeItLabRemoteStatus | null>;
} {
  const environmentId = usePrimaryEnvironmentId();
  const query = useEnvironmentQuery(
    environmentId === null ? null : codeitlabRemoteStatusQuery({ environmentId, input: {} }),
  );
  const createLink = useAtomCommand(codeitlabRemoteCreatePairingLinkCommand, {
    reportFailure: false,
  });
  const manageTunnelCommand = useAtomCommand(codeitlabRemoteManageTunnelCommand, {
    reportFailure: false,
  });

  return {
    data: query.data ?? PREVIEW_REMOTE,
    source: query.data === null ? "local" : "server",
    error: errorText(query.error),
    isPending: query.isPending,
    refresh: query.refresh,
    createPairingLink: async () => {
      if (environmentId === null) return null;
      const result = await createLink({ environmentId, input: {} });
      if (result._tag !== "Success") throw squashAtomCommandFailure(result);
      return result.value;
    },
    manageTunnel: async (action) => {
      if (environmentId === null) return null;
      const result = await manageTunnelCommand({ environmentId, input: { action } });
      if (result._tag !== "Success") throw squashAtomCommandFailure(result);
      query.refresh();
      return result.value;
    },
  };
}

const PREVIEW_INTEGRATIONS: CodeItLabIntegrationList = {
  integrations: [
    {
      id: "shorts",
      name: "Shorts",
      tagline: "Turn a long video into vertical clips without leaving CodeItLab.",
      engine: "OpenShorts",
      enabled: true,
      configured: false,
      state: "not-configured",
      reachable: false,
      detail: "Preview — server wiring is still landing.",
      wired: [],
      actions: [],
    },
    {
      id: "crew",
      name: "Crew",
      tagline: "Persistent teammate bots with their own memory and routines.",
      engine: "Rakazo",
      enabled: true,
      configured: false,
      state: "not-configured",
      reachable: false,
      detail: "Preview — server wiring is still landing.",
      wired: [],
      actions: [],
    },
    {
      id: "search",
      name: "Search",
      tagline: "Free web and X search for models that have none, with failover.",
      engine: "ModSearch",
      enabled: true,
      configured: false,
      state: "not-configured",
      reachable: false,
      detail: "Preview — server wiring is still landing.",
      wired: [],
      actions: [],
    },
  ],
  wired: { mcpServers: [], skills: [] },
};

export function useCodeItLabIntegrations(): CodeItLabDataView<CodeItLabIntegrationList> & {
  readonly set: (patch: CodeItLabIntegrationPatch) => Promise<CodeItLabIntegrationList | null>;
} {
  const environmentId = usePrimaryEnvironmentId();
  const query = useEnvironmentQuery(
    environmentId === null ? null : codeitlabIntegrationsListQuery({ environmentId, input: {} }),
  );
  const setCommand = useAtomCommand(codeitlabIntegrationsSetCommand, { reportFailure: false });

  return {
    data: query.data ?? PREVIEW_INTEGRATIONS,
    source: query.data === null ? "local" : "server",
    error: errorText(query.error),
    isPending: query.isPending,
    refresh: query.refresh,
    set: async (patch) => {
      if (environmentId === null) return null;
      const result = await setCommand({ environmentId, input: { patch } });
      if (result._tag !== "Success") throw squashAtomCommandFailure(result);
      query.refresh();
      return result.value;
    },
  };
}

const PREVIEW_CREDENTIALS: CodeItLabCredentialsStatus = {
  enabled: true,
  running: false,
  port: 5284,
  gatewayUrl: "http://127.0.0.1:5284/v1",
  mode: "balanced",
  privateTag: "mask",
  model: {
    id: "codeitlab-tiny-credentials",
    label: "CodeItLab Tiny Credentials",
    version: "1.0.0",
    sizeBytes: 8233,
    state: "bundled",
  },
  scanned: 0,
  maskedValues: 0,
  blocked: 0,
  audit: [],
};

export function useCodeItLabCredentials(): CodeItLabDataView<CodeItLabCredentialsStatus> & {
  readonly update: (
    settings: CodeItLabCredentialsSettings,
  ) => Promise<CodeItLabCredentialsStatus | null>;
  readonly scan: (
    input: CodeItLabCredentialsScanInput,
  ) => Promise<CodeItLabCredentialsScanResult | null>;
  readonly restore: (text: string) => Promise<CodeItLabCredentialsRestoreResult | null>;
  readonly start: () => Promise<CodeItLabCredentialsStatus | null>;
  readonly stop: () => Promise<CodeItLabCredentialsStatus | null>;
  readonly downloadModel: () => Promise<CodeItLabCredentialsModel | null>;
} {
  const environmentId = usePrimaryEnvironmentId();
  const query = useEnvironmentQuery(
    environmentId === null ? null : codeitlabCredentialsStatusQuery({ environmentId, input: {} }),
  );
  const updateCommand = useAtomCommand(codeitlabCredentialsUpdateCommand, { reportFailure: false });
  const scanCommand = useAtomCommand(codeitlabCredentialsScanCommand, { reportFailure: false });
  const restoreCommand = useAtomCommand(codeitlabCredentialsRestoreCommand, {
    reportFailure: false,
  });
  const startCommand = useAtomCommand(codeitlabCredentialsStartCommand, { reportFailure: false });
  const stopCommand = useAtomCommand(codeitlabCredentialsStopCommand, { reportFailure: false });
  const downloadModelCommand = useAtomCommand(codeitlabCredentialsDownloadModelCommand, {
    reportFailure: false,
  });

  const refresh = () => {
    query.refresh();
  };

  return {
    data: query.data ?? PREVIEW_CREDENTIALS,
    source: query.data === null ? "local" : "server",
    error: errorText(query.error),
    isPending: query.isPending,
    refresh,
    update: async (settings) => {
      if (environmentId === null) return null;
      const result = await updateCommand({ environmentId, input: { settings } });
      if (result._tag !== "Success") throw squashAtomCommandFailure(result);
      refresh();
      return result.value;
    },
    scan: async (input) => {
      if (environmentId === null) return null;
      const result = await scanCommand({ environmentId, input });
      if (result._tag !== "Success") throw squashAtomCommandFailure(result);
      refresh();
      return result.value;
    },
    restore: async (text) => {
      if (environmentId === null) return null;
      const result = await restoreCommand({ environmentId, input: { text } });
      if (result._tag !== "Success") throw squashAtomCommandFailure(result);
      return result.value;
    },
    start: async () => {
      if (environmentId === null) return null;
      const result = await startCommand({ environmentId, input: {} });
      if (result._tag !== "Success") throw squashAtomCommandFailure(result);
      refresh();
      return result.value;
    },
    stop: async () => {
      if (environmentId === null) return null;
      const result = await stopCommand({ environmentId, input: {} });
      if (result._tag !== "Success") throw squashAtomCommandFailure(result);
      refresh();
      return result.value;
    },
    downloadModel: async () => {
      if (environmentId === null) return null;
      const result = await downloadModelCommand({ environmentId, input: {} });
      if (result._tag !== "Success") throw squashAtomCommandFailure(result);
      refresh();
      return result.value;
    },
  };
}

/**
 * Asks the server to fetch `{baseUrl}/models` for a custom endpoint.
 *
 * Returns `null` when no environment is connected; the page says so instead of
 * rendering an empty model list that looks like a working endpoint.
 */
export function useCodeItLabModelEndpointProbe(): (
  input: CodeItLabModelEndpointProbeInput,
) => Promise<CodeItLabModelEndpointProbeResult | null> {
  const environmentId = usePrimaryEnvironmentId();
  const probeCommand = useAtomCommand(codeitlabModelsProbeEndpointCommand, {
    reportFailure: false,
  });
  return async (input) => {
    if (environmentId === null) return null;
    const result = await probeCommand({ environmentId, input });
    return result._tag === "Success" ? result.value : null;
  };
}

export interface CodeItLabSandboxView {
  /**
   * `null` until the probe answers; `Failure` carries the probe error so the
   * page can say the check failed instead of rendering a matrix it does not know.
   */
  readonly status: Result.Result<SandboxStatus, string> | null;
  readonly refresh: () => void;
  readonly install: (input: SandboxInstallInput) => Promise<SandboxInstallResult | null>;
}

export function useCodeItLabSandbox(): CodeItLabSandboxView {
  const environmentId = usePrimaryEnvironmentId();
  const query = useEnvironmentQuery(
    environmentId === null ? null : codeitlabSandboxStatusQuery({ environmentId, input: {} }),
  );
  const installCommand = useAtomCommand(codeitlabSandboxInstallCommand, { reportFailure: false });
  const status: Result.Result<SandboxStatus, string> | null =
    query.data !== null
      ? Result.succeed(query.data)
      : query.error !== null
        ? Result.fail(query.error)
        : null;
  return {
    status,
    refresh: query.refresh,
    install: async (input) => {
      if (environmentId === null) return null;
      const result = await installCommand({ environmentId, input });
      if (result._tag !== "Success") return null;
      query.refresh();
      return result.value;
    },
  };
}

export interface CodeItLabSandboxHealthView {
  /** `null` until the health probe answers; `Failure` carries the probe error. */
  readonly health: Result.Result<SandboxHealth, string> | null;
  readonly refresh: () => void;
}

export function useCodeItLabSandboxHealth(): CodeItLabSandboxHealthView {
  const environmentId = usePrimaryEnvironmentId();
  const query = useEnvironmentQuery(
    environmentId === null ? null : codeitlabSandboxHealthQuery({ environmentId, input: {} }),
  );
  const health: Result.Result<SandboxHealth, string> | null =
    query.data !== null
      ? Result.succeed(query.data)
      : query.error !== null
        ? Result.fail(query.error)
        : null;
  return { health, refresh: query.refresh };
}

type SandboxMachineAction = "create" | "remove" | "start" | "stop" | "run";

export interface SandboxMachineActionsView {
  readonly create: (backend: SandboxBackendId) => Promise<SandboxMachineCreateResult | null>;
  readonly remove: () => Promise<SandboxMachineRemoveResult | null>;
  readonly start: (backend: SandboxBackendId) => Promise<SandboxMachineStartResult | null>;
  readonly stop: () => Promise<SandboxMachineStopResult | null>;
  readonly run: (command: string) => Promise<SandboxRunResult | null>;
  readonly pending: SandboxMachineAction | null;
  readonly error: string | null;
}

/**
 * Machine mutations for the Setup page. They deliberately do not refresh the
 * health query themselves: the page owns the refresh so a failed create does
 * not look like a successful state change.
 */
export function useSandboxMachineActions(): SandboxMachineActionsView {
  const environmentId = usePrimaryEnvironmentId();
  const createCommand = useAtomCommand(codeitlabSandboxMachineCreateCommand, {
    reportFailure: false,
  });
  const removeCommand = useAtomCommand(codeitlabSandboxMachineRemoveCommand, {
    reportFailure: false,
  });
  const startCommand = useAtomCommand(codeitlabSandboxMachineStartCommand, {
    reportFailure: false,
  });
  const stopCommand = useAtomCommand(codeitlabSandboxMachineStopCommand, {
    reportFailure: false,
  });
  const runCommand = useAtomCommand(codeitlabSandboxRunCommand, { reportFailure: false });
  const [pending, setPending] = useState<SandboxMachineAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  const perform = async <A>(
    action: SandboxMachineAction,
    execute: () => Promise<AtomCommandResult<A, unknown>>,
  ): Promise<A | null> => {
    setPending(action);
    setError(null);
    try {
      const result = await execute();
      if (result._tag !== "Success") {
        const failure = squashAtomCommandFailure(result);
        setError(
          failure instanceof Error && failure.message.trim().length > 0
            ? failure.message
            : "The sandbox request failed.",
        );
        return null;
      }
      return result.value;
    } finally {
      setPending(null);
    }
  };

  const missingEnvironment = (): null => {
    setError("No environment is connected.");
    return null;
  };

  return {
    pending,
    error,
    create: (backend) => {
      if (environmentId === null) return Promise.resolve(missingEnvironment());
      return perform("create", () =>
        createCommand({ environmentId, input: { backend, consent: true } }),
      );
    },
    remove: () => {
      if (environmentId === null) return Promise.resolve(missingEnvironment());
      return perform("remove", () => removeCommand({ environmentId, input: { consent: true } }));
    },
    start: (backend) => {
      if (environmentId === null) return Promise.resolve(missingEnvironment());
      return perform("start", () =>
        startCommand({ environmentId, input: { backend, consent: true } }),
      );
    },
    stop: () => {
      if (environmentId === null) return Promise.resolve(missingEnvironment());
      return perform("stop", () => stopCommand({ environmentId, input: { consent: true } }));
    },
    run: (command) => {
      if (environmentId === null) return Promise.resolve(missingEnvironment());
      return perform("run", () => runCommand({ environmentId, input: { command } }));
    },
  };
}
