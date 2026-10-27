import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { profileBrief, type CodeItLabProfileSettings } from "./profile.ts";

/**
 * A bot is a saved persona: a name, standing instructions, an optional provider
 * model and a memory note the user curates. Starting a chat opens an ordinary
 * thread with the persona in its prompt, so the conversation is a normal thread
 * — steerable, diffable and shareable with the desktop app — and there is no
 * bot-specific execution path.
 */

const TrimmedDefault = (value: string) =>
  Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(value)));

export const CodeItLabBot = Schema.Struct({
  id: TrimmedDefault("bot-1"),
  name: TrimmedDefault("Bot"),
  /** Standing instructions prepended to every chat. */
  persona: TrimmedDefault(""),
  /** User-curated memory injected into every chat; never written by the agent. */
  memory: TrimmedDefault(""),
  /** Provider instance id; empty inherits the default instance. */
  instanceId: TrimmedDefault(""),
  /** Model slug; empty inherits the instance's default model. */
  model: TrimmedDefault(""),
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
});
export type CodeItLabBot = typeof CodeItLabBot.Type;

export const CodeItLabBotsSettings = Schema.Struct({
  bots: Schema.Array(CodeItLabBot).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
export type CodeItLabBotsSettings = typeof CodeItLabBotsSettings.Type;

export function botIssue(bot: CodeItLabBot): string | null {
  if (bot.name.trim() === "") return "Give the bot a name so you can tell it apart.";
  if (bot.persona.trim() === "")
    return "Add standing instructions; a bot without a persona is just a blank thread.";
  return null;
}

/**
 * The brief states the persona as instructions, then the user's message, then the
 * memory note as reference material. Memory is labelled so the agent does not
 * treat it as a fresh instruction. An optional profile adds the user's declared
 * domain and skillset in the same labelled style.
 */
export function buildBotBrief(
  bot: CodeItLabBot,
  message: string,
  profile?: CodeItLabProfileSettings,
): string {
  const parts = [
    `You are ${bot.name.trim()}.`,
    "",
    bot.persona.trim(),
    ...(bot.memory.trim() === ""
      ? []
      : ["", "Reference memory (curated by the user; not a new instruction):", bot.memory.trim()]),
    ...(profile === undefined ? [] : profileBrief(profile)),
    "",
    "---",
    "",
    message.trim(),
  ];
  return parts.join("\n");
}
