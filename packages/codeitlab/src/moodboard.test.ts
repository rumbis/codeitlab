import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  CodeItLabMoodBoardsSettings,
  moodBoardBrief,
  moodBoardIssue,
  moodBoardMarkdown,
  normalizeHexColor,
  type CodeItLabMoodBoard,
} from "./moodboard.ts";

const decode = Schema.decodeSync(CodeItLabMoodBoardsSettings);

const board = (patch: Partial<CodeItLabMoodBoard>): CodeItLabMoodBoard => ({
  ...decode({}).boards[0]!,
  id: "mood-1",
  name: "Launch",
  projectId: "",
  colors: [{ hex: "#112233", name: "Ink" }],
  images: [],
  notes: [],
  ...patch,
});

describe("mood boards", () => {
  it("decodes an empty block", () => {
    expect(decode({}).boards).toEqual([]);
  });

  it("normalizes hex colours and rejects junk", () => {
    expect(normalizeHexColor("abc")).toBe("#aabbcc");
    expect(normalizeHexColor("#ABC")).toBe("#aabbcc");
    expect(normalizeHexColor(" #112233 ")).toBe("#112233");
    expect(normalizeHexColor("blue")).toBeNull();
    expect(normalizeHexColor("#12345")).toBeNull();
    expect(normalizeHexColor("")).toBeNull();
  });

  it("requires a name and at least one entry", () => {
    expect(moodBoardIssue(board({}))).toBeNull();
    expect(moodBoardIssue(board({ name: " " }))).toContain("name");
    expect(moodBoardIssue(board({ colors: [], images: [], notes: [] }))).toContain("at least one");
  });

  it("writes markdown with only the sections that exist", () => {
    const markdown = moodBoardMarkdown(
      board({
        images: [{ url: "https://example.com/ref.png", caption: "Dense UI" }],
        notes: ["No gradients"],
      }),
    );
    expect(markdown).toContain("# Mood: Launch");
    expect(markdown).toContain("`#112233` — Ink");
    expect(markdown).toContain("https://example.com/ref.png — Dense UI");
    expect(markdown).toContain("- No gradients");
    expect(moodBoardMarkdown(board({ images: [], notes: [] }))).not.toContain("## References");
  });

  it("tells the agent not to invent a reference it cannot fetch", () => {
    expect(moodBoardBrief(board({}))).toContain("instead of inventing what it looks like");
  });
});
