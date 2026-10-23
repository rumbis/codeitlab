import { CodeitlabContextService, type CodeitlabTurnContextInput } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import { makeThreadOverrideStore, readPackOverrideCommand } from "./ecosystem/threadOverrides.ts";

/**
 * Per-turn CodeitLab context.
 *
 * `RunExecutionService` is built before the CodeitLab layer (which needs the
 * provider registries that the orchestration runtime itself provides), so the
 * context service cannot be threaded through its layer requirements without a
 * cycle. The server registers the built service here once at startup; the turn
 * hook reads it at turn time, when startup has completed. `serviceOption`
 * remains as a fallback for tests that provide the service explicitly.
 */
let activeContextService: CodeitlabContextService["Service"] | null = null;

export const registerCodeitlabContextService = (
  service: CodeitlabContextService["Service"],
): void => {
  activeContextService = service;
};

/** Test hook: forget the registered service. */
export const resetCodeitlabContextService = (): void => {
  activeContextService = null;
};

/**
 * Resolves the CodeitLab instruction block for a single provider turn.
 *
 * Returns `null` when CodeitLab is not registered (the server then behaves
 * exactly like stock T3) or when the feature is configured to contribute
 * nothing for this turn. Failures never fail the turn: a broken memory store or
 * policy read must not block the user's message.
 */
export const resolveCodeitlabInstructions = (
  input: CodeitlabTurnContextInput,
): Effect.Effect<
  string | null,
  never,
  FileSystem.FileSystem | Path.Path | ServerConfig.ServerConfig
> =>
  Effect.gen(function* () {
    const registered = activeContextService;
    const service =
      registered !== null
        ? registered
        : Option.match(yield* Effect.serviceOption(CodeitlabContextService), {
            onNone: () => null,
            onSome: (value) => value,
          });
    if (service === null) return null;

    // "normal mode" / "stop caveman" turns the packs off for this thread and
    // sticks; "caveman mode" turns them back on. A run without a thread id
    // (e.g. a one-off) simply skips persistence.
    const command = readPackOverrideCommand(input.prompt);
    let threadOverride = input.threadOverride;
    if (command !== undefined && input.threadId !== undefined) {
      const config = yield* ServerConfig.ServerConfig;
      const store = yield* makeThreadOverrideStore({ stateDir: config.stateDir });
      yield* store
        .set(input.threadId, command)
        .pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("Could not persist the CodeItLab pack override.", { cause }),
          ),
        );
      threadOverride = command;
    }

    const context = yield* service
      .buildTurnContext({
        ...input,
        ...(threadOverride === undefined ? {} : { threadOverride }),
      })
      .pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("CodeitLab turn context failed; continuing without it.", {
            cause,
          }).pipe(Effect.as(null)),
        ),
      );
    const instructions = context?.instructions.trim() ?? "";
    return instructions.length === 0 ? null : instructions;
  });

/**
 * Codex is the only adapter that forwards `appContext` entries as developer
 * instructions today. Every other provider receives the block as a message
 * prefix so memory, policy and skill context reach it too.
 */
export const driverSupportsAppContext = (driver: string): boolean => driver === "codex";
