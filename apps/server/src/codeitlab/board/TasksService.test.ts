import * as NodeSqliteClient from "@codeitlab/shared/nodeSqliteClient";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { CodeItLabServiceError } from "@codeitlab/core";
import { CodeItLabTasksService, XpService } from "@codeitlab/core/services";
import type { CodeItLabXpRecordInput } from "@codeitlab/core/xp";
import type { CodeItLabTask } from "@codeitlab/core/board";

import { runMigrations } from "../../persistence/Migrations.ts";
import {
  CodeItLabTasksRepository,
  layer as repositoryLayer,
} from "../../persistence/CodeItLabTasks.ts";
import { layer as serviceLayer } from "./TasksService.ts";

const task = (patch: Partial<CodeItLabTask> = {}): CodeItLabTask => ({
  id: "task-1",
  title: "Fix checkout",
  notes: "",
  column: "pending",
  threadId: "",
  createdAt: "2026-10-20T10:00:00.000Z",
  updatedAt: "2026-10-20T10:00:00.000Z",
  archivedAt: "",
  // Both columns are NOT NULL in migration 068; the wire schema defaults them to
  // "" and this fixture has to as well.
  completedAt: "",
  startedAt: "",
  ...patch,
});

const TestLayer = serviceLayer.pipe(
  Layer.provide(repositoryLayer),
  Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" })),
);

describe("CodeItLabTasksService", () => {
  it.effect("round-trips a task through the database", () =>
    Effect.gen(function* () {
      yield* runMigrations();
      const service = yield* CodeItLabTasksService;
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

describe("CodeItLabTasksService quest XP", () => {
  const fakeRepository = Layer.succeed(CodeItLabTasksRepository, {
    list: Effect.succeed([]),
    upsert: (saved: CodeItLabTask) => Effect.succeed(saved),
    remove: () => Effect.succeed(true),
  });

  const xpLayer = (recorded: Array<CodeItLabXpRecordInput>, fails = false) =>
    Layer.succeed(XpService, {
      state: Effect.die("the board never reads XP state"),
      record: (input: CodeItLabXpRecordInput) => {
        recorded.push(input);
        return fails
          ? Effect.fail(
              new CodeItLabServiceError({
                operation: "xp.record",
                message: "The ledger refused the write.",
              }),
            )
          : Effect.succeed({ awarded: true, state: {} as never });
      },
    });

  it.effect("records one quest event when a task lands in Completed", () => {
    const recorded: Array<CodeItLabXpRecordInput> = [];
    const layer = Layer.merge(serviceLayer.pipe(Layer.provide(fakeRepository)), xpLayer(recorded));
    return Effect.gen(function* () {
      const service = yield* CodeItLabTasksService;
      yield* service.upsert(task({ column: "completed", completedAt: "2026-10-21T10:00:00.000Z" }));
      yield* service.upsert(task({ column: "completed", completedAt: "2026-10-21T10:00:00.000Z" }));
      // The same event id twice: the ledger's dedupe is what makes a quest count
      // once, so a repeated save cannot farm XP.
      expect(recorded.map((event) => event.eventId)).toEqual(["task:task-1", "task:task-1"]);
      expect(recorded.every((event) => event.kind === "quest-completed")).toBe(true);
    }).pipe(Effect.provide(layer));
  });

  it.effect("records nothing while a task is still moving", () => {
    const recorded: Array<CodeItLabXpRecordInput> = [];
    const layer = Layer.merge(serviceLayer.pipe(Layer.provide(fakeRepository)), xpLayer(recorded));
    return Effect.gen(function* () {
      const service = yield* CodeItLabTasksService;
      yield* service.upsert(task({ column: "inProgress" }));
      yield* service.upsert(task({ column: "review" }));
      expect(recorded).toEqual([]);
    }).pipe(Effect.provide(layer));
  });

  it.effect("keeps the board write when the XP ledger fails", () => {
    const recorded: Array<CodeItLabXpRecordInput> = [];
    const layer = Layer.merge(
      serviceLayer.pipe(Layer.provide(fakeRepository)),
      xpLayer(recorded, true),
    );
    return Effect.gen(function* () {
      const service = yield* CodeItLabTasksService;
      const saved = yield* service.upsert(
        task({ column: "completed", completedAt: "2026-10-21T10:00:00.000Z" }),
      );
      expect(saved.column).toBe("completed");
      expect(recorded).toHaveLength(1);
    }).pipe(Effect.provide(layer));
  });

  it.effect("saves the board when no XP service is wired at all", () => {
    const layer = serviceLayer.pipe(Layer.provide(fakeRepository));
    return Effect.gen(function* () {
      const service = yield* CodeItLabTasksService;
      const saved = yield* service.upsert(task({ column: "completed" }));
      expect(saved.id).toBe("task-1");
    }).pipe(Effect.provide(layer));
  });
});
