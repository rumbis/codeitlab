import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/**
 * Goal budgets are a warning, not a stop.
 *
 * CodeItLab cannot cancel a provider run mid-turn without the orchestration layer
 * agreeing to it, so a budget never claims to enforce anything: it records what the
 * user is willing to spend on a thread and the composer says plainly when usage
 * crosses it. Anything stronger would be a lie in the UI.
 */

const TrimmedDefault = (value: string) =>
  Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(value)));

export const CodeitlabThreadBudget = Schema.Struct({
  threadId: TrimmedDefault(""),
  /** Token budget for the thread's whole life; 0 means no budget. */
  tokens: Schema.Number.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
  note: TrimmedDefault(""),
});
export type CodeitlabThreadBudget = typeof CodeitlabThreadBudget.Type;

export const CodeitlabBudgetSettings = Schema.Struct({
  budgets: Schema.Array(CodeitlabThreadBudget).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
export type CodeitlabBudgetSettings = typeof CodeitlabBudgetSettings.Type;

export type BudgetStatus = "ok" | "near" | "over";

export interface BudgetProgress {
  readonly usedTokens: number;
  readonly budgetTokens: number;
  readonly ratio: number;
  readonly remainingTokens: number;
  readonly status: BudgetStatus;
}

/** Warn at 80%, call it over at 100%; never negative, never above the budget twice. */
export function budgetProgress(usedTokens: number, budgetTokens: number): BudgetProgress | null {
  if (!Number.isFinite(usedTokens) || !Number.isFinite(budgetTokens) || budgetTokens <= 0)
    return null;
  const used = Math.max(0, usedTokens);
  const ratio = used / budgetTokens;
  return {
    usedTokens: used,
    budgetTokens,
    ratio,
    remainingTokens: Math.max(0, budgetTokens - used),
    status: ratio >= 1 ? "over" : ratio >= 0.8 ? "near" : "ok",
  };
}

export function budgetForThread(
  budgets: ReadonlyArray<CodeitlabThreadBudget>,
  threadId: string | null | undefined,
): CodeitlabThreadBudget | null {
  if (threadId === null || threadId === undefined || threadId === "") return null;
  return budgets.find((budget) => budget.threadId.trim() === threadId) ?? null;
}
