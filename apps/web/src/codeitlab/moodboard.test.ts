import { describe, expect, it } from "vite-plus/test";

import { createMoodBoard } from "./moodboard.ts";

describe("createMoodBoard", () => {
  it("creates an empty board with a unique id", () => {
    const now = new Date("2026-10-24T12:00:00.000Z");
    const first = createMoodBoard(now);
    expect(first.colors).toEqual([]);
    expect(first.images).toEqual([]);
    expect(first.notes).toEqual([]);
    expect(first.id).not.toBe(createMoodBoard(now).id);
  });
});
