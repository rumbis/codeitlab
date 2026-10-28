import type { CodeItLabDeployTarget } from "@codeitlab/core/deploy";
import { buildDeployBrief, deployTargetIssue } from "@codeitlab/core/deploy";
import { scopeProjectRef } from "@codeitlab/client-runtime/environment";
import { PlayIcon, PlusIcon, RocketIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { useComposerDraftStore } from "~/composerDraftStore";
import { useCodeItLabSettingsWriter } from "../../codeitlab/effectsSettings";
import { DEPLOY_STARTERS, createDeployTarget, starterDeployTarget } from "../../codeitlab/deploy";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { useProjects, useThreadShells } from "../../state/entities";
import { sortScopedProjectsForSidebar } from "../Sidebar.logic";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import { CodeItLabCard, CodeItLabEmptyBlock, CodeItLabSectionHeading } from "./CodeItLabPrimitives";

/**
 * The deploy menu: saved commands, run through a normal thread. It never calls a
 * hosting API itself, so a deploy is exactly as visible and approvable as any
 * other command the agent runs, and credentials stay in the CLI or the
 * credentials proxy.
 */
export function CodeItLabDeployPage() {
  const { codeitlab, update } = useCodeItLabSettingsWriter();
  const targets = codeitlab.deploy.targets;
  const [startingId, setStartingId] = useState<string | null>(null);
  const projects = useProjects();
  const threads = useThreadShells();
  const handleNewThread = useNewThreadHandler();
  // Deploys need a project for the thread's diffs and output. The button says so
  // before the click instead of opening a toast afterwards.
  const firstProject = sortScopedProjectsForSidebar(
    projects.filter((entry) => entry.isScratch !== true),
    threads,
    "updated_at",
  )[0];

  const persist = (next: ReadonlyArray<CodeItLabDeployTarget>) => {
    update({ deploy: { ...codeitlab.deploy, targets: [...next] } });
  };

  const updateTarget = (id: string, patch: Partial<CodeItLabDeployTarget>) => {
    persist(targets.map((target) => (target.id === id ? { ...target, ...patch } : target)));
  };

  const runDeploy = async (target: CodeItLabDeployTarget) => {
    const issue = deployTargetIssue(target);
    if (issue !== null) {
      toastManager.add({ type: "error", title: "Target is not ready", description: issue });
      return;
    }
    if (!target.enabled) {
      toastManager.add({
        type: "error",
        title: "Target is disabled",
        description: "Enable it before running the deploy.",
      });
      return;
    }
    const project = firstProject;
    if (project === undefined) {
      toastManager.add({
        type: "error",
        title: "Open a project first",
        description: "Deploys run in a project so the command and its output have a home.",
      });
      return;
    }
    setStartingId(target.id);
    try {
      const opened = await handleNewThread(scopeProjectRef(project.environmentId, project.id), {
        replace: true,
      });
      if (opened === null) {
        toastManager.add({
          type: "error",
          title: "Could not open a thread",
          description: "Try again, or run the command yourself in the terminal.",
        });
        return;
      }
      useComposerDraftStore.getState().setPrompt(opened.draftId, buildDeployBrief(target));
      toastManager.add({
        type: "success",
        title: `${target.name} deploy is ready`,
        description: "The command is in the composer. Send it when you are ready to run it.",
      });
    } finally {
      setStartingId(null);
    }
  };

  return (
    <div className="flex flex-col gap-6" data-codeitlab-page="deploy">
      <CodeItLabSectionHeading
        description="Saved deploy commands, run in a normal thread. CodeItLab does not call a hosting API itself: the agent runs your command, shows the real output and asks before installing or logging in."
        eyebrow="CodeItLab // deploy"
        title="Deploy"
      />

      {targets.length === 0 ? (
        <CodeItLabEmptyBlock
          action={
            <Button
              type="button"
              onClick={() => persist([createDeployTarget(new Date())])}
              size="sm"
            >
              <PlusIcon /> New target
            </Button>
          }
          description="Start from a provider or a custom command. Each target remembers one command and a note about what it needs."
          title="No deploy targets yet"
        />
      ) : (
        <div className="flex flex-col gap-3">
          {targets.map((target) => {
            const issue = deployTargetIssue(target);
            const blockReason =
              issue ??
              (target.enabled
                ? firstProject === undefined
                  ? "Open a project first: deploys run in a project so the command and its output have a home."
                  : null
                : "This target is disabled; enable it before running the deploy.");
            return (
              <CodeItLabCard className="flex flex-col gap-3 p-4" key={target.id}>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="min-w-40 flex-1">
                    <label
                      className="text-xs font-medium text-muted-foreground"
                      htmlFor={`deploy-name-${target.id}`}
                    >
                      Name
                    </label>
                    <Input
                      id={`deploy-name-${target.id}`}
                      onChange={(event) =>
                        updateTarget(target.id, { name: event.currentTarget.value })
                      }
                      value={target.name}
                    />
                  </div>
                  <label className="flex items-center gap-2 pb-2 text-xs text-muted-foreground">
                    <Checkbox
                      aria-label={`Enable ${target.name}`}
                      checked={target.enabled}
                      onCheckedChange={(checked) =>
                        updateTarget(target.id, { enabled: checked === true })
                      }
                    />
                    Enabled
                  </label>
                  <Button
                    aria-describedby={
                      blockReason === null ? undefined : `deploy-issue-${target.id}`
                    }
                    type="button"
                    disabled={startingId === target.id || blockReason !== null}
                    onClick={() => void runDeploy(target)}
                    size="sm"
                  >
                    <PlayIcon /> {startingId === target.id ? "Preparing…" : "Run deploy"}
                  </Button>
                  <Button
                    type="button"
                    aria-label={`Delete ${target.name}`}
                    onClick={() => persist(targets.filter((entry) => entry.id !== target.id))}
                    size="sm"
                    variant="ghost"
                  >
                    <Trash2Icon />
                  </Button>
                </div>
                <div>
                  <label
                    className="text-xs font-medium text-muted-foreground"
                    htmlFor={`deploy-command-${target.id}`}
                  >
                    Command
                  </label>
                  <Input
                    aria-describedby={
                      blockReason === null ? undefined : `deploy-issue-${target.id}`
                    }
                    id={`deploy-command-${target.id}`}
                    onChange={(event) =>
                      updateTarget(target.id, { command: event.currentTarget.value })
                    }
                    placeholder="vercel deploy --prod"
                    value={target.command}
                  />
                </div>
                <div>
                  <label
                    className="text-xs font-medium text-muted-foreground"
                    htmlFor={`deploy-notes-${target.id}`}
                  >
                    Notes for the agent
                  </label>
                  <Textarea
                    id={`deploy-notes-${target.id}`}
                    onChange={(event) =>
                      updateTarget(target.id, { notes: event.currentTarget.value })
                    }
                    placeholder="What does this target need before it can run?"
                    value={target.notes}
                  />
                </div>
                {blockReason === null ? null : (
                  <p
                    aria-live="polite"
                    className="text-xs text-muted-foreground"
                    id={`deploy-issue-${target.id}`}
                  >
                    {blockReason}
                  </p>
                )}
              </CodeItLabCard>
            );
          })}
        </div>
      )}

      <CodeItLabCard className="flex flex-col gap-3 p-4">
        <p className="text-xs font-medium text-muted-foreground">Add a target</p>
        <div className="flex flex-wrap gap-2">
          {DEPLOY_STARTERS.map((starter) => (
            <Button
              type="button"
              key={starter.name}
              onClick={() => persist([...targets, starterDeployTarget(new Date(), starter)])}
              size="sm"
              variant="outline"
            >
              <RocketIcon /> {starter.name}
            </Button>
          ))}
        </div>
      </CodeItLabCard>
    </div>
  );
}
