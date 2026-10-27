import { describe, expect, it } from "vite-plus/test";

import { createBot } from "./bots.ts";

describe("createBot", () => {
  it("creates an enabled bot with empty persona and memory", () => {
    const bot = createBot(new Date("2026-10-24T12:00:00.000Z"));
    expect(bot.enabled).toBe(true);
    expect(bot.persona).toBe("");
    expect(bot.memory).toBe("");
    expect(bot.id).toContain("bot-");
  });

  it("keeps ids unique for bots created in the same millisecond", () => {
    const now = new Date("2026-10-24T12:00:00.000Z");
    expect(createBot(now).id).not.toBe(createBot(now).id);
  });
});
