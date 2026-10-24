import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import type { CodeitlabTask } from "@codeitlab/core/board";

import { CodeitlabTasksRepository, layer } from "./CodeitlabTasks.ts";
import { runMigrations } from "./Migrations.ts";

const task = (patch: Partial<CodeitlabTask> = {}): CodeitlabTask => ({
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
  effect: Effect.Effect<A, E, CodeitlabTasksRepository | import("effect/sql/SqlClient").SqlClient>,
) =>
  effect.pipe(
    Effect.provide(layer),
    Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" })),
  );

describe("CodeitlabTasksRepository", () => {
  it.effect("stores and lists tasks newest first", () =>
    Effect.gen(function* () {
      yield* runMigrations();
      const repository = yield* CodeitlabTasksRepository;
      yield* repository.upsert(task({ id: "a", updatedAt: "2026-10-20T10:00:00.000Z" }));
      yield* repository.upsert(task({ id: "b", updatedAt: "2026-10-21T10:00:00.000Z" }));
      const tasks = yield* repository.list;
      expect(tasks.map((entry) => entry.id)).toEqual(["b", "a"]);
    }).pipe(withRepository),
  );

  it.effect("updates a task in place and keeps its created timestamp", () =>
    Effect.gen(function* () {
      yield* runMigrations();
      const repository = yield* CodeitlabTasksRepository;
      yield* repository.upsert(task());
      yield* repository.upsert(
        task({
          title: "Fix checkout and cart",
          column: "review",
          threadId: "thread-1",
          updatedAt: "2026-10-22T10:00:00.000Z",
        }),
      );
      const tasks = yield* repository.list;
      expect(tasks).toHaveLength(1);
      expect(tasks[0]?.title).toBe("Fix checkout and cart");
      expect(tasks[0]?.column).toBe("review");
      expect(tasks[0]?.threadId).toBe("thread-1");
      expect(tasks[0]?.createdAt).toBe("2026-10-20T10:00:00.000Z");
    }).pipe(withRepository),
  );

  it.effect("removes a task", () =>
    Effect.gen(function* () {
      yield* runMigrations();
      const repository = yield* CodeitlabTasksRepository;
      yield* repository.upsert(task());
      yield* repository.remove("task-1");
      expect(yield* repository.list).toEqual([]);
    }).pipe(withRepository),
  );
});
