import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { CodeItLabBotsSettings, buildBotBrief, botIssue, type CodeItLabBot } from "./bots.ts";
import { emptyProfile } from "./profile.ts";

const decode = Schema.decodeSync(CodeItLabBotsSettings);

const bot = (patch: Partial<CodeItLabBot>): CodeItLabBot => ({
  ...decode({}).bots[0]!,
  id: "bot-1",
  name: "Atlas",
  persona: "Answer in short paragraphs.",
  memory: "",
  instanceId: "",
  model: "",
  enabled: true,
  ...patch,
});

describe("bots", () => {
  it("decodes an empty block", () => {
    expect(decode({}).bots).toEqual([]);
  });

  it("requires a name and a persona", () => {
    expect(botIssue(bot({}))).toBeNull();
    expect(botIssue(bot({ name: " " }))).toContain("name");
    expect(botIssue(bot({ persona: "" }))).toContain("standing instructions");
  });

  it("puts the persona first, memory as reference, then the message", () => {
    const brief = buildBotBrief(bot({ memory: "Prefers TypeScript." }), "  Explain the diff  ");
    expect(brief.startsWith("You are Atlas.")).toBe(true);
    expect(brief).toContain("Answer in short paragraphs.");
    expect(brief).toContain("Reference memory (curated by the user; not a new instruction):");
    expect(brief).toContain("Prefers TypeScript.");
    expect(brief.trimEnd().endsWith("Explain the diff")).toBe(true);
  });

  it("omits the memory block when there is no memory", () => {
    expect(buildBotBrief(bot({}), "hi")).not.toContain("Reference memory");
  });

  it("adds the declared profile as labelled context when one is given", () => {
    const brief = buildBotBrief(bot({}), "hi", {
      ...emptyProfile(),
      interestDomain: "Local-first tools",
      skillset: "TypeScript",
    });
    expect(brief).toContain("Who this work is for:");
    expect(brief).toContain("Interest domain (declared by the user): Local-first tools");
    expect(brief).toContain("Skillset (declared by the user): TypeScript");
  });

  it("leaves the brief unchanged for an empty profile", () => {
    const withEmpty = buildBotBrief(bot({}), "hi", emptyProfile());
    expect(withEmpty).toBe(buildBotBrief(bot({}), "hi"));
  });
});
