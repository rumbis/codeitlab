import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/**
 * Team presets are the saved half of agent teams: who the architect runs on and
 * which workers it may delegate to. A preset is data only — starting a team
 * opens a normal thread and hands the architect a brief, so there is no second
 * orchestration path and no team-specific execution engine.
 */

const TrimmedDefault = (value: string) =>
  Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(value)));

/** The product caps a team at architect + three workers. */
export const MAX_TEAM_WORKERS = 3;

export const CodeitlabTeamWorker = Schema.Struct({
  id: TrimmedDefault("worker-1"),
  /** Label the architect sees, e.g. "API surface". */
  name: TrimmedDefault("Worker"),
  /** What this worker owns, e.g. "implementation", "tests", "review". */
  role: TrimmedDefault("implementation"),
  /** Provider instance id; empty inherits the architect's instance. */
  instanceId: TrimmedDefault(""),
  /** Model slug; empty inherits the instance's default model. */
  model: TrimmedDefault(""),
});
export type CodeitlabTeamWorker = typeof CodeitlabTeamWorker.Type;

export const CodeitlabTeamPreset = Schema.Struct({
  id: TrimmedDefault("team-1"),
  name: TrimmedDefault("My team"),
  architectInstanceId: TrimmedDefault(""),
  architectModel: TrimmedDefault(""),
  workers: Schema.Array(CodeitlabTeamWorker).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
export type CodeitlabTeamPreset = typeof CodeitlabTeamPreset.Type;

/** Runs kept for the team panel; older ones fall off so settings stay small. */
export const MAX_TEAM_RUNS = 10;

export const CodeitlabTeamRun = Schema.Struct({
  id: TrimmedDefault("run-1"),
  presetId: TrimmedDefault(""),
  presetName: TrimmedDefault(""),
  /** Thread the architect runs in; empty means it was never opened. */
  threadId: TrimmedDefault(""),
  environmentId: TrimmedDefault(""),
  task: TrimmedDefault(""),
  startedAt: TrimmedDefault(""),
});
export type CodeitlabTeamRun = typeof CodeitlabTeamRun.Type;

export const CodeitlabTeamSettings = Schema.Struct({
  presets: Schema.Array(CodeitlabTeamPreset).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  runs: Schema.Array(CodeitlabTeamRun).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
export type CodeitlabTeamSettings = typeof CodeitlabTeamSettings.Type;

/** Newest first, capped so a long-lived install cannot grow settings without bound. */
export function appendTeamRun(
  runs: ReadonlyArray<CodeitlabTeamRun>,
  run: CodeitlabTeamRun,
  limit: number = MAX_TEAM_RUNS,
): ReadonlyArray<CodeitlabTeamRun> {
  return [run, ...runs.filter((entry) => entry.id !== run.id)].slice(0, Math.max(0, limit));
}
