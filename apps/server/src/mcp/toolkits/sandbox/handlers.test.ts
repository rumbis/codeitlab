import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  CodeItLabServiceError,
  type ProviderInteractionMode,
  type RuntimeMode,
  type SandboxHealth,
  type SandboxRunInput,
  type SandboxRunResult,
  type SandboxSyncInput,
  type SandboxSyncResult,
} from "@codeitlab/contracts";
import { SandboxService as SandboxServiceTag } from "@codeitlab/core/services";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import { McpSchema, McpServer } from "effect/ai";

import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as Project from "../../../project/ProjectService.ts";
import * as McpHttpServer from "../../McpHttpServer.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { liveThreadShell } from "../../McpToolAccess.testkit.ts";

const environmentId = EnvironmentId.make("environment:sandbox");
const threadId = ThreadId.make("thread:sandbox");
const providerInstanceId = ProviderInstanceId.make("codex");

const threadCaller: McpInvocationContext.McpInvocationScope = {
  environmentId,
  requestNamespace: "provider:sandbox",
  thread: { threadId, providerSessionId: "provider:sandbox", providerInstanceId },
  client: undefined,
  capabilities: new Set(["orchestration" as const]),
  issuedAt: 0,
};

const clientCaller: McpInvocationContext.McpInvocationScope = {
  environmentId,
  requestNamespace: "client:sandbox",
  thread: undefined,
  client: { sessionId: "client:sandbox", label: "Sandbox test", access: "auto" },
  capabilities: new Set(["orchestration" as const]),
  issuedAt: 0,
};

const health: SandboxHealth = {
  platform: "linux",
  arch: "x64",
  checkedAt: "2026-10-25T00:00:00.000Z",
  backends: [
    {
      id: "docker",
      label: "Docker",
      state: "available",
      recommended: true,
      healthy: true,
      checks: [{ id: "server", label: "Daemon answers", ok: true, detail: null }],
      message: "Docker is installed and can run a sandbox.",
    },
  ],
  readyId: "docker",
  ready: true,
  message: "Docker is installed and can run a sandbox.",
  machine: {
    backend: "docker",
    name: "codeitlab-sandbox",
    image: "node:22-bookworm-slim",
    state: "running",
    detail: null,
  },
};

const runResult: SandboxRunResult = {
  ok: true,
  exitCode: 0,
  stdout: "Linux 6.8.0\n",
  stderr: "",
  durationMs: 12,
  message: "Command exited 0 in 12 ms.",
};

const syncResult: SandboxSyncResult = {
  ok: true,
  files: 3,
  bytes: 6,
  message: "Copied 3 tracked files (0.0 MB) into /work in the codeitlab-sandbox machine.",
  outputTail: "",
};

const project = {
  id: ProjectId.make("project:mcp-test"),
  title: "Sandbox test",
  workspaceRoot: "/projects/sandbox-root",
  defaultModelSelection: null,
  scripts: [],
  createdAt: "2026-10-25T00:00:00.000Z",
  updatedAt: "2026-10-25T00:00:00.000Z",
  deletedAt: null,
};

const projectsLayer = () =>
  Layer.mock(Project.ProjectService)({
    getById: () => Effect.succeedSome(project),
  });

type SandboxServiceShape = SandboxServiceTag["Service"];

const serviceStub = (overrides: Partial<SandboxServiceShape>): SandboxServiceShape => ({
  status: Effect.die("unused"),
  install: () => Effect.die("unused"),
  health: Effect.die("unused"),
  machineCreate: () => Effect.die("unused"),
  machineStart: () => Effect.die("unused"),
  machineStop: () => Effect.die("unused"),
  machineRemove: () => Effect.die("unused"),
  run: () => Effect.die("unused"),
  machineSync: () => Effect.die("unused"),
  ...overrides,
});

const testLayer = (
  service: SandboxServiceShape,
  threads: Layer.Layer<ThreadManagement.ThreadManagementService>,
  projects: Layer.Layer<Project.ProjectService> = projectsLayer(),
) =>
  McpHttpServer.layerSandboxToolkit.pipe(
    Layer.provideMerge(McpServer.McpServer.layer),
    Layer.provide(threads),
    Layer.provide(projects),
    Layer.provide(Layer.succeed(SandboxServiceTag, service)),
  );

const threads = (
  modes: { runtimeMode?: RuntimeMode; interactionMode?: ProviderInteractionMode } = {},
) =>
  Layer.mock(ThreadManagement.ThreadManagementService)({
    getThreadShell: (id) => Effect.succeed(liveThreadShell(id, modes)),
  });

/** The sync handler reads the calling thread's projection to resolve its cwd. */
const threadsForSync = (options: { worktreePath?: string | null } = {}) =>
  Layer.mock(ThreadManagement.ThreadManagementService)({
    getThreadShell: (id) => Effect.succeed(liveThreadShell(id)),
    getProjectThreadRecords: () =>
      Effect.succeed({
        thread: { ...liveThreadShell(threadId), worktreePath: options.worktreePath ?? null },
      } as never),
  });

const mcpClient = McpSchema.McpServerClient.of({
  clientId: 1,
  protocolVersion: "2025-06-18",
  clientCapabilities: {},
  clientInfo: { name: "sandbox", version: "1" },
  initializePayload: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "sandbox", version: "1" },
  },
  getClient: Effect.die("unused"),
});

const callTool = (
  name: string,
  args: Record<string, unknown>,
  caller: McpInvocationContext.McpInvocationScope,
) =>
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    return yield* server
      .callTool({ name, arguments: args })
      .pipe(
        Effect.provideService(McpInvocationContext.McpInvocationContext, caller),
        Effect.provideService(McpSchema.McpServerClient, mcpClient),
      );
  });

it.effect("reports sandbox health and the machine state", () =>
  Effect.gen(function* () {
    const result = yield* callTool("cil_sandbox_status", {}, clientCaller).pipe(
      Effect.provide(testLayer(serviceStub({ health: Effect.succeed(health) }), threads())),
    );
    expect(result.isError).toBe(false);
    expect(result.structuredContent).toMatchObject({
      ready: true,
      machine: { name: "codeitlab-sandbox", state: "running", backend: "docker" },
    });
  }),
);

it.effect("runs a command in the sandbox and returns its output", () =>
  Effect.gen(function* () {
    const runs = yield* Ref.make<ReadonlyArray<SandboxRunInput>>([]);
    const result = yield* callTool(
      "cil_sandbox_run",
      { command: "uname -a", timeoutMs: 20_000 },
      threadCaller,
    ).pipe(
      Effect.provide(
        testLayer(
          serviceStub({
            run: (input) => Ref.update(runs, (all) => [...all, input]).pipe(Effect.as(runResult)),
          }),
          threads(),
        ),
      ),
    );
    expect(result.isError).toBe(false);
    expect(result.structuredContent).toMatchObject({ exitCode: 0, stdout: "Linux 6.8.0\n" });
    expect(yield* Ref.get(runs)).toEqual([{ command: "uname -a", timeoutMs: 20_000 }]);
  }),
);

it.effect("refuses to run a command from a read-only thread without touching the sandbox", () =>
  Effect.gen(function* () {
    const runs = yield* Ref.make(0);
    const result = yield* callTool("cil_sandbox_run", { command: "make test" }, threadCaller).pipe(
      Effect.provide(
        testLayer(
          serviceStub({
            run: () => Ref.update(runs, (count) => count + 1).pipe(Effect.as(runResult)),
          }),
          threads({ interactionMode: "plan" }),
        ),
      ),
    );
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain("full-access");
    expect(yield* Ref.get(runs)).toBe(0);
  }),
);

it.effect("passes the server explanation of a stopped machine through to the agent", () =>
  Effect.gen(function* () {
    const stopped = new CodeItLabServiceError({
      operation: "sandbox.run",
      message: "The Docker machine is stopped. Start it with docker start codeitlab-sandbox.",
    });
    const result = yield* callTool("cil_sandbox_run", { command: "make" }, threadCaller).pipe(
      Effect.provide(testLayer(serviceStub({ run: () => Effect.fail(stopped) }), threads())),
    );
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain("The Docker machine is stopped");
  }),
);

it.effect("refuses a command from a client credential that has no thread", () =>
  Effect.gen(function* () {
    const result = yield* callTool("cil_sandbox_run", { command: "ls" }, clientCaller).pipe(
      Effect.provide(testLayer(serviceStub({}), threads())),
    );
    expect(result.isError).toBe(true);
  }),
);

it.effect("registers the sync tool with an object input schema", () =>
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    const entry = server.tools.find((candidate) => candidate.tool.name === "cil_sandbox_sync");

    expect(entry).toBeDefined();
    // MCP rejects the whole server when a tool's input schema is not an object.
    expect(entry!.tool.inputSchema).toMatchObject({ type: "object" });
  }).pipe(Effect.provide(testLayer(serviceStub({}), threads()))),
);

it.effect("copies the calling thread's worktree files into the machine", () =>
  Effect.gen(function* () {
    const syncs = yield* Ref.make<ReadonlyArray<SandboxSyncInput>>([]);
    const result = yield* callTool("cil_sandbox_sync", {}, threadCaller).pipe(
      Effect.provide(
        testLayer(
          serviceStub({
            machineSync: (input) =>
              Ref.update(syncs, (all) => [...all, input]).pipe(Effect.as(syncResult)),
          }),
          threadsForSync({ worktreePath: "/work/tree" }),
        ),
      ),
    );

    expect(result.isError).toBe(false);
    expect(result.structuredContent).toMatchObject({ ok: true, files: 3, bytes: 6 });
    expect(yield* Ref.get(syncs)).toEqual([{ cwd: "/work/tree" }]);
  }),
);

it.effect("falls back to the project workspace root when the thread has no worktree", () =>
  Effect.gen(function* () {
    const syncs = yield* Ref.make<ReadonlyArray<SandboxSyncInput>>([]);
    const result = yield* callTool("cil_sandbox_sync", {}, threadCaller).pipe(
      Effect.provide(
        testLayer(
          serviceStub({
            machineSync: (input) =>
              Ref.update(syncs, (all) => [...all, input]).pipe(Effect.as(syncResult)),
          }),
          threadsForSync(),
        ),
      ),
    );

    expect(result.isError).toBe(false);
    expect(yield* Ref.get(syncs)).toEqual([{ cwd: "/projects/sandbox-root" }]);
  }),
);

it.effect("refuses to copy from a read-only thread without touching the sandbox", () =>
  Effect.gen(function* () {
    const syncs = yield* Ref.make(0);
    const result = yield* callTool("cil_sandbox_sync", {}, threadCaller).pipe(
      Effect.provide(
        testLayer(
          serviceStub({
            machineSync: () => Ref.update(syncs, (count) => count + 1).pipe(Effect.as(syncResult)),
          }),
          threads({ interactionMode: "plan" }),
        ),
      ),
    );

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain("full-access");
    expect(yield* Ref.get(syncs)).toBe(0);
  }),
);

it.effect("passes the server explanation of a stopped machine through to the agent", () =>
  Effect.gen(function* () {
    const stopped = new CodeItLabServiceError({
      operation: "sandbox.machineSync",
      message: "The Docker machine is stopped. Start it with docker start codeitlab-sandbox.",
    });
    const result = yield* callTool("cil_sandbox_sync", {}, threadCaller).pipe(
      Effect.provide(
        testLayer(serviceStub({ machineSync: () => Effect.fail(stopped) }), threadsForSync()),
      ),
    );

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain("The Docker machine is stopped");
  }),
);
