import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/**
 * XP, level and streak for the send button.
 *
 * The rules are deliberately small and deterministic: XP comes from events the
 * server actually saw (a finished turn, a finished board task), plus a small
 * per-day bonus for days that had at least one such event. A day with no result
 * earns nothing, so the number can only grow when something was finished.
 *
 * Everything here is pure. The server owns the ledger and stamps the time; the
 * UI only renders what `codeitlabXp` returns.
 */

const TrimmedDefault = (value: string) =>
  Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(value)));
const NumberDefault = (value: number) =>
  Schema.Number.pipe(Schema.withDecodingDefault(Effect.succeed(value)));

export const CodeItLabXpEventKind = Schema.Literals(["turn-completed", "quest-completed"]);
export type CodeItLabXpEventKind = typeof CodeItLabXpEventKind.Type;

export const CodeItLabXpEvent = Schema.Struct({
  /** Stable id from the thing that happened (run id, task id), used for dedupe. */
  id: Schema.String,
  kind: CodeItLabXpEventKind,
  /** ISO timestamp written by the server, never by the client. */
  at: Schema.String,
});
export type CodeItLabXpEvent = typeof CodeItLabXpEvent.Type;

export const CodeItLabXpSettings = Schema.Struct({
  /** Bounded ledger, oldest first. Deduped by id. */
  events: Schema.Array(CodeItLabXpEvent).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  /** Best streak ever reached, kept so a gap does not erase the record. */
  bestStreak: NumberDefault(0),
  bestStreakDay: TrimmedDefault(""),
});
export type CodeItLabXpSettings = typeof CodeItLabXpSettings.Type;

export const CodeItLabXpRecordInput = Schema.Struct({
  kind: CodeItLabXpEventKind,
  eventId: Schema.String,
});
export type CodeItLabXpRecordInput = typeof CodeItLabXpRecordInput.Type;

/** XP is an integer so a level never depends on float accumulation. */
export const XP_PER_EVENT: Readonly<Record<CodeItLabXpEventKind, number>> = {
  "turn-completed": 10,
  "quest-completed": 50,
};
/** One small bonus per UTC day that had at least one real event. */
export const XP_PER_ACTIVE_DAY = 5;
/** The ledger is bounded: old events fall off, XP is recomputed from what is left. */
export const MAX_XP_EVENTS = 500;

export const CodeItLabXpState = Schema.Struct({
  totalXp: Schema.Number,
  level: Schema.Number,
  levelLabel: Schema.String,
  /** XP earned since the current level started. */
  xpIntoLevel: Schema.Number,
  /** XP the current level needs in total (the next threshold). */
  xpForNextLevel: Schema.Number,
  /** 0..1 fill for the level ring. */
  progress: Schema.Number,
  streakDays: Schema.Number,
  bestStreak: Schema.Number,
  bestStreakDay: Schema.String,
  todayXp: Schema.Number,
  /** Number of events in the ledger that count. */
  awardedEvents: Schema.Number,
});
export type CodeItLabXpState = typeof CodeItLabXpState.Type;

export const CodeItLabXpRecordResult = Schema.Struct({
  /** False when the id was already in the ledger; the state is unchanged then. */
  awarded: Schema.Boolean,
  state: CodeItLabXpState,
});
export type CodeItLabXpRecordResult = typeof CodeItLabXpRecordResult.Type;

const DAY_MS = 24 * 60 * 60 * 1000;

export function xpDay(iso: string): string {
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? "" : new Date(parsed).toISOString().slice(0, 10);
}

function dayNumber(day: string): number {
  return Math.floor(Date.parse(day + "T00:00:00.000Z") / DAY_MS);
}

/**
 * Level n starts at 50·(n-1)·n XP: 0, 100, 300, 600, 1000… so the first levels
 * arrive quickly and later ones take real work. Exported for tests.
 */
export function levelStartXp(level: number): number {
  const safe = Math.max(1, Math.floor(level));
  return 50 * (safe - 1) * safe;
}

export function levelForXp(totalXp: number): number {
  let level = 1;
  while (levelStartXp(level + 1) <= totalXp) level += 1;
  return level;
}

export function appendXpEvent(
  settings: CodeItLabXpSettings,
  event: CodeItLabXpEvent,
): { readonly settings: CodeItLabXpSettings; readonly awarded: boolean } {
  const id = event.id.trim();
  // An event without an id cannot be deduped, so it cannot be trusted to add XP.
  if (id === "") return { settings, awarded: false };
  if (settings.events.some((entry) => entry.id === id)) {
    return { settings, awarded: false };
  }
  const events = [...settings.events, { ...event, id }].slice(-MAX_XP_EVENTS);
  return { settings: { ...settings, events }, awarded: true };
}

/**
 * Recomputes everything from the ledger. The saved best streak is the only
 * stored aggregate: XP, level and the current streak are derived, so editing
 * the ledger (or dropping old events) cannot leave a total that disagrees.
 */
export function codeitlabXp(
  settings: CodeItLabXpSettings,
  now: Date,
  saved: { readonly bestStreak: number; readonly bestStreakDay: string } = {
    bestStreak: settings.bestStreak,
    bestStreakDay: settings.bestStreakDay,
  },
): CodeItLabXpState {
  const days = new Set<string>();
  let eventXp = 0;
  for (const event of settings.events) {
    const day = xpDay(event.at);
    if (day !== "") days.add(day);
    eventXp += XP_PER_EVENT[event.kind] ?? 0;
  }
  const activeDays = days.size;
  const totalXp = eventXp + activeDays * XP_PER_ACTIVE_DAY;

  const today = xpDay(now.toISOString());
  const todayNumber = dayNumber(today);
  const sortedDays = [...days].sort().toReversed();

  let streakDays = 0;
  if (sortedDays.length > 0) {
    const newest = dayNumber(sortedDays[0] as string);
    // Same rule as the board: a streak survives until the end of today.
    if (newest === todayNumber || newest === todayNumber - 1) {
      let expected = newest;
      for (const day of sortedDays) {
        if (dayNumber(day) !== expected) break;
        streakDays += 1;
        expected -= 1;
      }
    }
  }

  const bestStreak = Math.max(saved.bestStreak, streakDays);
  const bestStreakDay =
    streakDays > saved.bestStreak && streakDays > 0
      ? (sortedDays[0] as string)
      : saved.bestStreakDay;

  const level = levelForXp(totalXp);
  const levelStart = levelStartXp(level);
  const nextLevelXp = levelStartXp(level + 1);
  const span = nextLevelXp - levelStart;
  const todayXp = settings.events.reduce(
    (total, event) => (xpDay(event.at) === today ? total + (XP_PER_EVENT[event.kind] ?? 0) : total),
    0,
  );

  return {
    totalXp,
    level,
    levelLabel: "Level " + level,
    xpIntoLevel: totalXp - levelStart,
    xpForNextLevel: nextLevelXp,
    progress: span <= 0 ? 0 : Math.min(1, (totalXp - levelStart) / span),
    streakDays,
    bestStreak,
    bestStreakDay,
    todayXp,
    awardedEvents: settings.events.length,
  };
}
