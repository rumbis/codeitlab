import * as NodeSqliteClient from "@codeitlab/shared/nodeSqliteClient";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import type { CodeItLabTask } from "@codeitlab/core/board";

import { CodeItLabTasksRepository, layer } from "./CodeItLabTasks.ts";
import { runMigrations } from "./Migrations.ts";

const task = (patch: Partial<CodeItLabTask> = {}): CodeItLabTask => ({
  id: "task-1",
  title: "Fix checkout",
  notes: "",
  column: "pending",
  threadId: "",
  createdAt: "2026-10-20T10:00:00.000Z",
  updatedAt: "2026-10-20T10:00:00.000Z",
  archivedAt: "",
  completedAt: "",
  ...patch,
});

const withRepository = <A, E>(
  effect: Effect.Effect<A, E, CodeItLabTasksRepository | import("effect/sql/SqlClient").SqlClient>,
) =>
  effect.pipe(
    Effect.provide(layer),
    Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" })),
  );

describe("CodeItLabTasksRepository", () => {
  it.effect("stores and lists tasks newest first", () =>
    Effect.gen(function* () {
      yield* runMigrations();
      const repository = yield* CodeItLabTasksRepository;
      yield* repository.upsert(task({ id: "a", updatedAt: "2026-10-20T10:00:00.000Z" }));
      yield* repository.upsert(task({ id: "b", updatedAt: "2026-10-21T10:00:00.000Z" }));
      const tasks = yield* repository.list;
      expect(tasks.map((entry) => entry.id)).toEqual(["b", "a"]);
    }).pipe(withRepository),
  );

  it.effect("updates a task in place and keeps its created timestamp", () =>
    Effect.gen(function* () {
      yield* runMigrations();
      const repository = yield* CodeItLabTasksRepository;
      yield* repository.upsert(task());
      yield* repository.upsert(
        task({
          title: "Fix checkout and cart",
          column: "review",
          threadId: "thread-1",
          updatedAt: "2026-10-22T10:00:00.000Z",
          completedAt: "2026-10-22T10:00:00.000Z",
          startedAt: "2026-10-21T09:00:00.000Z",
        }),
      );
      const tasks = yield* repository.list;
      expect(tasks).toHaveLength(1);
      expect(tasks[0]?.title).toBe("Fix checkout and cart");
      expect(tasks[0]?.column).toBe("review");
      expect(tasks[0]?.threadId).toBe("thread-1");
      expect(tasks[0]?.createdAt).toBe("2026-10-20T10:00:00.000Z");
      expect(tasks[0]?.completedAt).toBe("2026-10-22T10:00:00.000Z");
      expect(tasks[0]?.startedAt).toBe("2026-10-21T09:00:00.000Z");
    }).pipe(withRepository),
  );

  it.effect("removes a task", () =>
    Effect.gen(function* () {
      yield* runMigrations();
      const repository = yield* CodeItLabTasksRepository;
      yield* repository.upsert(task());
      yield* repository.remove("task-1");
      expect(yield* repository.list).toEqual([]);
    }).pipe(withRepository),
  );
});
