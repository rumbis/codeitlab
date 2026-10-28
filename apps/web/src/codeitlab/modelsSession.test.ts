import type { RoutingCatalog, RoutingDecision } from "@codeitlab/core/routing";
import { describe, expect, it } from "vite-plus/test";
import {
  NO_DECISION_REASON,
  buildSessionUnderstanding,
  sessionContextLabel,
  threadSessionContextUsage,
} from "./modelsSession";

const catalog: RoutingCatalog = {
  mode: "auto",
  providers: [
    {
      providerInstanceId: "claude",
      providerKind: "claude",
      name: "Claude Code",
      models: ["claude-sonnet-4.5", "claude-opus-4.1"],
      defaultModel: "claude-sonnet-4.5",
      modelCount: 3,
      available: true,
      quota: 0.4,
      speed: 0.7,
      smartness: 0.92,
    },
    {
      providerInstanceId: "codex",
      providerKind: "codex",
      name: "Codex",
      models: ["gpt-5-codex"],
      available: false,
      quota: 0,
      speed: 0.5,
      smartness: 0.6,
    },
  ],
  omniRouteModels: ["omniroute/auto-coding"],
};

const decision: RoutingDecision = {
  id: "decision-1",
  decidedAt: "2026-10-25T00:00:00.000Z",
  taskClass: "coding",
  providerInstanceId: "claude",
  providerKind: "claude",
  model: "claude-sonnet-4.5",
  reason: "coding task: claude-sonnet-4.5 has the best smartness for the class.",
  candidates: [
    {
      providerInstanceId: "claude",
      providerKind: "claude",
      model: "claude-sonnet-4.5",
      quota: 0.4,
      smartness: 0.92,
      speed: 0.7,
      score: 0.78,
      available: true,
    },
  ],
};

function build(overrides: Partial<Parameters<typeof buildSessionUnderstanding>[0]> = {}) {
  return buildSessionUnderstanding({
    catalog,
    decision,
    context: { usedTokens: 12_000, maxTokens: 200_000 },
    selected: { providerInstanceId: "claude", model: "claude-sonnet-4.5" },
    hiddenModelsByInstance: {},
    ...overrides,
  });
}

describe("buildSessionUnderstanding", () => {
  it("counts what providers advertise, not just what it lists", () => {
    const session = build();
    // Claude advertises 3 while listing 2, Codex 1, plus one OmniRoute model.
    expect(session.advertised).toBe(5);
    expect(session.rows).toHaveLength(4);
  });

  it("counts only pickable rows as shown", () => {
    const session = build();
    // Codex is disabled, so its single row is listed but not shown.
    expect(session.shown).toBe(3);
  });

  it("explains a disabled provider instead of hiding the row", () => {
    const row = build().rows.find((entry) => entry.providerInstanceId === "codex");
    expect(row).toBeDefined();
    expect(row?.selectable).toBe(false);
    expect(row?.disabledReason).toBe("Provider is disabled right now, so no turn can use it.");
  });

  it("marks a hidden model unselectable and says why", () => {
    const session = build({ hiddenModelsByInstance: { claude: ["claude-opus-4.1"] } });
    const row = session.rows.find((entry) => entry.model === "claude-opus-4.1");
    expect(row?.hidden).toBe(true);
    expect(row?.selectable).toBe(false);
    expect(row?.disabledReason).toBe("Hidden in the picker for this provider.");
  });

  it("says nothing was decided instead of inventing a verdict", () => {
    const session = build({ decision: null });
    expect(session.chip).toBeNull();
    expect(session.taskClass).toBeNull();
    expect(session.taskReason).toBe(NO_DECISION_REASON);
    expect(session.heuristic).toBe(true);
    expect(session.rows.every((row) => row.routerWhy === NO_DECISION_REASON)).toBe(true);
    expect(session.rows.some((row) => row.routerWouldPick)).toBe(false);
  });

  it("explains the winner with the router's own numbers", () => {
    const session = build();
    const winner = session.rows.find((row) => row.routerWouldPick);
    expect(winner?.model).toBe("claude-sonnet-4.5");
    expect(winner?.score).toBe(0.78);
    expect(winner?.routerWhy).toContain("smartness 0.92");
    expect(winner?.routerWhy).toContain("quota 40%");
    expect(winner?.routerWhy).toContain("speed 0.70");
    expect(winner?.routerWhy).toContain("score 0.78");
    expect(winner?.routerWhy).toContain("coding");
  });

  it("says a non-candidate was not scored", () => {
    const row = build().rows.find((entry) => entry.model === "claude-opus-4.1");
    expect(row?.score).toBeNull();
    expect(row?.routerWhy).toBe(
      "Not a candidate for this task class; the router did not score it.",
    );
  });

  it("credits a provider's own router when the kind delegates", () => {
    const row = build({ delegatedProviderKinds: ["claude"] }).rows.find(
      (entry) => entry.model === "claude-sonnet-4.5",
    );
    expect(row?.routerWhy).toContain("Chosen by the provider's own router");
  });

  it("credits delegation recorded on the decision itself", () => {
    const row = build({ decision: { ...decision, delegated: true } }).rows.find(
      (entry) => entry.model === "claude-sonnet-4.5",
    );
    expect(row?.routerWhy).toContain("Chosen by the provider's own router");
  });

  it("carries context usage only on the selected row", () => {
    const session = build();
    const selected = session.rows.find((row) => row.selected);
    expect(selected?.contextUsedTokens).toBe(12_000);
    expect(selected?.contextMaxTokens).toBe(200_000);
    expect(sessionContextLabel(selected!)).toBe("12,000 / 200,000 tokens");
    const other = session.rows.find((row) => !row.selected);
    expect(other?.contextUsedTokens).toBeNull();
    expect(sessionContextLabel(other!)).toBe("not used yet");
  });

  it("lists custom endpoints as unscored and counts them as advertised", () => {
    const session = build({
      endpoints: [{ id: "endpoint-1", label: "My vLLM", models: ["qwen3-coder"] }],
    });
    const row = session.rows.find((entry) => entry.providerKind === "openai-compatible");
    expect(row?.routerWhy).toBe(
      "Custom endpoint: the router does not score it, so nothing is explained here.",
    );
    expect(session.advertised).toBe(6);
  });

  it("labels the chip as a heuristic and repeats the router's reason", () => {
    const chip = build().chip;
    expect(chip?.label).toBe("coding · heuristic");
    expect(chip?.reason).toBe(decision.reason);
  });

  it("leaves the chip out when only the class is known", () => {
    const chip = build({ decision: { ...decision, reason: "" } }).chip;
    expect(chip?.reason).toBe(NO_DECISION_REASON);
  });
});

describe("threadSessionContextUsage", () => {
  const projection = (patch: {
    providerTurns?: ReadonlyArray<{ tokenUsage?: unknown }>;
    providerThreads?: ReadonlyArray<{ id: string; contextUsage?: unknown }>;
  }) =>
    ({
      thread: { id: "thread-1", activeProviderThreadId: "pt-1" },
      contextTransfers: [],
      providerTurns: patch.providerTurns ?? [],
      providerThreads: patch.providerThreads ?? [],
    }) as never;

  it("has nothing to say before a thread exists", () => {
    expect(threadSessionContextUsage(null)).toBeNull();
    expect(threadSessionContextUsage(undefined)).toBeNull();
  });

  it("uses the newest provider turn's usage", () => {
    const usage = threadSessionContextUsage(
      projection({
        providerTurns: [
          {
            tokenUsage: {
              usedTokens: 12_000,
              maxTokens: 200_000,
              updatedAt: "2026-10-25T10:00:00.000Z",
            },
          },
          {
            tokenUsage: {
              usedTokens: 18_000,
              maxTokens: 200_000,
              updatedAt: "2026-10-25T11:00:00.000Z",
            },
          },
        ],
      }),
    );
    expect(usage).toEqual({ usedTokens: 18_000, maxTokens: 200_000 });
  });

  it("falls back to the provider thread's recorded snapshot", () => {
    const usage = threadSessionContextUsage(
      projection({
        providerThreads: [{ id: "pt-1", contextUsage: { usedTokens: 5_000 } }],
      }),
    );
    // A provider that reports used tokens but no window leaves the limit unknown
    // rather than inventing one.
    expect(usage).toEqual({ usedTokens: 5_000, maxTokens: null });
  });

  it("says nothing for a thread that never reported usage", () => {
    expect(threadSessionContextUsage(projection({}))).toBeNull();
  });
});
