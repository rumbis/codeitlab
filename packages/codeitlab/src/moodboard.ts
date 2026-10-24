import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/**
 * Mood boards are design intent the agent can read: a palette, reference images
 * and short notes, saved per project and turned into a brief. They are plain
 * settings — no canvas state, no binary blobs — so a board stays diffable and
 * can be handed to any provider without a second execution path.
 */

const TrimmedDefault = (value: string) =>
  Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(value)));

export const CodeitlabMoodColor = Schema.Struct({
  hex: TrimmedDefault("#888888"),
  name: TrimmedDefault(""),
});
export type CodeitlabMoodColor = typeof CodeitlabMoodColor.Type;

export const CodeitlabMoodImage = Schema.Struct({
  url: TrimmedDefault(""),
  caption: TrimmedDefault(""),
});
export type CodeitlabMoodImage = typeof CodeitlabMoodImage.Type;

export const CodeitlabMoodBoard = Schema.Struct({
  id: TrimmedDefault("mood-1"),
  name: TrimmedDefault("Mood board"),
  /** Project the board belongs to; empty means it applies to any project. */
  projectId: TrimmedDefault(""),
  colors: Schema.Array(CodeitlabMoodColor).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  images: Schema.Array(CodeitlabMoodImage).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  notes: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
export type CodeitlabMoodBoard = typeof CodeitlabMoodBoard.Type;

export const CodeitlabMoodBoardsSettings = Schema.Struct({
  boards: Schema.Array(CodeitlabMoodBoard).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
export type CodeitlabMoodBoardsSettings = typeof CodeitlabMoodBoardsSettings.Type;

const HEX_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Accepts `#rgb`/`#rrggbb`, with or without the leading `#`. */
export function normalizeHexColor(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const withHash = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  if (!HEX_PATTERN.test(withHash)) return null;
  const body = withHash.slice(1);
  return body.length === 3
    ? `#${body
        .split("")
        .map((char) => char + char)
        .join("")}`.toLowerCase()
    : withHash.toLowerCase();
}

export function moodBoardIssue(board: CodeitlabMoodBoard): string | null {
  if (board.name.trim() === "") return "Give the board a name.";
  if (board.colors.length === 0 && board.images.length === 0 && board.notes.length === 0)
    return "Add at least one colour, image or note; an empty board has nothing to say.";
  return null;
}

/** Markdown the agent can read, also used by the Copy action. */
export function moodBoardMarkdown(board: CodeitlabMoodBoard): string {
  const lines = [`# Mood: ${board.name.trim() || "Untitled"}`, ""];
  const colors = board.colors.filter((color) => color.hex.trim() !== "");
  if (colors.length > 0) {
    lines.push("## Palette", "");
    for (const color of colors) {
      lines.push(
        `- \`${color.hex.trim()}\`${color.name.trim() === "" ? "" : ` — ${color.name.trim()}`}`,
      );
    }
    lines.push("");
  }
  const images = board.images.filter((image) => image.url.trim() !== "");
  if (images.length > 0) {
    lines.push("## References", "");
    for (const image of images) {
      lines.push(
        `- ${image.url.trim()}${image.caption.trim() === "" ? "" : ` — ${image.caption.trim()}`}`,
      );
    }
    lines.push("");
  }
  const notes = board.notes.map((note) => note.trim()).filter((note) => note !== "");
  if (notes.length > 0) {
    lines.push("## Notes", "");
    for (const note of notes) lines.push(`- ${note}`);
    lines.push("");
  }
  return lines.join("\n").trimEnd() + "\n";
}

/** The prompt sent to a thread; it asks for restraint rather than a redesign. */
export function moodBoardBrief(board: CodeitlabMoodBoard): string {
  return [
    "Use this mood board as design intent for the next change.",
    "",
    moodBoardMarkdown(board),
    "Rules:",
    "- Follow the palette and references where they apply; do not restyle unrelated screens.",
    "- Keep contrast readable: a colour that fails on text is an accent, not a background.",
    "- If a reference cannot be fetched, say so instead of inventing what it looks like.",
  ].join("\n");
}
