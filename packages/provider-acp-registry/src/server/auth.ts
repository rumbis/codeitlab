import {
  ProviderSetupError,
  type ProviderAuthMethod,
  type ProviderInstanceId,
} from "@codeitlab/contracts";
import type { AcpRegistrySettings } from "../settings.ts";
import * as Crypto from "effect/Crypto";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Scope from "effect/Scope";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import type * as AcpSchema from "effect-acp/compat";

import * as PtyAdapter from "@codeitlab/shared/PtyAdapter";
import * as ProviderAuthFlow from "@codeitlab/provider-core/server/providerAuthFlow";
import {
  agentTerminalSetupArgs,
  metaTerminalAuth,
  normalizeAcpRegistryAuthMethods,
  normalizeAcpRegistryWebUrl,
} from "./probe.ts";
import * as AcpRegistrySupport from "./AcpRegistrySupport.ts";
import * as AcpRegistryRuntimeCoordinator from "./AcpRegistryRuntimeCoordinator.ts";
import * as AcpSessionRuntime from "@codeitlab/provider-acp/server/AcpSessionRuntime";

// Agents explain failed sign-ins in their own error payloads (a migration
// notice, a missing CLI login, an unsupported method). Surface that text so the
// user sees the actionable reason instead of only the generic sentence.
const MAX_CAUSE_DETAIL_LENGTH = 300;
const causeDetail = (cause: unknown): string => {
  const message =
    cause instanceof Error
      ? cause.message
      : typeof cause === "string"
        ? cause
        : typeof cause === "object" && cause !== null && "message" in cause
          ? String((cause as { readonly message: unknown }).message)
          : "";
  const trimmed = message.replace(/\s+/gu, " ").trim();
  if (trimmed.length === 0) return "";
  return ` (${trimmed.length > MAX_CAUSE_DETAIL_LENGTH ? `${trimmed.slice(0, MAX_CAUSE_DETAIL_LENGTH)}...` : trimmed})`;
};

type Runtime = Pick<
  AcpSessionRuntime.AcpSessionRuntime["Service"],
  "initialize" | "authenticate" | "start" | "handleElicitation" | "logout"
>;

export const makeAcpRegistryAuth = Effect.fn("makeAcpRegistryAuth")(function* (options: {
  readonly instanceId: ProviderInstanceId;
  readonly settings: AcpRegistrySettings;
  readonly cwd: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly onChanged: (authenticated: boolean) => Effect.Effect<void>;
  readonly makeRuntime?: (
    spawn: AcpSessionRuntime.AcpSpawnInput,
  ) => Effect.Effect<Runtime, ProviderSetupError, Scope.Scope>;
}) {
  const catalog = yield* AcpRegistrySupport.AcpRegistryCatalog;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const crypto = yield* Crypto.Crypto;
  const pty = yield* Effect.serviceOption(PtyAdapter.PtyAdapter);
  const coordinator = yield* Effect.serviceOption(
    AcpRegistryRuntimeCoordinator.AcpRegistryRuntimeCoordinator,
  );
  const agentKey =
    options.settings.source === "local" ? `local:${options.instanceId}` : options.settings.agentId;
  const failure = (operation: string, detail: string, cause?: unknown) =>
    new ProviderSetupError({
      instanceId: options.instanceId,
      operation,
      detail: `${detail}${causeDetail(cause)}`,
      cause,
    });
  const resolve = catalog
    .resolve(options.settings, options.cwd, options.environment)
    .pipe(
      Effect.mapError((cause) =>
        failure("start", "Could not prepare the selected ACP agent.", cause),
      ),
    );
  const makeRuntime =
    options.makeRuntime ??
    ((spawn) =>
      Effect.gen(function* () {
        const context = yield* Layer.build(
          AcpSessionRuntime.layer({
            spawn,
            cwd: options.cwd,
            authenticateOnAuthRequired: false,
            clientCapabilities: {
              auth: { terminal: Option.isSome(pty) },
              elicitation: { url: {} },
              fs: { readTextFile: false, writeTextFile: false },
              terminal: false,
              // Agents that sign in through their own CLI only advertise the
              // command when the client says it can run it.
              ...(Option.isSome(pty) ? { _meta: { "terminal-auth": true } } : {}),
            },
            clientInfo: { name: "cil-code-provider-auth", version: "0.0.0" },
          }).pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner),
                Layer.succeed(Crypto.Crypto, crypto),
              ),
            ),
          ),
        );
        return yield* Effect.service(AcpSessionRuntime.AcpSessionRuntime).pipe(
          Effect.provide(context),
        );
      }).pipe(
        Effect.mapError((cause) =>
          failure("start", "Could not start the selected ACP agent.", cause),
        ),
      ));

  let knownMethods:
    | { readonly version: string | null; readonly methods: ReadonlyArray<ProviderAuthMethod> }
    | undefined;
  const discoverMethods = Effect.scoped(
    Effect.gen(function* () {
      const inspected = yield* catalog
        .inspect(options.settings, options.environment)
        .pipe(
          Effect.mapError((cause) =>
            failure("methods", "Could not inspect the selected ACP agent.", cause),
          ),
        );
      if (inspected.status !== "ready")
        return yield* failure("methods", "Prepare this ACP agent before signing in.");
      // An unversioned command (a path override) can change in place, so only
      // registry versions reuse earlier discovery.
      if (inspected.version !== null && knownMethods?.version === inspected.version)
        return knownMethods.methods;
      const resolved = yield* resolve;
      const runtime = yield* makeRuntime(resolved.spawn);
      const initialized = yield* runtime
        .initialize()
        .pipe(
          Effect.mapError((cause) =>
            failure("methods", "Could not discover this agent's sign-in methods.", cause),
          ),
        );
      const advertised = normalizeAcpRegistryAuthMethods(
        initialized.authMethods,
        undefined,
        options.settings.agentId,
      )
        .filter(
          (method) => method.id.length <= 128 && (method.type !== "terminal" || Option.isSome(pty)),
        )
        .slice(0, 32)
        .map((method) => ({
          id: method.id,
          name: method.name,
          description: method.description,
          type: method.type === "env_var" ? ("credentials" as const) : method.type,
        }));
      knownMethods = { version: inspected.version, methods: advertised };
      return advertised;
    }),
  ).pipe(
    Effect.timeoutOrElse({
      duration: "30 seconds",
      orElse: () =>
        Effect.fail(failure("methods", "The ACP agent did not advertise sign-in methods in time.")),
    }),
  );

  const methods = Option.isSome(coordinator)
    ? coordinator.value
        .runBackgroundProbe(agentKey, discoverMethods)
        .pipe(
          Effect.flatMap((result) =>
            Option.isSome(result)
              ? Effect.succeed(result.value)
              : Effect.fail(
                  failure(
                    "methods",
                    "Sign-in discovery was interrupted by an active provider session. Try again.",
                  ),
                ),
          ),
        )
    : discoverMethods;

  const terminalEnv = (
    ...envs: ReadonlyArray<Readonly<Record<string, string | undefined>> | undefined>
  ): Record<string, string> =>
    Object.fromEntries(
      envs.flatMap((env) =>
        env === undefined
          ? []
          : Object.entries(env).flatMap(([name, value]) =>
              typeof value === "string" ? [[name, value] as const] : [],
            ),
      ),
    );

  // Curated CLI setup runs the agent's own binary without its ACP transport
  // arguments (`goose configure`, not `goose acp configure`). npx distributions
  // keep the npx wrapper and swap in the package's setup subcommand.
  const curatedTerminalSpawn = (
    resolved: AcpRegistrySupport.ResolvedAcpRegistryAgent,
    args: ReadonlyArray<string>,
  ) => {
    const npx = resolved.agent?.distribution.npx;
    const usesNpx = npx !== undefined && /(^|[\\/])npx(\.cmd)?$/.test(resolved.spawn.command);
    return {
      command: resolved.spawn.command,
      args: usesNpx ? ["-y", npx.package, ...args] : [...args],
      env: terminalEnv(resolved.spawn.env),
    };
  };

  // Some agents describe a terminal method as the full command
  // (nova: args ["@compass-ai/nova", "setup"]) instead of args appended to the
  // agent command. When the first arg names the npx package, run the package's
  // own subcommand rather than "npx <pkg> acp <pkg> setup".
  const declaredTerminalSpawn = (
    resolved: AcpRegistrySupport.ResolvedAcpRegistryAgent,
    args: ReadonlyArray<string>,
    methodEnv: Readonly<Record<string, string | undefined>> | undefined,
  ) => {
    const npx = resolved.agent?.distribution.npx;
    const usesNpx = npx !== undefined && /(^|[\\/])npx(\.cmd)?$/.test(resolved.spawn.command);
    const first = args[0];
    if (usesNpx && first !== undefined && npx.package.startsWith(first) && first !== "") {
      return {
        command: resolved.spawn.command,
        args: ["-y", npx.package, ...args.slice(1)],
        env: terminalEnv(resolved.spawn.env),
      };
    }
    // A login subcommand is a separate CLI invocation: drop the agent's ACP
    // transport arguments (nova: `node <wrapper> acp setup` must be
    // `node <wrapper> setup`).
    const transportArgs = new Set(["acp", "--acp", "acp-daemon"]);
    return {
      command: resolved.spawn.command,
      args: [...resolved.spawn.args.filter((arg) => !transportArgs.has(arg)), ...args],
      env: terminalEnv(resolved.spawn.env, methodEnv),
    };
  };

  // Agents may advertise their CLI by bare name (opencode: {command:"opencode"}),
  // but the managed installation is not on PATH. When the name matches the
  // managed executable, run that executable instead; otherwise keep the
  // advertised command (absolute npx-cache paths, custom installs).
  const resolveMetaTerminalSpawn = (
    resolved: AcpRegistrySupport.ResolvedAcpRegistryAgent,
    terminal: {
      readonly command: string;
      readonly args: ReadonlyArray<string>;
      readonly env?: Readonly<Record<string, string>>;
    },
  ) => {
    const transportArgs = new Set(["acp", "--acp", "acp-daemon"]);
    const base = resolved.spawn.command.split("/").at(-1) ?? resolved.spawn.command;
    // Bare names never resolve in the app's PATH; run the managed executable
    // even when the advertised name belongs to the upstream fork (kilo says
    // "opencode"). Absolute commands are kept unless they name the same binary.
    const bare = !terminal.command.includes("/");
    const matchesManaged = bare || base === terminal.command.split("/").at(-1);
    if (matchesManaged) {
      return {
        command: resolved.spawn.command,
        args: [...resolved.spawn.args.filter((arg) => !transportArgs.has(arg)), ...terminal.args],
        env: terminalEnv(resolved.spawn.env, terminal.env),
      };
    }
    return {
      command: terminal.command,
      args: terminal.args,
      env: terminalEnv(resolved.spawn.env, terminal.env),
    };
  };

  const runTerminal = Effect.fnUntraced(function* (
    spawn: {
      readonly command: string;
      readonly args: ReadonlyArray<string>;
      readonly env?: Readonly<Record<string, string>> | undefined;
    },
    context: ProviderAuthFlow.ProviderAuthFlowContext,
  ) {
    if (Option.isNone(pty))
      return yield* failure(
        "start",
        "Interactive provider login is unavailable on this environment.",
      );
    const exited = yield* Deferred.make<number>();
    const output = yield* Queue.sliding<string>(64);
    const process = yield* pty.value
      .spawn({
        shell: spawn.command,
        args: [...spawn.args],
        cwd: options.cwd,
        cols: 80,
        rows: 24,
        env: { ...options.environment, ...spawn.env },
      })
      .pipe(
        Effect.mapError((cause) =>
          failure("start", "Could not open the provider sign-in terminal.", cause),
        ),
      );
    const detachData = process.onData((data) => {
      Queue.offerUnsafe(output, data.slice(-16_384));
    });
    const detachExit = process.onExit(({ exitCode }) => {
      Deferred.doneUnsafe(exited, Effect.succeed(exitCode));
    });
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        detachData();
        detachExit();
        try {
          process.kill();
        } catch {}
      }),
    );
    let transcript = "";
    let outputOffset = 0;
    const update = () =>
      context.setInteraction(
        { type: "terminal", id: "terminal", output: transcript, outputOffset },
        (response) =>
          response.type === "terminal"
            ? Effect.try({
                try: () => {
                  if (response.size) process.resize(response.size.cols, response.size.rows);
                  if (response.data) process.write(response.data);
                },
                catch: () =>
                  failure("respond", "The provider sign-in terminal is no longer available."),
              })
            : Effect.void,
      );
    yield* update();
    yield* Queue.take(output).pipe(
      Effect.flatMap((data) => {
        outputOffset += data.length;
        transcript = (transcript + data).slice(-16_384);
        return update();
      }),
      Effect.forever,
      Effect.forkScoped,
    );
    if ((yield* Deferred.await(exited)) !== 0)
      return yield* failure("start", "The provider login command did not finish successfully.");
  });

  const authenticate = Effect.fn("AcpRegistryAuth.authenticate")(function* (
    methodId: string,
    context: ProviderAuthFlow.ProviderAuthFlowContext,
  ) {
    if (!options.settings.enabled)
      return yield* failure("start", "Enable this provider before signing in.");
    const login = Effect.scoped(
      Effect.gen(function* () {
        const resolved = yield* resolve;
        const runtimeScope = yield* Scope.make();
        yield* Effect.addFinalizer(() => Scope.close(runtimeScope, Exit.void));
        const runtime = yield* makeRuntime(resolved.spawn).pipe(
          Effect.provideService(Scope.Scope, runtimeScope),
        );
        yield* runtime.handleElicitation((request) =>
          Effect.gen(function* () {
            if (
              request.mode !== "url" ||
              !("url" in request) ||
              !("elicitationId" in request) ||
              typeof request.url !== "string" ||
              typeof request.elicitationId !== "string"
            )
              return { action: "decline" } as const;
            const url = normalizeAcpRegistryWebUrl(request.url);
            const id = request.elicitationId.trim();
            if (!url || !id || id.length > 128) return { action: "decline" } as const;
            const consent = yield* Deferred.make<boolean>();
            yield* context.setInteraction(
              { type: "browser", id, url, requiresConsent: true },
              (response) =>
                response.type === "browser"
                  ? Deferred.succeed(consent, response.action === "accept").pipe(Effect.asVoid)
                  : Effect.void,
            );
            return (yield* Deferred.await(consent))
              ? ({ action: "accept" } as const)
              : ({ action: "decline" } as const);
          }),
        );
        const initialized = yield* runtime
          .initialize()
          .pipe(
            Effect.mapError((cause) =>
              failure("start", "Could not initialize the selected ACP agent.", cause),
            ),
          );
        const method = initialized.authMethods?.find((method) => method.id === methodId);
        if (!method)
          return yield* failure("start", "The agent no longer advertises this sign-in method.");
        // Terminal sign-in comes in two shapes: a `terminal` auth method whose
        // args extend the agent command, and the `_meta["terminal-auth"]`
        // extension that names its own command (amp-acp --setup, copilot login).
        const terminalMeta =
          method.type === undefined || method.type === "agent"
            ? metaTerminalAuth(method)
            : undefined;
        const curatedArgs =
          terminalMeta === undefined && (method.type === undefined || method.type === "agent")
            ? agentTerminalSetupArgs(options.settings.agentId)
            : undefined;
        const terminalSpawn =
          method.type === "terminal"
            ? declaredTerminalSpawn(resolved, method.args ?? [], method.env)
            : terminalMeta !== undefined
              ? resolveMetaTerminalSpawn(resolved, terminalMeta)
              : curatedArgs !== undefined
                ? curatedTerminalSpawn(resolved, curatedArgs)
                : undefined;
        if (terminalSpawn !== undefined) {
          yield* Scope.close(runtimeScope, Exit.void);
          yield* runTerminal(terminalSpawn, context).pipe(Effect.scoped);
          // Terminal login is a separate invocation. Reconnect after it exits so
          // the ACP process reads the credentials its login command persisted.
          const verifiedRuntime = yield* makeRuntime(resolved.spawn);
          yield* context.verifying;
          yield* verifiedRuntime
            .start()
            .pipe(
              Effect.mapError((cause) =>
                failure(
                  "verify",
                  "The provider could not create a session after terminal sign-in.",
                  cause,
                ),
              ),
            );
        } else {
          if (method.type === undefined || method.type === "agent") {
            if (!runtime.authenticate)
              return yield* failure("start", "This runtime does not support explicit ACP sign-in.");
            yield* runtime
              .authenticate(methodId)
              .pipe(
                Effect.mapError((cause) =>
                  failure("start", "The ACP agent could not complete sign-in.", cause),
                ),
              );
          }
          // Legacy env_var methods use the secret-backed environment fields in
          // provider settings. Never send their ID to authenticate.
          if (method.type === "env_var") {
            const names = "vars" in method ? method.vars.map((variable) => variable.name) : [];
            return yield* failure(
              "start",
              names.length > 0
                ? `This agent signs in with an API key. Set ${names.join(", ")} under this instance's environment variables in provider settings.`
                : "This agent signs in with an API key. Add it under this instance's environment variables in provider settings.",
            );
          }
          yield* context.verifying;
          yield* runtime
            .start()
            .pipe(
              Effect.mapError((cause) =>
                failure("verify", "The provider could not create a session after sign-in.", cause),
              ),
            );
        }
      }),
    );
    yield* Option.isSome(coordinator)
      ? coordinator.value.withForegroundStartup(agentKey, login)
      : login;
    yield* options.onChanged(true);
  });
  const logout = Effect.scoped(
    Effect.gen(function* () {
      const resolved = yield* resolve;
      const runtime = yield* makeRuntime(resolved.spawn);
      yield* runtime.logout.pipe(
        Effect.mapError((cause) =>
          failure(
            "logout",
            "This ACP agent could not sign out. It may not advertise logout support.",
            cause,
          ),
        ),
      );
    }),
  ).pipe(
    Effect.timeoutOrElse({
      duration: "60 seconds",
      orElse: () =>
        Effect.fail(failure("logout", "The ACP agent did not finish signing out in time.")),
    }),
  );
  const signOut = (
    Option.isSome(coordinator) ? coordinator.value.withForegroundStartup(agentKey, logout) : logout
  ).pipe(Effect.andThen(options.onChanged(false)));
  return yield* ProviderAuthFlow.make({
    instanceId: options.instanceId,
    // ACP doesn't advertise its credential scope. Conservatively treat all
    // instances of the same agent on this environment as sharing credentials.
    credentialBinding: { owner: "provider", key: `acp:${agentKey}` },
    methods,
    ...(options.settings.authMethodId ? { defaultMethodId: options.settings.authMethodId } : {}),
    authenticate,
    logout: signOut,
  });
});
