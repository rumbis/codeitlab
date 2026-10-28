import type { CodeItLabTask } from "@codeitlab/core/board";
import { CodeItLabServiceError } from "@codeitlab/core";
import { CodeItLabTasksService, XpService } from "@codeitlab/core/services";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { CodeItLabTasksRepository } from "../../persistence/CodeItLabTasks.ts";

const serviceError = (operation: string, cause: unknown) =>
  new CodeItLabServiceError({
    operation,
    message:
      cause instanceof Error
        ? cause.message
        : "The board database rejected the request. The settings copy of the board still works.",
    cause,
  });

/**
 * Database-backed board tasks. The repository owns SQL; this service owns the
 * feature contract, so the RPC transport stays a thin decode → call → map.
 */
export const make = Effect.gen(function* () {
  const repository = yield* CodeItLabTasksRepository;

  /**
   * XP is a bonus on top of the board, never part of its transaction: the board
   * saves even when the ledger cannot. The event id is the task's, so the
   * ledger's own dedupe makes "completed" count once however often it is saved.
   *
   * The lookup happens per call, not at construction: a layer's construction
   * context only holds the services it was provided, while the call runs in the
   * merged feature context where the ledger lives.
   */
  const awardQuestXp = (saved: CodeItLabTask) =>
    saved.column !== "completed"
      ? Effect.succeed(saved)
      : Effect.gen(function* () {
          const xp = yield* Effect.serviceOption(XpService);
          if (Option.isNone(xp)) return saved;
          yield* xp.value
            .record({ kind: "quest-completed", eventId: `task:${saved.id}` })
            .pipe(
              Effect.catch((cause) =>
                Effect.logWarning(
                  "CodeItLab saved the board but could not record quest XP.",
                  cause,
                ),
              ),
            );
          return saved;
        });

  return CodeItLabTasksService.of({
    list: repository.list.pipe(Effect.mapError((cause) => serviceError("listTasks", cause))),
    upsert: (task) =>
      repository.upsert(task).pipe(
        Effect.mapError((cause) => serviceError("upsertTask", cause)),
        Effect.flatMap(awardQuestXp),
      ),
    remove: (id) =>
      repository.remove(id).pipe(Effect.mapError((cause) => serviceError("removeTask", cause))),
  });
});

export const layer = Layer.effect(CodeItLabTasksService, make);
