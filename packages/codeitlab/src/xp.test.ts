import { describe, expect, it } from "vite-plus/test";
import {
  MAX_XP_EVENTS,
  XP_PER_ACTIVE_DAY,
  XP_PER_EVENT,
  appendXpEvent,
  codeitlabXp,
  levelForXp,
  levelStartXp,
  type CodeItLabXpEvent,
  type CodeItLabXpSettings,
} from "./xp.ts";

const empty: CodeItLabXpSettings = { events: [], bestStreak: 0, bestStreakDay: "" };

function event(id: string, kind: CodeItLabXpEvent["kind"], at: string): CodeItLabXpEvent {
  return { id, kind, at };
}

const NOW = new Date("2026-10-25T12:00:00.000Z");

describe("level curve", () => {
  it("starts the next level at 50·(n-1)·n XP", () => {
    expect(levelStartXp(1)).toBe(0);
    expect(levelStartXp(2)).toBe(100);
    expect(levelStartXp(3)).toBe(300);
    expect(levelStartXp(4)).toBe(600);
  });

  it("puts a total on the level whose threshold it just crossed", () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(99)).toBe(1);
    expect(levelForXp(100)).toBe(2);
    expect(levelForXp(299)).toBe(2);
    expect(levelForXp(300)).toBe(3);
    expect(levelForXp(1_000_000)).toBeGreaterThan(100);
  });
});

describe("appendXpEvent", () => {
  it("counts a new event once", () => {
    const first = appendXpEvent(empty, event("run-1", "turn-completed", NOW.toISOString()));
    expect(first.awarded).toBe(true);
    expect(first.settings.events).toHaveLength(1);
  });

  it("ignores a repeated id so a retry cannot farm XP", () => {
    const first = appendXpEvent(empty, event("run-1", "turn-completed", NOW.toISOString()));
    const again = appendXpEvent(
      first.settings,
      event("run-1", "turn-completed", NOW.toISOString()),
    );
    expect(again.awarded).toBe(false);
    expect(again.settings).toBe(first.settings);
  });

  it("refuses an event without an id", () => {
    const result = appendXpEvent(empty, event("  ", "turn-completed", NOW.toISOString()));
    expect(result.awarded).toBe(false);
    expect(result.settings.events).toHaveLength(0);
  });

  it("bounds the ledger so the settings file cannot grow forever", () => {
    let settings = empty;
    for (let index = 0; index < MAX_XP_EVENTS + 10; index += 1) {
      settings = appendXpEvent(
        settings,
        event("run-" + index, "turn-completed", NOW.toISOString()),
      ).settings;
    }
    expect(settings.events).toHaveLength(MAX_XP_EVENTS);
    expect(settings.events[settings.events.length - 1]?.id).toBe("run-" + (MAX_XP_EVENTS + 9));
  });
});

describe("codeitlabXp", () => {
  it("is deterministic for the same ledger and clock", () => {
    const settings: CodeItLabXpSettings = {
      events: [
        event("run-1", "turn-completed", "2026-10-25T09:00:00.000Z"),
        event("task-1", "quest-completed", "2026-10-24T18:00:00.000Z"),
      ],
      bestStreak: 0,
      bestStreakDay: "",
    };
    expect(codeitlabXp(settings, NOW)).toEqual(codeitlabXp(settings, NOW));
  });

  it("awards event XP plus a bonus only for days that had an event", () => {
    const settings: CodeItLabXpSettings = {
      events: [
        event("run-1", "turn-completed", "2026-10-25T09:00:00.000Z"),
        event("run-2", "turn-completed", "2026-10-25T10:00:00.000Z"),
        event("task-1", "quest-completed", "2026-10-24T18:00:00.000Z"),
      ],
      bestStreak: 0,
      bestStreakDay: "",
    };
    const state = codeitlabXp(settings, NOW);
    expect(state.totalXp).toBe(
      2 * XP_PER_EVENT["turn-completed"] + XP_PER_EVENT["quest-completed"] + 2 * XP_PER_ACTIVE_DAY,
    );
    expect(state.todayXp).toBe(2 * XP_PER_EVENT["turn-completed"]);
    expect(state.awardedEvents).toBe(3);
  });

  it("gives an empty ledger nothing at all", () => {
    const state = codeitlabXp(empty, NOW);
    expect(state.totalXp).toBe(0);
    expect(state.level).toBe(1);
    expect(state.progress).toBe(0);
    expect(state.streakDays).toBe(0);
    expect(state.todayXp).toBe(0);
  });

  it("keeps a streak that includes today or ends yesterday", () => {
    const settings: CodeItLabXpSettings = {
      events: [
        event("a", "turn-completed", "2026-10-25T08:00:00.000Z"),
        event("b", "turn-completed", "2026-10-24T08:00:00.000Z"),
        event("c", "turn-completed", "2026-10-23T08:00:00.000Z"),
      ],
      bestStreak: 0,
      bestStreakDay: "",
    };
    expect(codeitlabXp(settings, NOW).streakDays).toBe(3);
  });

  it("ends a streak after a full empty day", () => {
    const settings: CodeItLabXpSettings = {
      events: [
        event("b", "turn-completed", "2026-10-23T08:00:00.000Z"),
        event("c", "turn-completed", "2026-10-22T08:00:00.000Z"),
      ],
      bestStreak: 4,
      bestStreakDay: "2026-10-20",
    };
    const state = codeitlabXp(settings, NOW);
    expect(state.streakDays).toBe(0);
    // The record survives a gap: that is the point of storing it.
    expect(state.bestStreak).toBe(4);
    expect(state.bestStreakDay).toBe("2026-10-20");
  });

  it("records a new best streak and the day it happened", () => {
    const settings: CodeItLabXpSettings = {
      events: [
        event("a", "turn-completed", "2026-10-25T08:00:00.000Z"),
        event("b", "turn-completed", "2026-10-24T08:00:00.000Z"),
      ],
      bestStreak: 1,
      bestStreakDay: "2026-10-01",
    };
    const state = codeitlabXp(settings, NOW);
    expect(state.bestStreak).toBe(2);
    expect(state.bestStreakDay).toBe("2026-10-25");
  });

  it("derives level, ring progress and the next threshold from the total", () => {
    // 12 turns over two days: 120 + 10 = 130 XP, level 2 (100..300).
    const events = Array.from({ length: 12 }, (_, index) =>
      event(
        "run-" + index,
        "turn-completed",
        index < 6 ? "2026-10-25T09:00:00.000Z" : "2026-10-24T09:00:00.000Z",
      ),
    );
    const state = codeitlabXp({ events, bestStreak: 0, bestStreakDay: "" }, NOW);
    expect(state.totalXp).toBe(130);
    expect(state.level).toBe(2);
    expect(state.xpIntoLevel).toBe(30);
    expect(state.xpForNextLevel).toBe(300);
    expect(state.progress).toBeCloseTo(30 / 200, 5);
  });

  it("ignores an event with an unparseable timestamp for the streak but still counts its XP", () => {
    const settings: CodeItLabXpSettings = {
      events: [event("a", "turn-completed", "not-a-date")],
      bestStreak: 0,
      bestStreakDay: "",
    };
    const state = codeitlabXp(settings, NOW);
    expect(state.totalXp).toBe(XP_PER_EVENT["turn-completed"]);
    expect(state.streakDays).toBe(0);
    expect(state.todayXp).toBe(0);
  });
});
