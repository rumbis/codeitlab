import type { CodeItLabTeamRun } from "@codeitlab/core/team";
import { scopeThreadRef } from "@codeitlab/client-runtime/environment";
import { projectedSubagentsToRuntime } from "@codeitlab/client-runtime/state/subagentRuntime";
import type { EnvironmentId, ThreadId } from "@codeitlab/contracts";
import { useNavigate } from "@tanstack/react-router";
import { MessageSquareIcon } from "lucide-react";

import {
  aggregateTeamChangedFiles,
  summarizeTeamRun,
  type TeamWorkerState,
} from "../../codeitlab/team";
import {
  useThreadCheckpointSummaries,
  useThreadProjection,
  useThreadShells,
} from "../../state/entities";
import { Button } from "../ui/button";
import { CodeItLabCard } from "./CodeItLabPrimitives";

const STATE_LABELS: Readonly<Record<TeamWorkerState, string>> = {
  working: "working",
  idle: "idle",
  done: "done",
  failed: "failed",
  stopped: "stopped",
};

const STATE_CLASSES: Readonly<Record<TeamWorkerState, string>> = {
  working: "text-codeitlab-green",
  idle: "text-muted-foreground",
  done: "text-foreground",
  failed: "text-destructive",
  stopped: "text-muted-foreground",
};

/**
 * One started team: its worker rows come from the thread's subagent projection,
 * so a worker appears exactly when the architect delegates, and the synthesis
 * only claims what the roster actually reports.
 */
export function CodeItLabTeamRunCard({ run }: { readonly run: CodeItLabTeamRun }) {
  const navigate = useNavigate();
  const threadIds = new Set(useThreadShells().map((thread) => thread.id));
  const threadGone = threadIds.size > 0 && !threadIds.has(run.threadId as ThreadId);
  const ref =
    run.environmentId === "" || run.threadId === ""
      ? null
      : scopeThreadRef(run.environmentId as EnvironmentId, run.threadId as ThreadId);
  const thread = useThreadProjection(ref);
  const projection = thread?.projection ?? null;
  const subagents = projectedSubagentsToRuntime(projection?.subagents ?? []);
  const summary = summarizeTeamRun(subagents);
  const changedFiles = aggregateTeamChangedFiles(useThreadCheckpointSummaries(ref));
  const settled = summary.total > 0 && summary.working === 0 && summary.idle === 0;

  return (
    <CodeItLabCard className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <p className="truncate text-sm font-medium">{run.task || "Untitled team run"}</p>
          <p className="text-2xs text-muted-foreground">
            {run.presetName || "Team"} · started {run.startedAt.slice(0, 16).replace("T", " ")}
            {run.threadId === ""
              ? ""
              : threadGone
                ? ` · thread ${run.threadId.slice(0, 8)} no longer exists`
                : ` · thread ${run.threadId.slice(0, 8)}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <p className="text-2xs tabular-nums text-muted-foreground">
            {summary.total === 0
              ? "no workers yet"
              : `${summary.done + summary.failed + summary.stopped}/${summary.total} finished`}
          </p>
          {ref === null || threadGone ? null : (
            <Button
              aria-label={`Open thread for ${run.task || "this team run"}`}
              onClick={() =>
                void navigate({
                  to: "/$environmentId/$threadId",
                  params: { environmentId: run.environmentId, threadId: run.threadId },
                })
              }
              size="xs"
              type="button"
              variant="outline"
            >
              <MessageSquareIcon aria-hidden className="size-3.5" />
              Open thread
            </Button>
          )}
        </div>
      </div>

      {ref === null ? (
        <p className="text-xs text-muted-foreground">
          This run never opened a thread, so there is nothing to show.
        </p>
      ) : summary.total === 0 ? (
        <p className="text-xs text-muted-foreground">
          No worker rows yet. Either the architect has not delegated or this run's thread is still
          loading; rows appear as `delegate_task` starts them.
        </p>
      ) : (
        <ul className="flex flex-col gap-1" aria-label="Team workers">
          {summary.results.map((worker) => (
            <li
              className="flex flex-wrap items-baseline justify-between gap-2 rounded-md border border-border/50 px-2 py-1.5"
              key={worker.id}
            >
              <span className="min-w-0 truncate text-xs">{worker.title}</span>
              <span className={`text-2xs tabular-nums ${STATE_CLASSES[worker.state]}`}>
                {STATE_LABELS[worker.state]}
              </span>
            </li>
          ))}
        </ul>
      )}

      {changedFiles.length === 0 ? null : (
        <div className="flex flex-col gap-1" aria-label="Changed files">
          <p className="text-2xs font-medium tabular-nums text-muted-foreground">
            Changed files ({changedFiles.length})
          </p>
          <ul className="flex flex-col gap-0.5">
            {changedFiles.slice(0, 12).map((file) => (
              <li
                className="flex items-baseline justify-between gap-2 text-2xs tabular-nums"
                key={file.path}
              >
                <span className="min-w-0 truncate font-mono">{file.path}</span>
                <span className="text-muted-foreground">
                  +{file.additions} −{file.deletions}
                </span>
              </li>
            ))}
          </ul>
          {changedFiles.length > 12 ? (
            <p className="text-2xs tabular-nums text-muted-foreground">
              +{changedFiles.length - 12} more in the thread diff.
            </p>
          ) : null}
          <p className="text-2xs text-muted-foreground">
            From this thread's checkpoints; worker edits in separate worktrees may not appear.
          </p>
        </div>
      )}

      {settled ? (
        <div
          className="flex flex-col gap-1 rounded-md bg-accent/40 px-3 py-2"
          aria-label="Synthesis"
        >
          <p className="text-2xs font-medium text-muted-foreground">Synthesis</p>
          <p className="text-xs tabular-nums">
            {summary.done} done · {summary.failed} failed · {summary.stopped} stopped
          </p>
          {summary.results
            .filter((worker) => worker.text !== "")
            .map((worker) => (
              <p className="text-2xs text-muted-foreground" key={`result-${worker.id}`}>
                <span className="text-foreground">{worker.title}:</span> {worker.text.slice(0, 240)}
                {worker.text.length > 240 ? "…" : ""}
              </p>
            ))}
          {summary.results.every((worker) => worker.text === "") ? (
            <p className="text-2xs text-muted-foreground">
              The workers finished without a written result; open the thread for the full
              transcript.
            </p>
          ) : null}
        </div>
      ) : null}
    </CodeItLabCard>
  );
}
