import {
  MAX_TEAM_WORKERS,
  type CodeitlabTeamPreset,
  type CodeitlabTeamRun,
  type CodeitlabTeamWorker,
} from "@codeitlab/core/team";
import type { RuntimeSubagent } from "@t3tools/client-runtime/state/subagentRuntime";

export { MAX_TEAM_WORKERS };

const ROLES = ["implementation", "tests", "review"] as const;

export function createTeamWorker(index: number): CodeitlabTeamWorker {
  const role = ROLES[(index - 1) % ROLES.length] ?? "implementation";
  return {
    id: `worker-${index}`,
    name: `Worker ${index}`,
    role,
    instanceId: "",
    model: "",
  };
}

export function createTeamPreset(now = Date.now()): CodeitlabTeamPreset {
  return {
    id: `team-${now}`,
    name: "My team",
    architectInstanceId: "",
    architectModel: "",
    workers: [createTeamWorker(1), createTeamWorker(2)],
  };
}

/** Returns the first thing the user has to fix before starting, or null. */
export function teamPresetIssue(preset: CodeitlabTeamPreset): string | null {
  if (preset.name.trim() === "") return "Give the team a name.";
  if (preset.workers.length === 0) return "Add at least one worker.";
  if (preset.workers.length > MAX_TEAM_WORKERS) {
    return `A team is at most ${MAX_TEAM_WORKERS} workers.`;
  }
  if (preset.workers.some((worker) => worker.name.trim() === "")) {
    return "Every worker needs a name.";
  }
  if (preset.workers.some((worker) => worker.role.trim() === "")) {
    return "Every worker needs a role.";
  }
  return null;
}

function describeModel(instanceId: string, model: string, inherited: string): string {
  const provider = instanceId.trim() === "" ? inherited : instanceId;
  return model.trim() === "" ? `${provider} (default model)` : `${provider} · ${model}`;
}

/**
 * The architect's brief. It is deliberately plain instructions to an ordinary
 * CodeItLab thread: delegation uses `delegate_task`, the summary is the same
 * turn's answer, and nothing here depends on a team-specific runtime.
 */
export function buildTeamBrief(preset: CodeitlabTeamPreset, task: string): string {
  const architect = describeModel(
    preset.architectInstanceId,
    preset.architectModel,
    "the thread's model",
  );
  const workers = preset.workers
    .map((worker, index) => {
      const target = describeModel(worker.instanceId, worker.model, "the architect's provider");
      return `${index + 1}. ${worker.name.trim()} — role: ${worker.role.trim()} — model: ${target}`;
    })
    .join("\n");
  return [
    "# Team brief",
    "",
    "You are the architect of a small team. Plan first, then delegate the parts that can run in",
    "parallel, then synthesize one answer for the user.",
    "",
    "## Task",
    task.trim(),
    "",
    "## Team",
    `Architect: ${architect}`,
    workers,
    "",
    "## Rules",
    "1. Split the task into one delegation per worker; do the integration work yourself.",
    "2. Delegate with `delegate_task`, passing a self-contained task prompt (the worker does not",
    "   inherit this conversation). Set target.providerInstanceId and target.model to the values",
    "   above; leave them out to inherit.",
    "3. Run independent workers in parallel and wait for all of them before concluding.",
    "4. Do not create extra workers and do not start separate threads.",
    "5. Answer with one row per worker (owned, changed, status) and then a synthesis: decisions,",
    "   conflicts, the deduplicated list of changed files, and anything left open.",
  ].join("\n");
}

export function createTeamRun(input: {
  preset: CodeitlabTeamPreset;
  threadId: string;
  environmentId: string;
  task: string;
  now: Date;
}): CodeitlabTeamRun {
  const stamp = input.now.toISOString();
  return {
    id: `run-${input.now.getTime().toString(36)}`,
    presetId: input.preset.id,
    presetName: input.preset.name,
    threadId: input.threadId,
    environmentId: input.environmentId,
    task: input.task.trim(),
    startedAt: stamp,
  };
}

export type TeamWorkerState = "working" | "idle" | "done" | "failed" | "stopped";

export interface TeamRunSummary {
  readonly total: number;
  readonly working: number;
  readonly idle: number;
  readonly done: number;
  readonly failed: number;
  readonly stopped: number;
  readonly results: ReadonlyArray<{
    id: string;
    title: string;
    state: TeamWorkerState;
    text: string;
  }>;
}

export function teamWorkerState(status: RuntimeSubagent["status"]): TeamWorkerState {
  switch (status) {
    case "completed":
      return "done";
    case "failed":
      return "failed";
    case "cancelled":
    case "interrupted":
      return "stopped";
    case "idle":
      return "idle";
    default:
      return "working";
  }
}

/**
 * The synthesis panel only claims what the roster shows: it counts every worker
 * it can see and collects their results. A missing roster is reported as such by
 * the card, never as success.
 */
export function summarizeTeamRun(subagents: ReadonlyArray<RuntimeSubagent>): TeamRunSummary {
  const results = subagents.map((agent) => {
    const state = teamWorkerState(agent.status);
    const text = agent.error?.trim() || agent.result?.trim() || agent.progress?.trim() || "";
    return { id: agent.id, title: agent.title, state, text };
  });
  return {
    total: results.length,
    working: results.filter((entry) => entry.state === "working").length,
    idle: results.filter((entry) => entry.state === "idle").length,
    done: results.filter((entry) => entry.state === "done").length,
    failed: results.filter((entry) => entry.state === "failed").length,
    stopped: results.filter((entry) => entry.state === "stopped").length,
    results,
  };
}

export interface TeamChangedFile {
  readonly path: string;
  readonly kind: string;
  readonly additions: number;
  readonly deletions: number;
}

/**
 * Deduplicated files across the run's checkpoints. The latest checkpoint wins for
 * a path, so a file edited three times is one row with its final numbers. This
 * reads the thread's own checkpoints; a worker running in a separate worktree may
 * not appear here, and the card says so rather than implying full coverage.
 */
export function aggregateTeamChangedFiles(
  checkpoints: ReadonlyArray<{ readonly files: ReadonlyArray<TeamChangedFile> }>,
): ReadonlyArray<TeamChangedFile> {
  const byPath = new Map<string, TeamChangedFile>();
  for (const checkpoint of checkpoints) {
    for (const file of checkpoint.files) {
      if (file.path.trim() === "") continue;
      byPath.set(file.path, file);
    }
  }
  return [...byPath.values()].toSorted((left, right) => left.path.localeCompare(right.path));
}
