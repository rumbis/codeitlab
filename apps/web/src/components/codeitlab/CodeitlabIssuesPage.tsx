import type { CodeitlabIssue } from "@codeitlab/core/issues";
import { issueBrief, issueTitleProblem } from "@codeitlab/core/issues";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { BugIcon, MessageSquareIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { useComposerDraftStore } from "~/composerDraftStore";
import { useCodeitlabSettingsWriter } from "../../codeitlab/effectsSettings";
import { createIssue, issueToBoardTask } from "../../codeitlab/issues";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { useProjects, useThreadShells } from "../../state/entities";
import { sortScopedProjectsForSidebar } from "../Sidebar.logic";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import { CodeitlabCard, CodeitlabEmptyBlock, CodeitlabSectionHeading } from "./CodeitlabPrimitives";

/**
 * Local issues: offline by design. Nothing is fetched and nothing is synced, so the
 * page says so instead of implying a GitHub connection.
 */
export function CodeitlabIssuesPage() {
  const { codeitlab, update } = useCodeitlabSettingsWriter();
  const issues = codeitlab.issues.issues;
  const [title, setTitle] = useState("");
  const projects = useProjects();
  const threads = useThreadShells();
  const handleNewThread = useNewThreadHandler();

  const persist = (next: ReadonlyArray<CodeitlabIssue>) => {
    update({ issues: { ...codeitlab.issues, issues: [...next] } });
  };

  const patchIssue = (id: string, patch: Partial<CodeitlabIssue>) => {
    persist(issues.map((issue) => (issue.id === id ? { ...issue, ...patch } : issue)));
  };

  const addIssue = () => {
    const problem = issueTitleProblem(title);
    if (problem !== null) {
      toastManager.add({ type: "error", title: "Issue is not ready", description: problem });
      return;
    }
    persist([createIssue(new Date(), title.trim()), ...issues]);
    setTitle("");
  };

  const addToBoard = (issue: CodeitlabIssue) => {
    update({
      board: {
        ...codeitlab.board,
        tasks: [...codeitlab.board.tasks, issueToBoardTask(issue, new Date())],
      },
    });
    toastManager.add({
      type: "success",
      title: "Added to the board",
      description: "It is in Pending; start it from the board when you are ready.",
    });
  };

  const sendToThread = async (issue: CodeitlabIssue) => {
    const project = sortScopedProjectsForSidebar(
      projects.filter((entry) => entry.isScratch !== true),
      threads,
      "updated_at",
    )[0];
    if (project === undefined) {
      toastManager.add({
        type: "error",
        title: "Open a project first",
        description: "The issue brief runs in a thread, so it needs a project.",
      });
      return;
    }
    const opened = await handleNewThread(scopeProjectRef(project.environmentId, project.id), {
      replace: true,
    });
    if (opened === null) {
      toastManager.add({ type: "error", title: "Could not open a thread" });
      return;
    }
    useComposerDraftStore.getState().setPrompt(opened.draftId, issueBrief(issue));
    toastManager.add({
      type: "success",
      title: "Issue brief is in the composer",
      description: "Send it when you want the work to start.",
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <CodeitlabSectionHeading
        description="A local issue list for problems you meet while working. Nothing is fetched or synced: there is no GitHub connection behind this page, and an issue only becomes work when you send it to the board or a thread."
        eyebrow="CodeItLab // issues"
        title="Issues"
      />

      <CodeitlabCard className="flex flex-wrap items-end gap-2 p-4">
        <div className="min-w-48 flex-1">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="issue-title">
            New issue
          </label>
          <Input
            id="issue-title"
            onChange={(event) => setTitle(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") addIssue();
            }}
            placeholder="What is broken?"
            value={title}
          />
        </div>
        <Button type="button" onClick={addIssue} size="sm">
          <PlusIcon /> Add issue
        </Button>
      </CodeitlabCard>

      {issues.length === 0 ? (
        <CodeitlabEmptyBlock
          description="Write the first issue above. Keep it short: a title and the steps are enough to start."
          title="No issues yet"
        />
      ) : (
        <div className="flex flex-col gap-3">
          {issues.map((issue) => (
            <CodeitlabCard className="flex flex-col gap-3 p-4" key={issue.id}>
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-48 flex-1">
                  <label
                    className="text-xs font-medium text-muted-foreground"
                    htmlFor={`issue-title-${issue.id}`}
                  >
                    Title
                  </label>
                  <Input
                    id={`issue-title-${issue.id}`}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      patchIssue(issue.id, { title: value, updatedAt: new Date().toISOString() });
                    }}
                    value={issue.title}
                  />
                </div>
                <label className="text-xs text-muted-foreground">
                  Status
                  <select
                    aria-label={`Status of ${issue.title}`}
                    className="ml-2 rounded-md border border-border bg-background px-2 py-1 text-xs"
                    onChange={(event) => {
                      const value = event.currentTarget.value as CodeitlabIssue["status"];
                      patchIssue(issue.id, { status: value, updatedAt: new Date().toISOString() });
                    }}
                    value={issue.status}
                  >
                    <option value="open">Open</option>
                    <option value="inProgress">In progress</option>
                    <option value="closed">Closed</option>
                  </select>
                </label>
                <Button type="button" onClick={() => addToBoard(issue)} size="sm" variant="outline">
                  <BugIcon /> Add to board
                </Button>
                <Button type="button" onClick={() => void sendToThread(issue)} size="sm">
                  <MessageSquareIcon /> Send to thread
                </Button>
                <Button
                  type="button"
                  aria-label={`Delete ${issue.title}`}
                  onClick={() => persist(issues.filter((entry) => entry.id !== issue.id))}
                  size="sm"
                  variant="ghost"
                >
                  <Trash2Icon />
                </Button>
              </div>
              <Textarea
                aria-label={`Details for ${issue.title}`}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  patchIssue(issue.id, { body: value, updatedAt: new Date().toISOString() });
                }}
                placeholder="Steps, expected result, what you saw instead"
                value={issue.body}
              />
              <Input
                aria-label={`Source for ${issue.title}`}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  patchIssue(issue.id, { source: value, updatedAt: new Date().toISOString() });
                }}
                placeholder="Optional link to where this issue lives"
                value={issue.source}
              />
            </CodeitlabCard>
          ))}
        </div>
      )}
    </div>
  );
}
