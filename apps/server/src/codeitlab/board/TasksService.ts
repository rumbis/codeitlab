import { CodeitlabServiceError } from "@codeitlab/core";
import { CodeitlabTasksService } from "@codeitlab/core/services";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { CodeitlabTasksRepository } from "../../persistence/CodeitlabTasks.ts";

const serviceError = (operation: string, cause: unknown) =>
  new CodeitlabServiceError({
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
  const repository = yield* CodeitlabTasksRepository;

  return CodeitlabTasksService.of({
    list: repository.list.pipe(Effect.mapError((cause) => serviceError("listTasks", cause))),
    upsert: (task) =>
      repository.upsert(task).pipe(Effect.mapError((cause) => serviceError("upsertTask", cause))),
    remove: (id) =>
      repository.remove(id).pipe(Effect.mapError((cause) => serviceError("removeTask", cause))),
  });
});

export const layer = Layer.effect(CodeitlabTasksService, make);
