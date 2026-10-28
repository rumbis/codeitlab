import { scopeProjectRef } from "@codeitlab/client-runtime/environment";
import type { ProviderInstanceId } from "@codeitlab/contracts";
import { PlusIcon, PlayIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { useComposerDraftStore } from "~/composerDraftStore";
import { useCodeItLabSettingsWriter } from "../../codeitlab/effectsSettings";
import {
  MAX_TEAM_WORKERS,
  buildTeamBrief,
  createTeamPreset,
  createTeamRun,
  createTeamWorker,
  teamPresetIssue,
} from "../../codeitlab/team";
import { appendTeamRun } from "@codeitlab/core/team";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { deriveProviderInstanceEntries } from "../../providerInstances";
import { useEnvironmentProviders, usePrimaryEnvironmentId } from "../../state/environments";
import { useProjects, useThreadShells } from "../../state/entities";
import { sortScopedProjectsForSidebar } from "../Sidebar.logic";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import { CodeItLabCard, CodeItLabEmptyBlock, CodeItLabSectionHeading } from "./CodeItLabPrimitives";
import { CodeItLabTeamRunCard } from "./CodeItLabTeamRunCard";
import type { CodeItLabTeamPreset } from "@codeitlab/core/team";

const PROVIDERS_LIST_ID = "codeitlab-team-providers";
const MODELS_LIST_ID = "codeitlab-team-models";

/**
 * Agent teams: a saved preset (architect + up to three workers) plus a brief.
 * Starting a team opens an ordinary draft thread and puts the brief in its
 * composer, so the architect delegates through `delegate_task` and the run is
 * visible, steerable and diffable like any other thread.
 */
export function CodeItLabTeamPage() {
  const { codeitlab, update } = useCodeItLabSettingsWriter();
  const presets = codeitlab.team.presets;
  const [selectedId, setSelectedId] = useState<string | null>(presets[0]?.id ?? null);
  const [draft, setDraft] = useState<CodeItLabTeamPreset | null>(presets[0] ?? null);
  const [task, setTask] = useState("");
  const [starting, setStarting] = useState(false);

  const environmentId = usePrimaryEnvironmentId();
  const providersByEnvironment = useEnvironmentProviders();
  const providers = environmentId === null ? [] : (providersByEnvironment.get(environmentId) ?? []);
  const entries = deriveProviderInstanceEntries(providers).filter((entry) => entry.enabled);
  const models = entries.flatMap((entry) =>
    entry.models.map((model) => ({ instanceId: entry.instanceId as string, slug: model.slug })),
  );

  const projects = useProjects();
  const threads = useThreadShells();
  const handleNewThread = useNewThreadHandler();

  const selectPreset = (preset: CodeItLabTeamPreset | null) => {
    setSelectedId(preset?.id ?? null);
    setDraft(preset);
  };

  const persist = (preset: CodeItLabTeamPreset) => {
    const next = presets.some((entry) => entry.id === preset.id)
      ? presets.map((entry) => (entry.id === preset.id ? preset : entry))
      : [...presets, preset];
    update({ team: { ...codeitlab.team, presets: next } });
    setSelectedId(preset.id);
    setDraft(preset);
  };

  const updateDraft = (patch: Partial<CodeItLabTeamPreset>) => {
    if (draft === null) return;
    setDraft({ ...draft, ...patch });
  };

  const updateWorker = (index: number, patch: Partial<CodeItLabTeamPreset["workers"][number]>) => {
    if (draft === null) return;
    setDraft({
      ...draft,
      workers: draft.workers.map((worker, workerIndex) =>
        workerIndex === index ? { ...worker, ...patch } : worker,
      ),
    });
  };

  const addWorker = () => {
    if (draft === null || draft.workers.length >= MAX_TEAM_WORKERS) return;
    setDraft({ ...draft, workers: [...draft.workers, createTeamWorker(draft.workers.length + 1)] });
  };

  const removeWorker = (index: number) => {
    if (draft === null) return;
    setDraft({
      ...draft,
      workers: draft.workers.filter((_, workerIndex) => workerIndex !== index),
    });
  };

  // The button says why it cannot start instead of opening a toast after the
  // click: a preset issue and an empty brief are both visible before pressing.
  const startBlocker =
    draft === null
      ? null
      : (teamPresetIssue(draft) ??
        (task.trim() === "" ? "Describe the task so the architect has something to split." : null));

  const start = async () => {
    if (draft === null) return;
    const issue = teamPresetIssue(draft);
    if (issue !== null) {
      toastManager.add({ type: "error", title: "Team is not ready", description: issue });
      return;
    }
    if (task.trim() === "") {
      toastManager.add({
        type: "error",
        title: "Describe the task",
        description: "The architect needs a task to split between the workers.",
      });
      return;
    }
    const project = sortScopedProjectsForSidebar(
      projects.filter((entry) => entry.isScratch !== true),
      threads,
      "updated_at",
    )[0];
    if (project === undefined) {
      toastManager.add({
        type: "error",
        title: "Open a project first",
        description: "Teams run in a project so their changes and diffs have a home.",
      });
      return;
    }
    setStarting(true);
    try {
      persist(draft);
      const opened = await handleNewThread(scopeProjectRef(project.environmentId, project.id), {
        replace: true,
      });
      if (opened === null) {
        toastManager.add({
          type: "error",
          title: "Could not open a thread",
          description: "Try again, or start the team from the composer.",
        });
        return;
      }
      const composer = useComposerDraftStore.getState();
      composer.setPrompt(opened.draftId, buildTeamBrief(draft, task));
      if (draft.architectInstanceId.trim() !== "" && draft.architectModel.trim() !== "") {
        composer.setModelSelection(
          opened.draftId,
          {
            instanceId: draft.architectInstanceId as ProviderInstanceId,
            model: draft.architectModel.trim(),
          },
          { explicit: true },
        );
      }
      update({
        team: {
          ...codeitlab.team,
          runs: appendTeamRun(
            codeitlab.team.runs,
            createTeamRun({
              preset: draft,
              threadId: opened.threadId,
              environmentId: project.environmentId,
              task,
              now: new Date(),
            }),
          ),
        },
      });
      setTask("");
      toastManager.add({
        type: "success",
        title: "Team brief ready",
        description:
          "Review it in the composer, then send. The architect delegates to the workers.",
      });
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <CodeItLabSectionHeading
        description="Save an architect and up to three workers, then hand the architect a brief. The run is a normal thread: delegation uses delegate_task, and the answer ends with one row per worker plus a synthesis."
        eyebrow="CodeItLab // agent teams"
        title="Teams"
      />

      {presets.length === 0 || draft === null ? (
        <CodeItLabEmptyBlock
          action={
            <Button
              type="button"
              onClick={() => {
                const preset = createTeamPreset();
                persist(preset);
              }}
              size="sm"
            >
              <PlusIcon /> New team preset
            </Button>
          }
          description="A preset remembers the architect's model and each worker's role and model. Starting it opens a thread with the brief already written."
          title="No team presets yet"
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
          <div className="flex flex-col gap-2">
            {presets.map((preset) => (
              <button
                className={
                  preset.id === selectedId
                    ? "rounded-lg border border-codeitlab-green/40 bg-codeitlab-green/10 px-3 py-2 text-left text-sm text-codeitlab-green focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 focus-visible:outline-ring"
                    : "rounded-lg border border-border/60 px-3 py-2 text-left text-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 focus-visible:outline-ring"
                }
                key={preset.id}
                onClick={() => selectPreset(preset)}
                type="button"
              >
                <span className="block truncate font-medium">{preset.name}</span>
                <span className="block text-2xs tabular-nums text-muted-foreground">
                  {preset.workers.length} worker{preset.workers.length === 1 ? "" : "s"}
                </span>
              </button>
            ))}
            <Button
              type="button"
              className="justify-start"
              onClick={() => persist(createTeamPreset())}
              size="sm"
              variant="ghost"
            >
              <PlusIcon /> New preset
            </Button>
          </div>

          <div className="flex flex-col gap-4">
            <CodeItLabCard className="p-4">
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-48 flex-1">
                  <label className="text-xs font-medium text-muted-foreground" htmlFor="team-name">
                    Team name
                  </label>
                  <Input
                    id="team-name"
                    onChange={(event) => updateDraft({ name: event.currentTarget.value })}
                    value={draft.name}
                  />
                </div>
                <div className="flex gap-2">
                  <Button type="button" onClick={() => persist(draft)} size="sm" variant="outline">
                    Save preset
                  </Button>
                  <Button
                    type="button"
                    onClick={() => {
                      const remaining = presets.filter((preset) => preset.id !== draft.id);
                      update({ team: { ...codeitlab.team, presets: remaining } });
                      selectPreset(remaining[0] ?? null);
                    }}
                    size="sm"
                    variant="ghost"
                  >
                    <Trash2Icon /> Delete
                  </Button>
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div>
                  <label
                    className="text-xs font-medium text-muted-foreground"
                    htmlFor="team-architect-provider"
                  >
                    Architect provider
                  </label>
                  <Input
                    id="team-architect-provider"
                    list={PROVIDERS_LIST_ID}
                    onChange={(event) =>
                      updateDraft({ architectInstanceId: event.currentTarget.value })
                    }
                    placeholder="Empty = the thread's provider"
                    value={draft.architectInstanceId}
                  />
                </div>
                <div>
                  <label
                    className="text-xs font-medium text-muted-foreground"
                    htmlFor="team-architect-model"
                  >
                    Architect model
                  </label>
                  <Input
                    id="team-architect-model"
                    list={MODELS_LIST_ID}
                    onChange={(event) => updateDraft({ architectModel: event.currentTarget.value })}
                    placeholder="Empty = the provider's default"
                    value={draft.architectModel}
                  />
                </div>
              </div>
            </CodeItLabCard>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <p className="codeitlab-mono-label text-muted-foreground">Workers</p>
                <Button
                  type="button"
                  disabled={draft.workers.length >= MAX_TEAM_WORKERS}
                  onClick={addWorker}
                  size="sm"
                  variant="outline"
                >
                  <PlusIcon /> Add worker
                </Button>
              </div>
              {draft.workers.map((worker, index) => (
                <CodeItLabCard className="p-3" key={worker.id}>
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.2fr)_auto]">
                    <Input
                      aria-label={`Worker ${index + 1} name`}
                      onChange={(event) => updateWorker(index, { name: event.currentTarget.value })}
                      value={worker.name}
                    />
                    <Input
                      aria-label={`Worker ${index + 1} role`}
                      onChange={(event) => updateWorker(index, { role: event.currentTarget.value })}
                      value={worker.role}
                    />
                    <Input
                      aria-label={`Worker ${index + 1} provider`}
                      list={PROVIDERS_LIST_ID}
                      onChange={(event) =>
                        updateWorker(index, { instanceId: event.currentTarget.value })
                      }
                      placeholder="Provider (inherit)"
                      value={worker.instanceId}
                    />
                    <Input
                      aria-label={`Worker ${index + 1} model`}
                      list={MODELS_LIST_ID}
                      onChange={(event) =>
                        updateWorker(index, { model: event.currentTarget.value })
                      }
                      placeholder="Model (default)"
                      value={worker.model}
                    />
                    <Button
                      type="button"
                      aria-label={`Remove worker ${index + 1}`}
                      onClick={() => removeWorker(index)}
                      size="icon-sm"
                      variant="ghost"
                    >
                      <Trash2Icon />
                    </Button>
                  </div>
                </CodeItLabCard>
              ))}
              {draft.workers.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Add a worker: the architect delegates one part of the task to each row.
                </p>
              ) : null}
            </div>

            <CodeItLabCard className="p-4">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="team-task">
                Task
              </label>
              <Textarea
                className="mt-1 min-h-24"
                id="team-task"
                onChange={(event) => setTask(event.currentTarget.value)}
                placeholder="What should the team do?"
                value={task}
              />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <p
                  aria-live="polite"
                  className="text-xs text-muted-foreground"
                  id="team-start-state"
                >
                  {startBlocker ??
                    "Opens a draft in your most recent project. Nothing runs until you send."}
                </p>
                <Button
                  aria-describedby="team-start-state"
                  type="button"
                  disabled={starting || startBlocker !== null}
                  onClick={() => void start()}
                  size="sm"
                >
                  <PlayIcon /> {starting ? "Preparing…" : "Start team"}
                </Button>
              </div>
            </CodeItLabCard>

            <datalist id={PROVIDERS_LIST_ID}>
              {entries.map((entry) => (
                <option key={entry.instanceId as string} value={entry.instanceId as string}>
                  {entry.displayName}
                </option>
              ))}
            </datalist>
            <datalist id={MODELS_LIST_ID}>
              {models.map((model) => (
                <option key={`${model.instanceId}:${model.slug}`} value={model.slug}>
                  {model.instanceId}
                </option>
              ))}
            </datalist>

            {entries.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No provider is connected yet, so provider and model fields are free text. Empty
                fields inherit the thread's provider and its default model.
              </p>
            ) : null}
          </div>
        </div>
      )}

      <section aria-label="Recent team runs" className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Recent runs</h3>
        {codeitlab.team.runs.length === 0 ? (
          <CodeItLabEmptyBlock
            description="Starting a team records the run here. Worker rows appear when the architect delegates, and the synthesis lists each worker's result."
            title="No team runs yet"
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {codeitlab.team.runs.map((run) => (
              <li key={run.id}>
                <CodeItLabTeamRunCard run={run} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
