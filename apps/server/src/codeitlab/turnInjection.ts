import { CodeItLabContextService, type CodeItLabTurnContextInput } from "@codeitlab/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as ServerConfig from "../config.ts";
import { makeThreadOverrideStore, readPackOverrideCommand } from "./ecosystem/threadOverrides.ts";

/**
 * Per-turn CodeItLab context.
 *
 * `RunExecutionService` is built before the CodeItLab layer (which needs the
 * provider registries that the orchestration runtime itself provides), so the
 * context service cannot be threaded through its layer requirements without a
 * cycle. The server registers the built service here once at startup; the turn
 * hook reads it at turn time, when startup has completed. `serviceOption`
 * remains as a fallback for tests that provide the service explicitly.
 */
let activeContextService: CodeItLabContextService["Service"] | null = null;

export const registerCodeItLabContextService = (
  service: CodeItLabContextService["Service"],
): void => {
  activeContextService = service;
};

/** Test hook: forget the registered service. */
export const resetCodeItLabContextService = (): void => {
  activeContextService = null;
};

/**
 * Resolves the CodeItLab instruction block for a single provider turn.
 *
 * Returns `null` when CodeItLab is not registered (the server then behaves
 * exactly like stock CodeItLab) or when the feature is configured to contribute
 * nothing for this turn. Failures never fail the turn: a broken memory store or
 * policy read must not block the user's message.
 */
export const resolveCodeItLabInstructions = Effect.fn(
  "codeitlab.turnInjection.resolveInstructions",
)(function* (input: CodeItLabTurnContextInput) {
  const registered = activeContextService;
  const service =
    registered !== null
      ? registered
      : Option.match(yield* Effect.serviceOption(CodeItLabContextService), {
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
        Effect.logWarning("CodeItLab turn context failed; continuing without it.", {
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
