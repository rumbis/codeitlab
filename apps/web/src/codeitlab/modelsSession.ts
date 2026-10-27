import type { RoutingCatalog, RoutingDecision, TaskClass } from "@codeitlab/core/routing";
import type { OrchestrationV2ThreadProjection } from "@codeitlab/contracts";

import { latestProviderTurnTokenUsage } from "../lib/contextWindow";

/**
 * What the active session understood, joined onto the same model list the picker
 * reads. The page and the picker both call this, so they cannot drift.
 *
 * Everything here is derived, never invented: the task class and the reason come
 * from the router's own decision, the score breakdown from that decision's
 * candidates, and the context usage from the thread the run belongs to. When
 * there is no decision yet the row says so instead of guessing a verdict.
 */

export interface SessionContextUsage {
  readonly usedTokens: number | null;
  readonly maxTokens: number | null;
}

export interface SessionEndpointSource {
  readonly id: string;
  readonly label: string;
  readonly models: ReadonlyArray<string>;
}

export interface SessionUnderstandingInput {
  readonly catalog: RoutingCatalog;
  /** The newest routing decision for this environment, or null before the first turn. */
  readonly decision: RoutingDecision | null;
  /** Usage of the thread the session belongs to; null when nothing ran yet. */
  readonly context: SessionContextUsage | null;
  /** The selection the next turn would use, so the row can show "selected". */
  readonly selected: { readonly providerInstanceId: string; readonly model: string } | null;
  readonly hiddenModelsByInstance: Readonly<Record<string, ReadonlyArray<string>>>;
  readonly endpoints?: ReadonlyArray<SessionEndpointSource>;
  /**
   * Provider kinds that route with their own router (ACP agents). Their rows say
   * the choice belongs to the provider; this app only reports it.
   */
  readonly delegatedProviderKinds?: ReadonlyArray<string>;
}

export interface ModelSessionRow {
  readonly key: string;
  readonly providerInstanceId: string;
  readonly providerKind: string;
  readonly providerLabel: string;
  readonly model: string;
  /** False when the provider is disabled, the model is hidden, or it is a legacy alias. */
  readonly selectable: boolean;
  readonly hidden: boolean;
  /** Why the row cannot be picked; null when it can. */
  readonly disabledReason: string | null;
  readonly quota: number;
  readonly smartness: number;
  readonly speed: number;
  /** Weighted score from the router's own decision; null when this model was not a candidate. */
  readonly score: number | null;
  readonly routerWouldPick: boolean;
  readonly routerWhy: string;
  readonly selected: boolean;
  readonly contextUsedTokens: number | null;
  readonly contextMaxTokens: number | null;
}

export interface SessionUnderstanding {
  /** "showing N of M advertised" — M counts what providers claim, not what we list. */
  readonly shown: number;
  readonly advertised: number;
  readonly taskClass: TaskClass | null;
  readonly taskReason: string;
  /** Always true: this is the app's reading of one prompt, not the router's record. */
  readonly heuristic: true;
  readonly chip: SessionChip | null;
  readonly rows: ReadonlyArray<ModelSessionRow>;
}

export interface SessionChip {
  readonly taskClass: TaskClass;
  readonly label: string;
  readonly reason: string;
}

export const NO_DECISION_REASON =
  "No routing decision yet, so this page has nothing to explain; send one prompt and it will.";
export const HEURISTIC_NOTE =
  "Read from the last prompt by this app's heuristic, not the router's log.";

function percent(value: number): string {
  return Math.round(Math.max(0, Math.min(1, value)) * 100) + "%";
}

function speedText(value: number): string {
  // The catalog stores speed as a 0..1 relative score, not milliseconds; saying
  // "ms" would be a made-up number.
  return "speed " + value.toFixed(2);
}

function scoreText(value: number): string {
  return "score " + value.toFixed(2);
}

function candidateFor(
  decision: RoutingDecision | null,
  providerInstanceId: string,
  model: string,
): RoutingDecision["candidates"][number] | null {
  if (decision === null) return null;
  return (
    decision.candidates.find(
      (candidate) =>
        candidate.providerInstanceId === providerInstanceId && candidate.model === model,
    ) ?? null
  );
}

function verdictText(
  decision: RoutingDecision | null,
  candidate: RoutingDecision["candidates"][number] | null,
  delegated: boolean,
): string {
  if (decision === null) return NO_DECISION_REASON;
  if (candidate === null) {
    return "Not a candidate for this task class; the router did not score it.";
  }
  const breakdown =
    "smartness " +
    candidate.smartness.toFixed(2) +
    ", quota " +
    percent(candidate.quota) +
    ", " +
    speedText(candidate.speed) +
    " → " +
    scoreText(candidate.score);
  if (delegated) {
    return (
      "Chosen by the provider's own router for a " +
      decision.taskClass +
      " task (" +
      breakdown +
      ")."
    );
  }
  return "Would score " + breakdown + " for a " + decision.taskClass + " task.";
}

export function buildSessionUnderstanding(input: SessionUnderstandingInput): SessionUnderstanding {
  const decision = input.decision;
  const delegatedKinds = new Set(input.delegatedProviderKinds ?? []);
  const endpoints = input.endpoints ?? [];
  const rows: ModelSessionRow[] = [];
  let advertised = 0;

  for (const provider of input.catalog.providers) {
    const hidden = new Set(input.hiddenModelsByInstance[provider.providerInstanceId] ?? []);
    // modelCount is what the provider advertises; models is what we can show.
    advertised += Math.max(provider.modelCount ?? provider.models.length, provider.models.length);
    // The decision itself records delegation (OmniRoute, or a kind the user
    // declared); the settings list covers decisions made before the flag existed.
    const delegated = decision?.delegated === true || delegatedKinds.has(provider.providerKind);
    for (const model of provider.models) {
      const isHidden = hidden.has(model);
      const candidate = candidateFor(decision, provider.providerInstanceId, model);
      const selected =
        input.selected !== null &&
        input.selected.providerInstanceId === provider.providerInstanceId &&
        input.selected.model === model;
      const disabledReason = !provider.available
        ? "Provider is disabled right now, so no turn can use it."
        : isHidden
          ? "Hidden in the picker for this provider."
          : null;
      rows.push({
        key: provider.providerInstanceId + "::" + model,
        providerInstanceId: provider.providerInstanceId,
        providerKind: provider.providerKind,
        providerLabel: provider.name,
        model,
        selectable: disabledReason === null,
        hidden: isHidden,
        disabledReason,
        quota: provider.quota,
        smartness: provider.smartness,
        speed: provider.speed,
        score: candidate?.score ?? null,
        routerWouldPick:
          decision !== null &&
          decision.providerInstanceId === provider.providerInstanceId &&
          decision.model === model,
        routerWhy: verdictText(decision, candidate, delegated),
        selected,
        contextUsedTokens: selected ? (input.context?.usedTokens ?? null) : null,
        contextMaxTokens: selected ? (input.context?.maxTokens ?? null) : null,
      });
    }
  }

  for (const model of input.catalog.omniRouteModels) {
    advertised += 1;
    const candidate = candidateFor(decision, "omniroute", model);
    rows.push({
      key: "omniroute::" + model,
      providerInstanceId: "omniroute",
      providerKind: "omniroute",
      providerLabel: "OmniRoute",
      model,
      selectable: true,
      hidden: false,
      disabledReason: null,
      quota: 1,
      smartness: 0,
      speed: 0,
      score: candidate?.score ?? null,
      routerWouldPick:
        decision !== null &&
        decision.providerInstanceId === "omniroute" &&
        decision.model === model,
      // OmniRoute always delegates: the gateway picks the real model.
      routerWhy: verdictText(decision, candidate, true),
      selected:
        input.selected !== null &&
        input.selected.providerInstanceId === "omniroute" &&
        input.selected.model === model,
      contextUsedTokens: null,
      contextMaxTokens: null,
    });
  }

  for (const endpoint of endpoints) {
    advertised += endpoint.models.length;
    for (const model of endpoint.models) {
      rows.push({
        key: "endpoint:" + endpoint.id + "::" + model,
        providerInstanceId: endpoint.id,
        providerKind: "openai-compatible",
        providerLabel: endpoint.label,
        model,
        selectable: true,
        hidden: false,
        disabledReason: null,
        quota: 1,
        smartness: 0,
        speed: 0,
        score: null,
        routerWouldPick: false,
        routerWhy: "Custom endpoint: the router does not score it, so nothing is explained here.",
        selected:
          input.selected !== null &&
          input.selected.providerInstanceId === endpoint.id &&
          input.selected.model === model,
        contextUsedTokens: null,
        contextMaxTokens: null,
      });
    }
  }

  const shown = rows.filter((row) => row.selectable).length;
  const taskClass = decision?.taskClass ?? null;
  // An empty reason is no reason: the router always writes one, so a blank
  // string means the record is incomplete and must not render as an explanation.
  const reason = decision?.reason.trim() ? decision.reason : NO_DECISION_REASON;
  const chip: SessionChip | null =
    taskClass === null ? null : { taskClass, label: taskClass + " · heuristic", reason };

  return {
    shown,
    advertised,
    taskClass,
    taskReason: reason,
    heuristic: true,
    chip,
    rows,
  };
}

/**
 * The thread's own context usage, read from the projection the composer already
 * has. The Models page is not inside a thread, so it passes null; the composer
 * passes this, and both feed the same chip.
 *
 * The live provider-turn usage wins; a provider thread that only recorded a
 * snapshot still answers instead of showing "not used yet" for a thread that ran.
 */
export function threadSessionContextUsage(
  projection:
    | Pick<
        OrchestrationV2ThreadProjection,
        "thread" | "providerTurns" | "providerThreads" | "contextTransfers"
      >
    | null
    | undefined,
): SessionContextUsage | null {
  if (projection == null) return null;
  const activeProviderThread =
    projection.providerThreads.find(
      (thread) => thread.id === projection.thread.activeProviderThreadId,
    ) ?? null;
  const usage =
    latestProviderTurnTokenUsage(projection.providerTurns, projection, activeProviderThread) ??
    activeProviderThread?.contextUsage ??
    null;
  if (usage === null) return null;
  return { usedTokens: usage.usedTokens, maxTokens: usage.maxTokens ?? null };
}

export function sessionContextLabel(row: ModelSessionRow): string {
  if (row.contextUsedTokens === null && row.contextMaxTokens === null) return "not used yet";
  const used = row.contextUsedTokens === null ? "?" : row.contextUsedTokens.toLocaleString();
  const max = row.contextMaxTokens === null ? "?" : row.contextMaxTokens.toLocaleString();
  return used + " / " + max + " tokens";
}
