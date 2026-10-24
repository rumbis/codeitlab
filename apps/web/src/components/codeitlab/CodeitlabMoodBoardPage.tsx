import type { CodeitlabMoodBoard, CodeitlabMoodColor } from "@codeitlab/core/moodboard";
import {
  moodBoardBrief,
  moodBoardIssue,
  moodBoardMarkdown,
  normalizeHexColor,
} from "@codeitlab/core/moodboard";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { CopyIcon, MessageSquareIcon, PaletteIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { useComposerDraftStore } from "~/composerDraftStore";
import { useCodeitlabSettingsWriter } from "../../codeitlab/effectsSettings";
import { createMoodBoard } from "../../codeitlab/moodboard";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { useProjects, useThreadShells } from "../../state/entities";
import { sortScopedProjectsForSidebar } from "../Sidebar.logic";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { toastManager } from "../ui/toast";
import { CodeitlabCard, CodeitlabEmptyBlock, CodeitlabSectionHeading } from "./CodeitlabPrimitives";

/**
 * Mood boards keep design intent where the agent can read it: a palette,
 * references and notes that turn into a brief. Stored as settings, so no canvas
 * blob and no new execution path.
 */
export function CodeitlabMoodBoardPage() {
  const { codeitlab, update } = useCodeitlabSettingsWriter();
  const boards = codeitlab.moodboards.boards;
  const [hex, setHex] = useState<Record<string, string>>({});
  const [imageUrl, setImageUrl] = useState<Record<string, string>>({});
  const [imageCaption, setImageCaption] = useState<Record<string, string>>({});
  const [note, setNote] = useState<Record<string, string>>({});
  const projects = useProjects();
  const threads = useThreadShells();
  const handleNewThread = useNewThreadHandler();

  const persist = (next: ReadonlyArray<CodeitlabMoodBoard>) => {
    update({ moodboards: { ...codeitlab.moodboards, boards: [...next] } });
  };

  const patchBoard = (id: string, patch: Partial<CodeitlabMoodBoard>) => {
    persist(boards.map((board) => (board.id === id ? { ...board, ...patch } : board)));
  };

  const addColor = (board: CodeitlabMoodBoard) => {
    const normalized = normalizeHexColor(hex[board.id] ?? "");
    if (normalized === null) {
      toastManager.add({
        type: "error",
        title: "Not a hex colour",
        description: "Use #rgb or #rrggbb, for example #112233.",
      });
      return;
    }
    const color: CodeitlabMoodColor = { hex: normalized, name: "" };
    patchBoard(board.id, { colors: [...board.colors, color] });
    setHex((current) => ({ ...current, [board.id]: "" }));
  };

  const addImage = (board: CodeitlabMoodBoard) => {
    const url = (imageUrl[board.id] ?? "").trim();
    if (url === "") return;
    patchBoard(board.id, {
      images: [...board.images, { url, caption: (imageCaption[board.id] ?? "").trim() }],
    });
    setImageUrl((current) => ({ ...current, [board.id]: "" }));
    setImageCaption((current) => ({ ...current, [board.id]: "" }));
  };

  const addNote = (board: CodeitlabMoodBoard) => {
    const text = (note[board.id] ?? "").trim();
    if (text === "") return;
    patchBoard(board.id, { notes: [...board.notes, text] });
    setNote((current) => ({ ...current, [board.id]: "" }));
  };

  const copyMarkdown = async (board: CodeitlabMoodBoard) => {
    try {
      await navigator.clipboard.writeText(moodBoardMarkdown(board));
      toastManager.add({ type: "success", title: "Mood board copied" });
    } catch {
      toastManager.add({
        type: "error",
        title: "Clipboard is not available",
        description: "Use Send to thread instead; the brief carries the same content.",
      });
    }
  };

  const sendToThread = async (board: CodeitlabMoodBoard) => {
    const issue = moodBoardIssue(board);
    if (issue !== null) {
      toastManager.add({ type: "error", title: "Board is not ready", description: issue });
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
        description: "The brief runs in a thread, so it needs a project.",
      });
      return;
    }
    const opened = await handleNewThread(scopeProjectRef(project.environmentId, project.id), {
      replace: true,
    });
    if (opened === null) {
      toastManager.add({
        type: "error",
        title: "Could not open a thread",
        description: "Try again, or copy the markdown and paste it.",
      });
      return;
    }
    useComposerDraftStore.getState().setPrompt(opened.draftId, moodBoardBrief(board));
    toastManager.add({
      type: "success",
      title: "Mood brief is in the composer",
      description: "Send it when you want the change to start.",
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <CodeitlabSectionHeading
        description="A palette, reference images and short notes the agent can read. Boards are saved as settings and turned into a brief, so design intent does not live only in your head."
        eyebrow="CodeItLab // mood"
        title="Mood boards"
      />

      {boards.length === 0 ? (
        <CodeitlabEmptyBlock
          action={
            <Button type="button" onClick={() => persist([createMoodBoard(new Date())])} size="sm">
              <PlusIcon /> New board
            </Button>
          }
          description="Start a board for a project or a single change: three colours and one reference are usually enough."
          title="No mood boards yet"
        />
      ) : (
        <div className="flex flex-col gap-4">
          {boards.map((board) => (
            <CodeitlabCard className="flex flex-col gap-4 p-4" key={board.id}>
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-40 flex-1">
                  <label
                    className="text-xs font-medium text-muted-foreground"
                    htmlFor={`mood-name-${board.id}`}
                  >
                    Name
                  </label>
                  <Input
                    id={`mood-name-${board.id}`}
                    onChange={(event) => patchBoard(board.id, { name: event.currentTarget.value })}
                    value={board.name}
                  />
                </div>
                <Button
                  type="button"
                  onClick={() => void copyMarkdown(board)}
                  size="sm"
                  variant="outline"
                >
                  <CopyIcon /> Copy markdown
                </Button>
                <Button type="button" onClick={() => void sendToThread(board)} size="sm">
                  <MessageSquareIcon /> Send to thread
                </Button>
                <Button
                  type="button"
                  aria-label={`Delete ${board.name}`}
                  onClick={() => persist(boards.filter((entry) => entry.id !== board.id))}
                  size="sm"
                  variant="ghost"
                >
                  <Trash2Icon />
                </Button>
              </div>

              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">Palette</p>
                <div className="flex flex-wrap items-center gap-2">
                  {board.colors.map((color, index) => (
                    <span
                      className="flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-2xs tabular-nums"
                      key={`${color.hex}-${color.name}`}
                    >
                      <span
                        aria-hidden
                        className="size-3 rounded-sm border border-border/60"
                        style={{ backgroundColor: color.hex }}
                      />
                      {color.hex}
                      <button
                        aria-label={`Remove ${color.hex}`}
                        className="text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset"
                        onClick={() =>
                          patchBoard(board.id, {
                            colors: board.colors.filter((_, i) => i !== index),
                          })
                        }
                        type="button"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  <Input
                    aria-label={`Colour hex for ${board.name}`}
                    className="max-w-28"
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setHex((current) => ({ ...current, [board.id]: value }));
                    }}
                    placeholder="#112233"
                    value={hex[board.id] ?? ""}
                  />
                  <Button
                    type="button"
                    aria-label={`Add colour to ${board.name}`}
                    onClick={() => addColor(board)}
                    size="sm"
                    variant="outline"
                  >
                    <PaletteIcon /> Add
                  </Button>
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">References</p>
                <ul className="flex flex-col gap-1 text-2xs">
                  {board.images.map((image, index) => (
                    <li
                      className="flex items-center justify-between gap-2"
                      key={`${image.url}-${image.caption}`}
                    >
                      <span className="truncate">
                        {image.url}
                        {image.caption === "" ? "" : ` — ${image.caption}`}
                      </span>
                      <button
                        aria-label={`Remove reference ${image.url}`}
                        className="text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset"
                        onClick={() =>
                          patchBoard(board.id, {
                            images: board.images.filter((_, i) => i !== index),
                          })
                        }
                        type="button"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Input
                    aria-label={`Reference URL for ${board.name}`}
                    className="min-w-48 flex-1"
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setImageUrl((current) => ({ ...current, [board.id]: value }));
                    }}
                    placeholder="https://…"
                    value={imageUrl[board.id] ?? ""}
                  />
                  <Input
                    aria-label={`Reference caption for ${board.name}`}
                    className="max-w-48"
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setImageCaption((current) => ({ ...current, [board.id]: value }));
                    }}
                    placeholder="What to take from it"
                    value={imageCaption[board.id] ?? ""}
                  />
                  <Button
                    type="button"
                    aria-label={`Add reference to ${board.name}`}
                    onClick={() => addImage(board)}
                    size="sm"
                    variant="outline"
                  >
                    Add reference
                  </Button>
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">Notes</p>
                <ul className="flex flex-col gap-1 text-2xs">
                  {board.notes.map((entry, index) => (
                    <li className="flex items-center justify-between gap-2" key={entry}>
                      <span>{entry}</span>
                      <button
                        aria-label={`Remove note ${entry}`}
                        className="text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset"
                        onClick={() =>
                          patchBoard(board.id, {
                            notes: board.notes.filter((_, i) => i !== index),
                          })
                        }
                        type="button"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Input
                    aria-label={`Note for ${board.name}`}
                    className="min-w-48 flex-1"
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setNote((current) => ({ ...current, [board.id]: value }));
                    }}
                    placeholder="A constraint or a rule"
                    value={note[board.id] ?? ""}
                  />
                  <Button
                    type="button"
                    aria-label={`Add note to ${board.name}`}
                    onClick={() => addNote(board)}
                    size="sm"
                    variant="outline"
                  >
                    Add note
                  </Button>
                </div>
              </div>

              {moodBoardIssue(board) === null ? null : (
                <p className="text-2xs text-muted-foreground">{moodBoardIssue(board)}</p>
              )}
            </CodeitlabCard>
          ))}
          <Button
            type="button"
            className="justify-start"
            onClick={() => persist([...boards, createMoodBoard(new Date())])}
            size="sm"
            variant="ghost"
          >
            <PlusIcon /> New board
          </Button>
        </div>
      )}
    </div>
  );
}
