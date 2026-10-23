import {
  ArrowDownIcon,
  ArrowUpIcon,
  ClapperboardIcon,
  CopyIcon,
  DownloadIcon,
  FilmIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  PresentationIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useDeferredValue, useEffect, useRef, useState } from "react";
import {
  renderStudioHtml,
  type StudioKind,
  type StudioLayout,
  type StudioProject,
  type StudioProjectInput,
  type StudioSlide,
} from "@codeitlab/core/studio";

import { playCodeitlabSfx, unlockCodeitlabAudio } from "../../codeitlab/audio";
import {
  addStudioSlide,
  createStudioProjectInput,
  emptyStudioSlide,
  moveStudioSlide,
  removeStudioSlide,
  STUDIO_ASPECTS,
  STUDIO_ASPECT_LABELS,
  STUDIO_KIND_LABELS,
  STUDIO_LAYOUTS,
  STUDIO_LAYOUT_LABELS,
  STUDIO_THEMES,
  STUDIO_THEME_LABELS,
  studioSlideCountLabel,
  updateStudioSlide,
} from "../../codeitlab/studio/model";
import { useCodeitlabStudio } from "../../codeitlab/api";
import { cn } from "~/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { StudioPlayer } from "./StudioPlayer";

const AUTOSAVE_DELAY_MS = 500;

function toProjectInput(project: StudioProject): StudioProjectInput {
  return {
    id: project.id,
    name: project.name,
    kind: project.kind,
    theme: project.theme,
    aspect: project.aspect,
    slides: project.slides,
  };
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function StudioPage() {
  const store = useCodeitlabStudio();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const selected = store.projects.find((project) => project.id === selectedId) ?? null;
  const playing = store.projects.find((project) => project.id === playingId) ?? null;

  const createProject = async (kind: StudioKind) => {
    unlockCodeitlabAudio();
    playCodeitlabSfx("click");
    try {
      const project = await store.save(createStudioProjectInput({ kind }));
      setSelectedId(project.id);
      playCodeitlabSfx("success");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the project.");
    }
  };

  const commitRename = async (project: StudioProject) => {
    const name = renameDraft.trim();
    setRenamingId(null);
    if (name.length === 0 || name === project.name) return;
    await store.save({ ...toProjectInput(project), name });
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden" data-studio-page>
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border/60 px-6 py-5">
        <div className="flex flex-col gap-1">
          <span className="codeitlab-mono-label text-codeitlab-green">
            STUDIO // DECKS &amp; VIDEO
          </span>
          <h1 className="font-display text-2xl font-semibold text-foreground">Studio</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Build a deck or a video storyboard from the same slide document. Preview and export use
            the shared CodeitLab renderer, so what you see is the file you get.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge size="sm" variant={store.source === "server" ? "success" : "outline"}>
            {store.source === "server" ? "server" : "local draft"}
          </Badge>
          <Button size="sm" variant="outline" onClick={() => void createProject("deck")}>
            <PresentationIcon className="size-3.5" />
            New deck
          </Button>
          <Button size="sm" variant="outline" onClick={() => void createProject("video")}>
            <FilmIcon className="size-3.5" />
            New video
          </Button>
        </div>
      </div>

      {error === null ? null : (
        <div className="px-6 pt-4">
          <Alert variant="error">
            <AlertTitle>Studio error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
        {store.projects.length === 0 ? (
          <div
            className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-codeitlab-green/25 bg-codeitlab-green/2 px-6 py-14 text-center"
            data-studio-empty
          >
            <ClapperboardIcon className="size-8 text-codeitlab-green/70" />
            <p className="font-display text-lg text-foreground">No Studio projects yet</p>
            <p className="max-w-md text-sm text-muted-foreground">
              Start with a four-slide deck or a four-scene video storyboard. Everything is a plain
              document you can reorder and edit.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button size="sm" variant="outline" onClick={() => void createProject("deck")}>
                <PresentationIcon className="size-3.5" />
                New deck
              </Button>
              <Button size="sm" variant="outline" onClick={() => void createProject("video")}>
                <FilmIcon className="size-3.5" />
                New video
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-studio-project-list>
            {store.projects.map((project) => (
              <div
                key={project.id}
                className={cn(
                  "flex flex-col gap-3 rounded-xl border bg-card/60 p-4",
                  project.id === selectedId
                    ? "border-codeitlab-green/40 ring-1 ring-codeitlab-green/20"
                    : "border-border/60",
                )}
                data-studio-project={project.id}
                data-studio-project-kind={project.kind}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    {renamingId === project.id ? (
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          void commitRename(project);
                        }}
                      >
                        <Input
                          autoFocus
                          size="sm"
                          value={renameDraft}
                          onChange={(event) => setRenameDraft(event.target.value)}
                          onBlur={() => void commitRename(project)}
                          aria-label={`Rename ${project.name}`}
                        />
                      </form>
                    ) : (
                      <p className="truncate font-display text-sm font-semibold text-foreground">
                        {project.name}
                      </p>
                    )}
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Badge size="sm" variant={project.kind === "video" ? "info" : "secondary"}>
                        {STUDIO_KIND_LABELS[project.kind]}
                      </Badge>
                      <Badge size="sm" variant="outline">
                        {STUDIO_THEME_LABELS[project.theme]}
                      </Badge>
                      <Badge size="sm" variant="outline">
                        {project.aspect}
                      </Badge>
                      <span className="font-mono text-2xs text-muted-foreground">
                        {studioSlideCountLabel(project.slides.length)}
                      </span>
                    </div>
                  </div>
                </div>
                <p className="text-2xs text-muted-foreground">
                  Updated {formatUpdatedAt(project.updatedAt)}
                </p>
                <div className="mt-auto flex flex-wrap items-center gap-1.5">
                  <Button size="sm" variant="outline" onClick={() => setSelectedId(project.id)}>
                    <PencilIcon className="size-3.5" />
                    Open
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setPlayingId(project.id)}
                    aria-label={`Play ${project.name}`}
                  >
                    <PlayIcon className="size-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setRenamingId(project.id);
                      setRenameDraft(project.name);
                    }}
                    aria-label={`Rename ${project.name}`}
                  >
                    <PencilIcon className="size-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Delete ${project.name}`}
                    onClick={() => {
                      if (selectedId === project.id) setSelectedId(null);
                      void store.remove(project.id).then((deleted) => {
                        if (deleted) playCodeitlabSfx("click");
                      });
                    }}
                  >
                    <Trash2Icon className="size-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {selected === null ? null : (
          <StudioEditor
            key={selected.id}
            project={selected}
            onClose={() => setSelectedId(null)}
            onPlay={() => setPlayingId(selected.id)}
            onError={setError}
          />
        )}
      </div>

      {playing === null ? null : (
        <StudioPlayer project={playing} onClose={() => setPlayingId(null)} />
      )}
    </div>
  );
}

function StudioEditor({
  project,
  onClose,
  onPlay,
  onError,
}: {
  readonly project: StudioProject;
  readonly onClose: () => void;
  readonly onPlay: () => void;
  readonly onError: (message: string | null) => void;
}) {
  const store = useCodeitlabStudio();
  const save = store.save;
  const exportProject = store.exportProject;
  const [draft, setDraft] = useState<StudioProjectInput>(() => toProjectInput(project));
  const [selectedSlideId, setSelectedSlideId] = useState<string | null>(
    project.slides[0]?.id ?? null,
  );
  const [exportResult, setExportResult] = useState<{ path: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [copied, setCopied] = useState(false);
  const savedSnapshot = useRef(JSON.stringify(toProjectInput(project)));

  const selectedSlide =
    draft.slides.find((slide) => slide.id === selectedSlideId) ?? draft.slides[0] ?? null;
  const deferredDraft = useDeferredValue(draft);
  const previewHtml = renderStudioHtml({
    ...project,
    name: deferredDraft.name,
    kind: deferredDraft.kind,
    theme: deferredDraft.theme,
    aspect: deferredDraft.aspect,
    slides: [...deferredDraft.slides],
  });

  useEffect(() => {
    const snapshot = JSON.stringify(draft);
    if (snapshot === savedSnapshot.current) return;
    const timer = window.setTimeout(() => {
      savedSnapshot.current = snapshot;
      void save(draft)
        .then(() => onError(null))
        .catch((cause: unknown) =>
          onError(cause instanceof Error ? cause.message : "Could not save the project."),
        );
    }, AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [draft, save, onError]);

  const patchSlide = (slideId: string, patch: Partial<Omit<StudioSlide, "id">>) => {
    setDraft((current) => ({
      ...current,
      slides: [...updateStudioSlide(current.slides, slideId, patch)],
    }));
  };

  const moveSlide = (index: number, delta: number) => {
    setDraft((current) => ({
      ...current,
      slides: [...moveStudioSlide(current.slides, index, delta)],
    }));
    playCodeitlabSfx("click");
  };

  const addSlide = () => {
    const slide = emptyStudioSlide();
    setDraft((current) => ({ ...current, slides: [...addStudioSlide(current.slides, slide)] }));
    setSelectedSlideId(slide.id);
    playCodeitlabSfx("click");
  };

  const removeSlide = (slideId: string) => {
    setDraft((current) => {
      const slides = removeStudioSlide(current.slides, slideId);
      if (slides.length === current.slides.length) return current;
      return { ...current, slides: [...slides] };
    });
    if (selectedSlideId === slideId) setSelectedSlideId(null);
    playCodeitlabSfx("click");
  };

  const runExport = async () => {
    setExporting(true);
    try {
      const result = await exportProject(project.id);
      setExportResult({ path: result.path });
      playCodeitlabSfx("success");
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Export failed.");
      playCodeitlabSfx("error");
    }
    setExporting(false);
  };

  return (
    <section
      className="flex flex-col gap-4 rounded-2xl border border-border/60 bg-card/40 p-4"
      data-studio-editor
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Back to project list">
            <XIcon className="size-3.5" />
            All projects
          </Button>
          <Input
            size="sm"
            className="w-56"
            value={draft.name}
            onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
            aria-label="Project name"
          />
          <Badge size="sm" variant="outline">
            {STUDIO_KIND_LABELS[draft.kind]}
          </Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={onPlay} data-studio-open-player>
            <PlayIcon className="size-3.5" />
            Play
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={exporting}
            onClick={() => void runExport()}
            data-studio-export
          >
            <DownloadIcon className="size-3.5" />
            {exporting ? "Exporting…" : "Export"}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Theme
          <Select
            value={draft.theme}
            onValueChange={(value) => {
              if (value === "matrix" || value === "noir" || value === "aurora") {
                setDraft((current) => ({ ...current, theme: value }));
              }
            }}
          >
            <SelectTrigger size="sm" className="w-32" aria-label="Studio theme">
              <SelectValue>{STUDIO_THEME_LABELS[draft.theme]}</SelectValue>
            </SelectTrigger>
            <SelectPopup alignItemWithTrigger={false}>
              {STUDIO_THEMES.map((theme) => (
                <SelectItem key={theme} hideIndicator value={theme}>
                  {STUDIO_THEME_LABELS[theme]}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Aspect
          <Select
            value={draft.aspect}
            onValueChange={(value) => {
              if (value === "16:9" || value === "9:16" || value === "1:1") {
                setDraft((current) => ({ ...current, aspect: value }));
              }
            }}
          >
            <SelectTrigger size="sm" className="w-44" aria-label="Studio aspect ratio">
              <SelectValue>{STUDIO_ASPECT_LABELS[draft.aspect]}</SelectValue>
            </SelectTrigger>
            <SelectPopup alignItemWithTrigger={false}>
              {STUDIO_ASPECTS.map((aspect) => (
                <SelectItem key={aspect} hideIndicator value={aspect}>
                  {STUDIO_ASPECT_LABELS[aspect]}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </label>
        <span className="ml-auto font-mono text-2xs text-muted-foreground" data-studio-slide-count>
          {studioSlideCountLabel(draft.slides.length)}
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[200px_minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="flex flex-col gap-2" data-studio-slide-list>
          <div className="flex items-center justify-between">
            <span className="codeitlab-mono-label text-muted-foreground">SLIDES</span>
            <Button size="sm" variant="ghost" onClick={addSlide} aria-label="Add slide">
              <PlusIcon className="size-3.5" />
            </Button>
          </div>
          {draft.slides.map((slide, index) => (
            <div
              key={slide.id}
              className={cn(
                "flex items-center gap-1 rounded-lg border px-2 py-1.5",
                slide.id === selectedSlide?.id
                  ? "border-codeitlab-green/40 bg-codeitlab-green/8"
                  : "border-border/50",
              )}
              data-studio-slide={slide.id}
            >
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left text-xs text-foreground"
                onClick={() => setSelectedSlideId(slide.id)}
              >
                <span className="mr-1 font-mono text-2xs text-muted-foreground">{index + 1}</span>
                {slide.title.trim().length > 0 ? slide.title : "Untitled slide"}
              </button>
              <Button
                size="icon-micro"
                variant="ghost"
                onClick={() => moveSlide(index, -1)}
                aria-label={`Move slide ${index + 1} up`}
              >
                <ArrowUpIcon className="size-3" />
              </Button>
              <Button
                size="icon-micro"
                variant="ghost"
                onClick={() => moveSlide(index, 1)}
                aria-label={`Move slide ${index + 1} down`}
              >
                <ArrowDownIcon className="size-3" />
              </Button>
              <Button
                size="icon-micro"
                variant="ghost"
                onClick={() => removeSlide(slide.id)}
                aria-label={`Remove slide ${index + 1}`}
              >
                <Trash2Icon className="size-3" />
              </Button>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-3" data-studio-slide-form>
          {selectedSlide === null ? (
            <p className="text-sm text-muted-foreground">Select a slide to edit it.</p>
          ) : (
            <>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                Layout
                <Select
                  value={selectedSlide.layout}
                  onValueChange={(value) => {
                    if (
                      value === "title" ||
                      value === "bullets" ||
                      value === "quote" ||
                      value === "two-col" ||
                      value === "visual"
                    ) {
                      patchSlide(selectedSlide.id, { layout: value });
                    }
                  }}
                >
                  <SelectTrigger size="sm" className="w-44" aria-label="Slide layout">
                    <SelectValue>{STUDIO_LAYOUT_LABELS[selectedSlide.layout]}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup alignItemWithTrigger={false}>
                    {STUDIO_LAYOUTS.map((layout: StudioLayout) => (
                      <SelectItem key={layout} hideIndicator value={layout}>
                        {STUDIO_LAYOUT_LABELS[layout]}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Title
                <Input
                  size="sm"
                  value={selectedSlide.title}
                  onChange={(event) => patchSlide(selectedSlide.id, { title: event.target.value })}
                  aria-label="Slide title"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Body
                <Textarea
                  value={selectedSlide.body}
                  onChange={(event) => patchSlide(selectedSlide.id, { body: event.target.value })}
                  aria-label="Slide body"
                  rows={6}
                  placeholder={"Free text. Lines starting with - render as bullets."}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Notes
                <Textarea
                  value={selectedSlide.notes ?? ""}
                  onChange={(event) => patchSlide(selectedSlide.id, { notes: event.target.value })}
                  aria-label="Slide notes"
                  rows={2}
                  placeholder="Speaker notes (kept out of the slide)"
                />
              </label>
            </>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-2" data-studio-preview>
          <div className="flex items-center justify-between">
            <span className="codeitlab-mono-label text-muted-foreground">PREVIEW</span>
            <Button size="sm" variant="ghost" onClick={onPlay}>
              <PlayIcon className="size-3" />
              Play
            </Button>
          </div>
          <iframe
            title={`${draft.name} live preview`}
            srcDoc={previewHtml}
            sandbox="allow-scripts"
            className="aspect-video w-full rounded-lg border border-border/60 bg-black"
            data-studio-preview-frame
          />
          <p className="text-2xs text-muted-foreground">
            Rendered by the shared CodeitLab Studio renderer; the export writes the same HTML.
          </p>
        </div>
      </div>

      {exportResult === null ? null : (
        <Alert variant="success" data-studio-export-result>
          <AlertTitle>Exported</AlertTitle>
          <AlertDescription>
            <div className="flex flex-wrap items-center gap-2">
              <code className="break-all font-mono text-xs">{exportResult.path}</code>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard.writeText(exportResult.path).then(() => {
                    setCopied(true);
                    playCodeitlabSfx("click");
                  });
                }}
              >
                <CopyIcon className="size-3" />
                {copied ? "Copied" : "Copy path"}
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}
    </section>
  );
}
