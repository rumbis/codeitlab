import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  CodeItLabBudgetSettings,
  budgetForThread,
  budgetProgress,
  type CodeItLabThreadBudget,
} from "./budget.ts";

const decode = Schema.decodeSync(CodeItLabBudgetSettings);

const budget = (patch: Partial<CodeItLabThreadBudget>): CodeItLabThreadBudget => ({
  threadId: "thread-1",
  tokens: 100_000,
  note: "",
  ...patch,
});

describe("goal budgets", () => {
  it("decodes an empty block", () => {
    expect(decode({}).budgets).toEqual([]);
  });

  it("reports ok, near and over without going negative", () => {
    expect(budgetProgress(10_000, 100_000)?.status).toBe("ok");
    expect(budgetProgress(80_000, 100_000)?.status).toBe("near");
    expect(budgetProgress(100_000, 100_000)?.status).toBe("over");
    expect(budgetProgress(150_000, 100_000)?.remainingTokens).toBe(0);
    expect(budgetProgress(150_000, 100_000)?.ratio).toBe(1.5);
  });

  it("has no progress without a usable budget", () => {
    expect(budgetProgress(5_000, 0)).toBeNull();
    expect(budgetProgress(5_000, -10)).toBeNull();
    expect(budgetProgress(Number.NaN, 100)).toBeNull();
  });

  it("finds a budget only for a real thread id", () => {
    const budgets = [budget({})];
    expect(budgetForThread(budgets, "thread-1")?.tokens).toBe(100_000);
    expect(budgetForThread(budgets, "thread-2")).toBeNull();
    expect(budgetForThread(budgets, "")).toBeNull();
    expect(budgetForThread(budgets, null)).toBeNull();
  });
});
