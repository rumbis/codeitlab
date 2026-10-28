import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ProviderInstanceId, type ProviderAuthState } from "@codeitlab/contracts";
import { AcpRegistrySettings } from "../settings.ts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import type * as AcpSchema from "effect-acp/compat";
import { AcpRequestError } from "effect-acp/errors";

import * as PtyAdapter from "@codeitlab/shared/PtyAdapter";
import { makeAcpRegistryAuth } from "./auth.ts";
import * as AcpRegistrySupport from "./AcpRegistrySupport.ts";
import type * as AcpSessionRuntime from "@codeitlab/provider-acp/server/AcpSessionRuntime";

const decodeSettings = Schema.decodeSync(AcpRegistrySettings);
const instanceId = ProviderInstanceId.make("acp-auth-test");
const browserMethod = { id: "browser", name: "Browser", type: "agent" as const };
const terminalMethod = {
  id: "terminal",
  name: "Terminal",
  type: "terminal" as const,
  args: ["login"],
  env: { LOGIN: "yes", OVERRIDE: "method" },
};
const metaTerminalMethod = {
  id: "setup",
  name: "Amp API Key Setup",
  _meta: { "terminal-auth": { command: "/managed/amp-acp", args: ["--setup"] } },
} as unknown as AcpSchema.AuthMethod;
const resolved: AcpRegistrySupport.ResolvedAcpRegistryAgent = {
  agent: {
    id: "test-agent",
    name: "Test",
    version: "1.0.0",
    description: "Test",
    distribution: {},
  },
  distribution: "binary",
  spawn: {
    command: "/managed/agent",
    args: ["--acp"],
    env: { OVERRIDE: "spawn", AGENT_HOME: "/custom/home" },
  },
};
const catalog: AcpRegistrySupport.AcpRegistryCatalog["Service"] = {
  inspect: () =>
    Effect.succeed({
      status: "ready",
      agentId: "test-agent",
      version: "1.0.0",
      distribution: "binary",
    }),
  resolve: () => Effect.succeed(resolved),
  search: () => Effect.die("unused"),
  prepare: () => Effect.die("unused"),
  uninstallManagedBinary: () => Effect.die("unused"),
};

const makeHarness = (
  method: AcpSchema.AuthMethod,
  failVerification = false,
  settings = decodeSettings({ agentId: "test-agent" }),
  providerInstanceId = instanceId,
  resolvedAgent: AcpRegistrySupport.ResolvedAcpRegistryAgent = resolved,
) =>
  Effect.gen(function* () {
    const verify = yield* Deferred.make<void>();
    const changed: boolean[] = [];
    const closed: number[] = [];
    const authenticated: string[] = [];
    const started: number[] = [];
    let runtimes = 0;
    let version = "1.0.0";
    let terminalSpawn: PtyAdapter.PtySpawnInput | undefined;
    let data: ((data: string) => void) | undefined;
    let exit: ((event: PtyAdapter.PtyExitEvent) => void) | undefined;
    let killed = false;
    let closedBeforeTerminal = false;
    const written: string[] = [];
    const sizes: number[][] = [];
    const controller = yield* makeAcpRegistryAuth({
      instanceId: providerInstanceId,
      settings,
      cwd: "/workspace",
      environment: { PATH: "/tools", OVERRIDE: "base" },
      onChanged: (value) =>
        Effect.sync(() => {
          changed.push(value);
        }),
      makeRuntime: () =>
        Effect.gen(function* () {
          const id = ++runtimes;
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              closed.push(id);
            }),
          );
          const initialized: AcpSchema.InitializeResponse = {
            protocolVersion: 2,
            agentCapabilities: {},
            authMethods: [{ ...method, name: `${method.name} ${version}` }],
          };
          let elicitation:
            | Parameters<AcpSessionRuntime.AcpSessionRuntime["Service"]["handleElicitation"]>[0]
            | undefined;
          return {
            initialize: () => Effect.succeed(initialized),
            handleElicitation: (handler) =>
              Effect.sync(() => {
                elicitation = handler;
              }),
            authenticate: (methodId) =>
              Effect.gen(function* () {
                authenticated.push(methodId);
                if (elicitation)
                  yield* elicitation(
                    {
                      mode: "url",
                      url: "https://example.com/login",
                      elicitationId: "consent",
                      requestId: "login",
                      message: "Sign in",
                    },
                    { requestId: "login", method: "elicitation/create" },
                  );
              }),
            start: () =>
              Effect.gen(function* () {
                started.push(id);
                yield* Deferred.await(verify);
                if (failVerification)
                  return yield* new AcpRequestError({
                    method: "session/new",
                    code: -32000,
                    errorMessage: "Authentication required",
                  });
                return {
                  sessionId: "verified",
                  initializeResult: initialized,
                  sessionSetupResult: { sessionId: "verified" },
                  modelConfigId: undefined,
                };
              }),
            logout: Effect.succeed({}),
          };
        }),
    }).pipe(
      Effect.provideService(AcpRegistrySupport.AcpRegistryCatalog, {
        ...catalog,
        resolve: () => Effect.succeed(resolvedAgent),
        inspect: () =>
          Effect.sync(() => ({
            status: "ready" as const,
            agentId: "test-agent",
            version,
            distribution: "binary" as const,
          })),
      }),
      Effect.provideService(PtyAdapter.PtyAdapter, {
        spawn: (input) =>
          Effect.sync(() => {
            terminalSpawn = input;
            closedBeforeTerminal = closed.includes(runtimes);
            return {
              pid: 123,
              write: (input) => {
                written.push(input);
              },
              resize: (cols, rows) => {
                sizes.push([cols, rows]);
              },
              kill: () => {
                killed = true;
              },
              onData: (callback) => {
                data = callback;
                return () => {
                  data = undefined;
                };
              },
              onExit: (callback) => {
                exit = callback;
                return () => {
                  exit = undefined;
                };
              },
            };
          }),
      }),
    );
    const state = (predicate: (state: ProviderAuthState) => boolean) =>
      controller
        .subscribe("owner")
        .pipe(Stream.filter(predicate), Stream.runHead, Effect.map(Option.getOrThrow));
    const phase = (phase: ProviderAuthState["phase"]) => state((value) => value.phase === phase);
    yield* state((value) => (value.methods?.length ?? 0) > 0);
    return {
      controller,
      verify,
      changed,
      closed,
      authenticated,
      started,
      phase,
      state,
      terminalSpawn: () => terminalSpawn,
      closedBeforeTerminal: () => closedBeforeTerminal,
      data: (value: string) => data?.(value),
      exit: (exitCode: number) => exit?.({ exitCode, signal: null }),
      killed: () => killed,
      written,
      sizes,
      runtimes: () => runtimes,
      setVersion: (value: string) => {
        version = value;
      },
    };
  }).pipe(Effect.provideService(AcpRegistrySupport.AcpRegistryCatalog, catalog));

it.effect("keeps local credentials separate from a matching registry agent ID", () =>
  Effect.gen(function* () {
    const registry = yield* makeHarness(browserMethod);
    const local = yield* makeHarness(
      browserMethod,
      false,
      decodeSettings({ source: "local", commandPath: "/different/agent" }),
      ProviderInstanceId.make("test-agent"),
    );
    assert.deepEqual(registry.controller.credentialBinding, {
      owner: "provider",
      key: "acp:test-agent",
    });
    assert.deepEqual(local.controller.credentialBinding, {
      owner: "provider",
      key: "acp:local:test-agent",
    });
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect(
  "discovers methods without signing in, then waits for browser consent and session verification",
  () =>
    Effect.gen(function* () {
      const h = yield* makeHarness(browserMethod);
      assert.deepEqual(h.authenticated, []);
      assert.deepEqual(h.started, []);
      assert.deepEqual(h.closed, [1]);
      const flow = yield* h.controller.start("owner", Effect.void, "browser");
      const waiting = yield* h.phase("waiting");
      assert.deepEqual(waiting.interaction, {
        type: "browser",
        id: "consent",
        url: "https://example.com/login",
        requiresConsent: true,
      });
      yield* h.controller.respond!("owner", {
        instanceId,
        flowId: flow.flowId!,
        interactionId: "consent",
        response: { type: "browser", action: "accept" },
      });
      yield* h.phase("verifying");
      assert.deepEqual(h.changed, []);
      yield* Deferred.succeed(h.verify, undefined);
      yield* h.phase("succeeded");
      assert.deepEqual(h.authenticated, ["browser"]);
      assert.deepEqual(h.changed, [true]);
      assert.deepEqual(h.closed, [1, 2]);
      yield* h.controller.logout(Effect.void);
      assert.deepEqual(h.changed, [true, false]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("runs a fork's bare meta command through its own managed executable", () =>
  Effect.gen(function* () {
    const kiloResolved = {
      ...resolved,
      spawn: { command: "/managed/kilo", args: ["acp"], env: {} },
    } as AcpRegistrySupport.ResolvedAcpRegistryAgent;
    const h = yield* makeHarness(
      {
        id: "kilo-login",
        name: "Kilo Login",
        _meta: { "terminal-auth": { command: "opencode", args: ["auth", "login"] } },
      } as unknown as AcpSchema.AuthMethod,
      false,
      decodeSettings({ agentId: "kilo" }),
      instanceId,
      kiloResolved,
    );
    yield* h.controller.start("owner", Effect.void, "kilo-login");
    yield* h.phase("waiting");
    assert.deepEqual(h.terminalSpawn(), {
      shell: "/managed/kilo",
      args: ["auth", "login"],
      cwd: "/workspace",
      cols: 80,
      rows: 24,
      env: { PATH: "/tools", OVERRIDE: "base" },
    });
    h.exit(0);
    yield* h.phase("verifying");
    yield* Deferred.succeed(h.verify, undefined);
    yield* h.phase("succeeded");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("resolves a bare meta terminal command to the managed executable", () =>
  Effect.gen(function* () {
    const opencodeResolved = {
      ...resolved,
      agent: {
        ...resolved.agent!,
        distribution: { binary: { "darwin-aarch64": { archive: "x", cmd: "./opencode" } } },
      },
      spawn: { command: "/managed/opencode", args: ["acp"], env: {} },
    } as AcpRegistrySupport.ResolvedAcpRegistryAgent;
    const h = yield* makeHarness(
      {
        id: "opencode-login",
        name: "OpenCode Login",
        _meta: { "terminal-auth": { command: "opencode", args: ["auth", "login"] } },
      } as unknown as AcpSchema.AuthMethod,
      false,
      decodeSettings({ agentId: "opencode" }),
      instanceId,
      opencodeResolved,
    );
    yield* h.controller.start("owner", Effect.void, "opencode-login");
    yield* h.phase("waiting");
    assert.deepEqual(h.terminalSpawn(), {
      shell: "/managed/opencode",
      args: ["auth", "login"],
      cwd: "/workspace",
      cols: 80,
      rows: 24,
      env: { PATH: "/tools", OVERRIDE: "base" },
    });
    h.exit(0);
    yield* h.phase("verifying");
    yield* Deferred.succeed(h.verify, undefined);
    yield* h.phase("succeeded");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("runs an npx agent's terminal method as the package subcommand it names", () =>
  Effect.gen(function* () {
    const novaResolved = {
      ...resolved,
      agent: {
        ...resolved.agent!,
        distribution: { npx: { package: "@compass-ai/nova@1.1.59", args: ["acp"] } },
      },
      spawn: {
        command: "npx",
        args: ["-y", "@compass-ai/nova@1.1.59", "acp"],
        env: { OVERRIDE: "spawn" },
      },
    } as AcpRegistrySupport.ResolvedAcpRegistryAgent;
    const h = yield* makeHarness(
      {
        id: "kore-terminal-auth",
        name: "Nova Setup",
        type: "terminal",
        args: ["@compass-ai/nova", "setup"],
      } as unknown as AcpSchema.AuthMethod,
      false,
      decodeSettings({ agentId: "nova" }),
      instanceId,
      novaResolved,
    );
    yield* h.controller.start("owner", Effect.void, "kore-terminal-auth");
    yield* h.phase("waiting");
    assert.deepEqual(h.terminalSpawn(), {
      shell: "npx",
      args: ["-y", "@compass-ai/nova@1.1.59", "setup"],
      cwd: "/workspace",
      cols: 80,
      rows: 24,
      env: { PATH: "/tools", OVERRIDE: "spawn" },
    });
    h.exit(0);
    yield* h.phase("verifying");
    yield* Deferred.succeed(h.verify, undefined);
    yield* h.phase("succeeded");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("asks for environment variables instead of authenticating env_var methods", () =>
  Effect.gen(function* () {
    const h = yield* makeHarness({
      id: "api-key",
      name: "API key",
      type: "env_var",
      vars: [{ name: "OPENAI_API_KEY" }],
    } as unknown as AcpSchema.AuthMethod);
    yield* h.controller.start("owner", Effect.void, "api-key");
    const failed = yield* h.phase("failed");
    assert.include(failed.message ?? "", "OPENAI_API_KEY");
    assert.deepEqual(h.authenticated, []);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("runs the terminal-auth meta command instead of calling authenticate", () =>
  Effect.gen(function* () {
    const h = yield* makeHarness(metaTerminalMethod);
    const flow = yield* h.controller.start("owner", Effect.void, "setup");
    yield* h.phase("waiting");
    assert.isTrue(h.closedBeforeTerminal());
    assert.deepEqual(h.terminalSpawn(), {
      shell: "/managed/amp-acp",
      args: ["--setup"],
      cwd: "/workspace",
      cols: 80,
      rows: 24,
      env: { PATH: "/tools", OVERRIDE: "spawn", AGENT_HOME: "/custom/home" },
    });
    h.exit(0);
    yield* h.phase("verifying");
    assert.deepEqual(h.authenticated, []);
    yield* Deferred.succeed(h.verify, undefined);
    yield* h.phase("succeeded");
    assert.deepEqual(h.changed, [true]);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect(
  "runs terminal auth directly with the resolved environment and reconnects to verify",
  () =>
    Effect.gen(function* () {
      const h = yield* makeHarness(terminalMethod);
      const flow = yield* h.controller.start("owner", Effect.void, "terminal");
      yield* h.phase("waiting");
      assert.isTrue(h.closedBeforeTerminal());
      assert.deepEqual(h.terminalSpawn(), {
        shell: "/managed/agent",
        args: ["login"],
        cwd: "/workspace",
        cols: 80,
        rows: 24,
        env: { PATH: "/tools", OVERRIDE: "method", AGENT_HOME: "/custom/home", LOGIN: "yes" },
      });
      h.data("Enter code: ");
      const output = yield* h.state(
        (value) =>
          value.interaction?.type === "terminal" && value.interaction.output === "Enter code: ",
      );
      assert.strictEqual(
        output.interaction?.type === "terminal" && output.interaction.outputOffset,
        12,
      );
      yield* h.controller.respond!("owner", {
        instanceId,
        flowId: flow.flowId!,
        interactionId: "terminal",
        response: { type: "terminal", data: "123\r", size: { cols: 100, rows: 30 } },
      });
      assert.deepEqual(h.written, ["123\r"]);
      assert.deepEqual(h.sizes, [[100, 30]]);
      h.exit(0);
      yield* h.phase("verifying");
      assert.isTrue(h.killed());
      assert.deepEqual(h.authenticated, []);
      yield* Deferred.succeed(h.verify, undefined);
      yield* h.phase("succeeded");
      assert.deepEqual(h.started, [3]);
      assert.deepEqual(h.changed, [true]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("cancels the login PTY and rejects further terminal input", () =>
  Effect.gen(function* () {
    const h = yield* makeHarness(terminalMethod);
    const flow = yield* h.controller.start("owner");
    yield* h.phase("waiting");
    yield* h.controller.cancel("owner", flow.flowId!);
    assert.isTrue(h.killed());
    assert.deepEqual(h.started, []);
    assert.deepEqual(h.changed, []);
    assert.strictEqual(
      (yield* h.controller.respond!("owner", {
        instanceId,
        flowId: flow.flowId!,
        interactionId: "terminal",
        response: { type: "terminal", data: "late\r" },
      }).pipe(Effect.result))._tag,
      "Failure",
    );
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("does not report authentication when post-login verification fails", () =>
  Effect.gen(function* () {
    const h = yield* makeHarness(terminalMethod, true);
    yield* h.controller.start("owner");
    yield* h.phase("waiting");
    h.exit(0);
    yield* h.phase("verifying");
    yield* Deferred.succeed(h.verify, undefined);
    yield* h.phase("failed");
    assert.deepEqual(h.changed, []);
    assert.isTrue(h.killed());
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("refreshes advertised methods after a registry version change without logging in", () =>
  Effect.gen(function* () {
    const h = yield* makeHarness(browserMethod);
    const count = h.runtimes();
    yield* h.controller.refreshMethods!;
    assert.strictEqual(h.runtimes(), count);
    h.setVersion("2.0.0");
    yield* h.controller.refreshMethods!;
    const state = yield* h.state((value) => value.methods?.[0]?.name === "Browser 2.0.0");
    assert.strictEqual(state.phase, "idle");
    assert.strictEqual(h.runtimes(), count + 1);
    assert.deepEqual(h.authenticated, []);
    assert.deepEqual(h.started, []);
    assert.deepEqual(h.closed, [1, 2]);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
