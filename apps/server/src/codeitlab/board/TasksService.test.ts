import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { CodeitlabTasksService } from "@codeitlab/core/services";
import type { CodeitlabTask } from "@codeitlab/core/board";

import { runMigrations } from "../../persistence/Migrations.ts";
import { layer as repositoryLayer } from "../../persistence/CodeitlabTasks.ts";
import { layer as serviceLayer } from "./TasksService.ts";

const task = (patch: Partial<CodeitlabTask> = {}): CodeitlabTask => ({
  id: "task-1",
  title: "Fix checkout",
  notes: "",
  column: "pending",
  threadId: "",
  createdAt: "2026-10-20T10:00:00.000Z",
  updatedAt: "2026-10-20T10:00:00.000Z",
  archivedAt: "",
  ...patch,
});

const TestLayer = serviceLayer.pipe(
  Layer.provide(repositoryLayer),
  Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" })),
);

describe("CodeitlabTasksService", () => {
  it.effect("round-trips a task through the database", () =>
    Effect.gen(function* () {
      yield* runMigrations();
      const service = yield* CodeitlabTasksService;
      yield* service.upsert(task());
      yield* service.upsert(task({ column: "review", updatedAt: "2026-10-21T10:00:00.000Z" }));
      const tasks = yield* service.list;
      expect(tasks).toHaveLength(1);
      expect(tasks[0]?.column).toBe("review");
      expect(yield* service.remove("task-1")).toBe(true);
      expect(yield* service.list).toEqual([]);
    }).pipe(Effect.provide(TestLayer)),
  );
});
