import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";

import { CodeItLabTask } from "@codeitlab/core/board";

import { PersistenceDecodeError, PersistenceSqlError } from "./Errors.ts";

export const MAX_CODEITLAB_TASKS = 500;

const Row = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  notes: Schema.String,
  boardColumn: CodeItLabTask.fields.column,
  threadId: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  archivedAt: Schema.String,
  completedAt: Schema.String,
  startedAt: Schema.String,
});

export type CodeItLabTaskRepositoryError = PersistenceDecodeError | PersistenceSqlError;

function toSqlOrDecodeError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown): CodeItLabTaskRepositoryError =>
    Schema.isSchemaError(cause)
      ? PersistenceDecodeError.fromSchemaError(decodeOperation, cause)
      : new PersistenceSqlError({ operation: sqlOperation, cause });
}

/**
 * Rows for the kanban board. The repository only stores what the board already
 * means: a workflow label and a thread id. It never starts or schedules work.
 */
export class CodeItLabTasksRepository extends Context.Service<
  CodeItLabTasksRepository,
  {
    readonly list: Effect.Effect<ReadonlyArray<CodeItLabTask>, CodeItLabTaskRepositoryError>;
    readonly upsert: (
      task: CodeItLabTask,
    ) => Effect.Effect<CodeItLabTask, CodeItLabTaskRepositoryError>;
    readonly remove: (id: string) => Effect.Effect<boolean, CodeItLabTaskRepositoryError>;
  }
>()("codeitlab/persistence/CodeItLabTasks/CodeItLabTasksRepository") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const listRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: Row,
    execute: () =>
      sql`
        SELECT
          id AS "id",
          title AS "title",
          notes AS "notes",
          board_column AS "boardColumn",
          thread_id AS "threadId",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          archived_at AS "archivedAt",
          completed_at AS "completedAt",
          started_at AS "startedAt"
        FROM codeitlab_tasks
        ORDER BY updated_at DESC, id
        LIMIT ${MAX_CODEITLAB_TASKS}
      `,
  });

  return CodeItLabTasksRepository.of({
    list: listRows(undefined).pipe(
      Effect.map((rows) =>
        rows.map((row) => ({
          id: row.id,
          title: row.title,
          notes: row.notes,
          column: row.boardColumn,
          threadId: row.threadId,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          archivedAt: row.archivedAt,
          completedAt: row.completedAt,
          startedAt: row.startedAt,
        })),
      ),
      Effect.mapError(toSqlOrDecodeError("listCodeItLabTasks", "CodeItLabTask")),
    ),

    upsert: (task) =>
      sql`
        INSERT INTO codeitlab_tasks (
          id, title, notes, board_column, thread_id, created_at, updated_at, archived_at,
          completed_at, started_at
        )
        VALUES (
          ${task.id},
          ${task.title},
          ${task.notes},
          ${task.column},
          ${task.threadId},
          ${task.createdAt},
          ${task.updatedAt},
          ${task.archivedAt},
          ${task.completedAt},
          ${task.startedAt ?? ""}
        )
        ON CONFLICT (id) DO UPDATE SET
          title = excluded.title,
          notes = excluded.notes,
          board_column = excluded.board_column,
          thread_id = excluded.thread_id,
          updated_at = excluded.updated_at,
          archived_at = excluded.archived_at,
          completed_at = excluded.completed_at,
          started_at = excluded.started_at
      `.pipe(
        Effect.as(task),
        Effect.mapError(toSqlOrDecodeError("upsertCodeItLabTask", "CodeItLabTask")),
      ),

    remove: (id) =>
      sql<{ readonly id: string }>`
        DELETE FROM codeitlab_tasks WHERE id = ${id} RETURNING id
      `.pipe(
        Effect.map((rows) => rows.length > 0),
        Effect.mapError(toSqlOrDecodeError("removeCodeItLabTask", "CodeItLabTask")),
      ),
  });
});

export const layer = Layer.effect(CodeItLabTasksRepository, make);
