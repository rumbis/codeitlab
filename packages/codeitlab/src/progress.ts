import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { CodeItLabTask } from "./board.ts";

/**
 * Progress counts what the board actually finished. It is deliberately small:
 * no points, no badges, no levels - just how many tasks were completed and how
 * many days in a row something was finished. Days are UTC calendar days, so the
 * same board produces the same streak on every machine.
 */

const TrimmedDefault = (value: string) =>
  Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(value)));

export const CodeItLabProgressSettings = Schema.Struct({
  /** Longest streak already observed, kept so a gap does not erase the record. */
  bestStreak: Schema.Number.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
  /** UTC day of the best streak, for the honest "when" in the UI. */
  bestStreakDay: TrimmedDefault(""),
});
export type CodeItLabProgressSettings = typeof CodeItLabProgressSettings.Type;

export interface CodeItLabProgress {
  readonly completedCount: number;
  readonly currentStreak: number;
  readonly bestStreak: number;
  readonly bestStreakDay: string;
  readonly lastCompletedDay: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function utcDay(iso: string): string {
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? "" : new Date(parsed).toISOString().slice(0, 10);
}

function dayNumber(day: string): number {
  return Math.floor(Date.parse(`${day}T00:00:00.000Z`) / DAY_MS);
}

/**
 * Completed days come from the tasks themselves, so moving a task back out of
 * Completed removes its day: the number follows the board, not a hidden counter.
 */
export function completedDays(tasks: ReadonlyArray<CodeItLabTask>): ReadonlyArray<string> {
  const days = new Set<string>();
  for (const task of tasks) {
    if (task.column !== "completed") continue;
    // Completion time, not the last edit: editing notes must not move the day.
    const day = utcDay(task.completedAt !== "" ? task.completedAt : task.updatedAt);
    if (day !== "") days.add(day);
  }
  return [...days].sort().reverse();
}

export function codeitlabProgress(
  tasks: ReadonlyArray<CodeItLabTask>,
  now: Date,
  saved: CodeItLabProgressSettings = { bestStreak: 0, bestStreakDay: "" },
): CodeItLabProgress {
  const days = completedDays(tasks);
  const today = dayNumber(now.toISOString().slice(0, 10));
  const completedCount = tasks.filter((task) => task.column === "completed").length;

  let currentStreak = 0;
  if (days.length > 0) {
    const newest = dayNumber(days[0] as string);
    // A streak survives until the end of today: finishing yesterday keeps it
    // alive, but a full empty day ends it.
    if (newest === today || newest === today - 1) {
      let expected = newest;
      for (const day of days) {
        if (dayNumber(day) !== expected) break;
        currentStreak += 1;
        expected -= 1;
      }
    }
  }

  const bestStreak =
    currentStreak > saved.bestStreak ? currentStreak : Math.max(saved.bestStreak, currentStreak);
  const bestStreakDay = currentStreak > saved.bestStreak ? (days[0] ?? "") : saved.bestStreakDay;

  return {
    completedCount,
    currentStreak,
    bestStreak,
    bestStreakDay,
    lastCompletedDay: days[0] ?? "",
  };
}
