import { XpService } from "@codeitlab/core/services";
import { XP_PER_ACTIVE_DAY, XP_PER_EVENT } from "@codeitlab/core/xp";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerSettings from "../../serverSettings.ts";
import * as Xp from "./XpService.ts";

/**
 * The ledger rules are pure; these tests pin the two things the service adds:
 * the server stamps the time and a repeated id is ignored. Settings are the test
 * layer, so nothing touches the real settings file.
 */

type SavedXp = {
  readonly events: ReadonlyArray<{
    readonly id: string;
    readonly kind: string;
    readonly at: string;
  }>;
  readonly bestStreak: number;
  readonly bestStreakDay: string;
};

const settingsLayer = (xp: Partial<SavedXp> = {}) =>
  ServerSettings.layerTest({
    codeitlab: {
      xp: { events: [], bestStreak: 0, bestStreakDay: "", ...xp } as never,
    },
  });

/** XpService plus the settings service it reads, so a test can inspect what was saved. */
const testLayer = (xp: Partial<SavedXp> = {}) => {
  const settings = settingsLayer(xp);
  return Layer.merge(Xp.layer.pipe(Layer.provide(settings)), settings);
};

it("starts at level 1 with nothing earned", async () => {
  const state = await Effect.runPromise(
    Effect.flatMap(XpService, (service) => service.state).pipe(Effect.provide(testLayer())),
  );
  assert.strictEqual(state.totalXp, 0);
  assert.strictEqual(state.level, 1);
  assert.strictEqual(state.streakDays, 0);
  assert.strictEqual(state.todayXp, 0);
});

it("awards a completed turn once and stamps the server time", async () => {
  const result = await Effect.runPromise(
    Effect.flatMap(XpService, (service) =>
      service.record({ kind: "turn-completed", eventId: "run-1" }),
    ).pipe(Effect.provide(testLayer())),
  );
  assert.isTrue(result.awarded);
  assert.strictEqual(result.state.totalXp, XP_PER_EVENT["turn-completed"] + XP_PER_ACTIVE_DAY);
  assert.strictEqual(result.state.todayXp, XP_PER_EVENT["turn-completed"]);
  assert.lengthOf(result.state.bestStreakDay, 10);
});

it("ignores a repeated id so a retry cannot farm XP", async () => {
  const result = await Effect.runPromise(
    Effect.flatMap(XpService, (service) =>
      Effect.gen(function* () {
        const first = yield* service.record({ kind: "turn-completed", eventId: "run-1" });
        const again = yield* service.record({ kind: "turn-completed", eventId: "run-1" });
        return { first, again };
      }),
    ).pipe(Effect.provide(testLayer())),
  );
  assert.isTrue(result.first.awarded);
  assert.isFalse(result.again.awarded);
  assert.strictEqual(result.again.state.totalXp, result.first.state.totalXp);
});

it("refuses an event without an id", async () => {
  const error = await Effect.runPromise(
    Effect.flatMap(XpService, (service) =>
      service.record({ kind: "turn-completed", eventId: "   " }),
    ).pipe(Effect.provide(testLayer()), Effect.flip),
  );
  assert.strictEqual(error._tag, "CodeItLabServiceError");
  assert.include(error.message, "needs an id");
});

it("persists the ledger and the best streak across reads", async () => {
  const states = await Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* XpService;
      yield* service.record({ kind: "quest-completed", eventId: "task-1" });
      const after = yield* service.state;
      const settings = yield* ServerSettings.ServerSettingsService;
      const saved = yield* settings.getSettings;
      return { after, saved };
    }).pipe(Effect.provide(testLayer())),
  );
  assert.strictEqual(states.after.totalXp, XP_PER_EVENT["quest-completed"] + XP_PER_ACTIVE_DAY);
  assert.lengthOf(states.saved.codeitlab.xp.events, 1);
  assert.strictEqual(states.saved.codeitlab.xp.events[0]?.id, "task-1");
});

it("recomputes XP from the ledger instead of trusting a stored total", async () => {
  const state = await Effect.runPromise(
    Effect.flatMap(XpService, (service) => service.state).pipe(
      Effect.provide(
        testLayer({
          events: [
            { id: "run-1", kind: "turn-completed", at: "2026-10-25T09:00:00.000Z" },
            { id: "run-2", kind: "turn-completed", at: "2026-10-24T09:00:00.000Z" },
          ],
        }),
      ),
    ),
  );
  assert.strictEqual(state.totalXp, 2 * XP_PER_EVENT["turn-completed"] + 2 * XP_PER_ACTIVE_DAY);
  assert.strictEqual(state.streakDays, 2);
});
