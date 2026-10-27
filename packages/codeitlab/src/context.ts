import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/**
 * Context sizes the provider did not report.
 *
 * The composer meter always prefers the provider's own reported limit. When a
 * provider sends token usage without a maximum, CodeItLab falls back to a value
 * the user recorded for that model, and then to a conservative family estimate.
 * Estimates are labelled as estimates in the meter; they are never presented as
 * measured limits.
 */

const TrimmedDefault = (value: string) =>
  Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(value)));

export const CodeItLabContextSize = Schema.Struct({
  /** Provider instance the value belongs to; empty means any instance. */
  instanceId: TrimmedDefault(""),
  model: TrimmedDefault(""),
  tokens: Schema.Number.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
});
export type CodeItLabContextSize = typeof CodeItLabContextSize.Type;

export const CodeItLabContextSettings = Schema.Struct({
  sizes: Schema.Array(CodeItLabContextSize).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
export type CodeItLabContextSettings = typeof CodeItLabContextSettings.Type;

export interface CodeItLabContextSizeEstimate {
  readonly match: RegExp;
  readonly tokens: number;
  readonly label: string;
}

/**
 * Family estimates, deliberately round and conservative. They exist so the meter
 * can show a percentage instead of "unknown"; the provider's own number always
 * wins, and the settings page says so.
 */
export const CONTEXT_SIZE_ESTIMATES: ReadonlyArray<CodeItLabContextSizeEstimate> = [
  { match: /claude/i, tokens: 200_000, label: "Claude family" },
  { match: /gpt-5/i, tokens: 400_000, label: "GPT-5 family" },
  { match: /gpt-4\.1/i, tokens: 1_000_000, label: "GPT-4.1 family" },
  { match: /gemini/i, tokens: 1_000_000, label: "Gemini family" },
  { match: /deepseek/i, tokens: 128_000, label: "DeepSeek family" },
  { match: /qwen/i, tokens: 128_000, label: "Qwen family" },
  { match: /kimi|moonshot/i, tokens: 256_000, label: "Kimi family" },
  { match: /glm/i, tokens: 200_000, label: "GLM family" },
  { match: /grok/i, tokens: 256_000, label: "Grok family" },
  { match: /llama/i, tokens: 128_000, label: "Llama family" },
];

export interface ResolvedContextSize {
  readonly tokens: number;
  readonly source: "recorded" | "estimate";
}

/** Exact recorded value first (instance-scoped, then any instance), then family estimate. */
export function resolveContextSize(
  sizes: ReadonlyArray<CodeItLabContextSize>,
  instanceId: string,
  model: string,
): ResolvedContextSize | null {
  const slug = model.trim();
  if (slug === "") return null;
  const exact = sizes.filter((size) => size.model.trim() === slug && size.tokens > 0);
  const scoped = exact.find((size) => size.instanceId.trim() === instanceId.trim());
  const recorded = scoped ?? exact.find((size) => size.instanceId.trim() === "");
  if (recorded !== undefined) return { tokens: recorded.tokens, source: "recorded" };
  const estimate = CONTEXT_SIZE_ESTIMATES.find((candidate) => candidate.match.test(slug));
  return estimate === undefined ? null : { tokens: estimate.tokens, source: "estimate" };
}

export function formatContextTokens(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return "unknown";
  if (tokens >= 1_000_000)
    return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 1)}M`;
  return `${Math.round(tokens / 1_000)}k`;
}
