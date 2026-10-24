import { budgetForThread } from "@codeitlab/core/budget";
import { formatContextTokens } from "@codeitlab/core/context";

import { useCodeitlabSettingsWriter } from "../../codeitlab/effectsSettings";
import { useThreadShells } from "../../state/entities";
import { Input } from "../ui/input";
import { CodeitlabCard, CodeitlabEmptyBlock, CodeitlabSectionHeading } from "./CodeitlabPrimitives";

/**
 * Goal budgets are honest warnings. The server owns run lifecycle, so nothing here
 * cancels a run: the meter shows how much of the budget is used and says plainly
 * that crossing it stops nothing automatically.
 */
export function CodeitlabBudgetPage() {
  const { codeitlab, update } = useCodeitlabSettingsWriter();
  const budgets = codeitlab.budget.budgets;
  const threads = useThreadShells()
    .filter((thread) => thread.archivedAt === null)
    .toSorted((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .slice(0, 25);

  const record = (threadId: string, raw: string) => {
    const tokens = Number.parseInt(raw.replace(/[^0-9]/g, ""), 10);
    const next = budgets.filter((budget) => budget.threadId !== threadId);
    if (Number.isFinite(tokens) && tokens > 0) next.push({ threadId, tokens, note: "" });
    update({ budget: { ...codeitlab.budget, budgets: next } });
  };

  return (
    <div className="flex flex-col gap-6">
      <CodeitlabSectionHeading
        description="A budget is what you are willing to spend on a thread, shown next to the context meter. It is a warning, not a stop: crossing it never cancels a run, because the server owns run lifecycle."
        eyebrow="CodeItLab // budget"
        title="Goal budgets"
      />

      {threads.length === 0 ? (
        <CodeitlabEmptyBlock
          description="Start a thread and it appears here so you can give it a token budget."
          title="No threads yet"
        />
      ) : (
        <CodeitlabCard className="overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Thread</th>
                <th className="px-3 py-2 font-medium">Updated</th>
                <th className="px-3 py-2 font-medium">Budget</th>
                <th className="px-3 py-2 font-medium">Tokens</th>
              </tr>
            </thead>
            <tbody>
              {threads.map((thread) => {
                const budget = budgetForThread(budgets, thread.id);
                return (
                  <tr className="border-b border-border/40 last:border-0" key={thread.id}>
                    <td className="max-w-72 truncate px-3 py-2">{thread.title}</td>
                    <td className="px-3 py-2 text-2xs tabular-nums text-muted-foreground">
                      {new Date(thread.updatedAt).toLocaleDateString()}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">
                      {budget === null ? "none" : formatContextTokens(budget.tokens)}
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        aria-label={`Token budget for ${thread.title}`}
                        className="max-w-32"
                        defaultValue={budget?.tokens ?? ""}
                        inputMode="numeric"
                        onBlur={(event) => record(thread.id, event.currentTarget.value)}
                        placeholder="No budget"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CodeitlabCard>
      )}

      <p className="text-2xs text-muted-foreground">
        Clearing a field removes the budget. The meter warns at 80% and at 100%; it never interrupts
        a running turn.
      </p>
    </div>
  );
}
