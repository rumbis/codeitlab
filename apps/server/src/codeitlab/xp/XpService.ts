import { CodeItLabServiceError } from "@codeitlab/core";
import {
  appendXpEvent,
  codeitlabXp,
  type CodeItLabXpEvent,
  type CodeItLabXpRecordInput,
  type CodeItLabXpRecordResult,
  type CodeItLabXpSettings,
  type CodeItLabXpState,
} from "@codeitlab/core/xp";
import { XpService as XpServiceTag } from "@codeitlab/core/services";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerSettings from "../../serverSettings.ts";

/**
 * The XP ledger for the send button.
 *
 * The rules live in `@codeitlab/core/xp`; this service owns the two things a
 * client must not control: the clock and the stored ledger. A record call names
 * an event id, the server stamps the time and ignores an id it already has, so
 * retrying a request cannot farm XP and a client cannot backdate an event.
 *
 * Nothing here awards XP on its own: an event only exists because something
 * finished (a turn, a board task). A day with no event earns no day bonus.
 */

const readError = (cause: unknown) =>
  new CodeItLabServiceError({
    operation: "xp.state",
    message: "Could not read the XP ledger from settings.",
    cause,
  });

const writeError = (cause: unknown) =>
  new CodeItLabServiceError({
    operation: "xp.record",
    message: "Could not save the XP ledger to settings.",
    cause,
  });

export const makeXpService = (settings: ServerSettings.ServerSettingsService["Service"]) => {
  const readSettings = settings.getSettings.pipe(Effect.mapError(readError));

  const state = Effect.gen(function* () {
    const current = yield* readSettings;
    const nowMs = yield* Clock.currentTimeMillis;
    return codeitlabXp(current.codeitlab.xp, DateTime.toDateUtc(DateTime.makeUnsafe(nowMs)));
  }).pipe(Effect.withSpan("Xp.state"));

  const record = Effect.fn("Xp.record")(function* (input: CodeItLabXpRecordInput) {
    const eventId = input.eventId.trim();
    if (eventId === "") {
      return yield* Effect.fail(
        new CodeItLabServiceError({
          operation: "xp.record",
          message: "An XP event needs an id so it can be counted once.",
        }),
      );
    }
    const current = yield* readSettings;
    const nowMs = yield* Clock.currentTimeMillis;
    const now = DateTime.toDateUtc(DateTime.makeUnsafe(nowMs));
    const event: CodeItLabXpEvent = { id: eventId, kind: input.kind, at: now.toISOString() };
    const appended = appendXpEvent(current.codeitlab.xp, event);
    const computed = codeitlabXp(appended.settings, now);

    if (appended.awarded) {
      // Persist the ledger and the best streak together: the streak is the only
      // aggregate that cannot be recomputed after a gap has aged out.
      const next: CodeItLabXpSettings = {
        events: appended.settings.events,
        bestStreak: computed.bestStreak,
        bestStreakDay: computed.bestStreakDay,
      };
      yield* settings
        .updateSettings({ codeitlab: { ...current.codeitlab, xp: next } })
        .pipe(Effect.mapError(writeError));
    }

    return {
      awarded: appended.awarded,
      state: computed,
    } satisfies CodeItLabXpRecordResult;
  });

  const stateEffect: Effect.Effect<CodeItLabXpState, CodeItLabServiceError> = state;

  return XpServiceTag.of({ state: stateEffect, record });
};

export const layer = Layer.effect(
  XpServiceTag,
  Effect.gen(function* () {
    const settings = yield* ServerSettings.ServerSettingsService;
    return makeXpService(settings);
  }),
);
