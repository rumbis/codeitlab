import {
  renderStudioHtml,
  type StudioProject,
  type StudioProjectInput,
} from "@codeitlab/core/studio";
import { useSyncExternalStore } from "react";

import { randomUUID } from "~/lib/utils";

/**
 * Local-first Studio store. Projects live in localStorage so the Studio tab is
 * usable before the server RPC lands (and on servers that do not expose it).
 *
 * Wiring point: when `codeitlab.studio.list/save/delete/export` are available in
 * the environment RPC group, the four functions below become thin wrappers over
 * the atom families in `../api.ts`; the hook shape and every call site stay the
 * same.
 */
const STORAGE_KEY = "codeitlab:studio:v1";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeSlide(value: unknown): StudioProject["slides"][number] | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || typeof value.title !== "string") return null;
  const layout = value.layout;
  return {
    id: value.id,
    layout:
      layout === "title" ||
      layout === "bullets" ||
      layout === "quote" ||
      layout === "two-col" ||
      layout === "visual"
        ? layout
        : "title",
    title: value.title,
    body: typeof value.body === "string" ? value.body : "",
    ...(typeof value.notes === "string" ? { notes: value.notes } : {}),
  };
}

function decodeProject(value: unknown): StudioProject | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || typeof value.name !== "string") return null;
  const kind = value.kind === "video" ? "video" : "deck";
  const theme =
    value.theme === "noir" || value.theme === "aurora" || value.theme === "matrix"
      ? value.theme
      : "matrix";
  const aspect = value.aspect === "9:16" || value.aspect === "1:1" ? value.aspect : "16:9";
  const slides = Array.isArray(value.slides)
    ? value.slides
        .map(decodeSlide)
        .filter((slide): slide is NonNullable<typeof slide> => slide !== null)
    : [];
  return {
    id: value.id,
    name: value.name,
    kind,
    theme,
    aspect,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date(0).toISOString(),
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date(0).toISOString(),
    slides: slides.length > 0 ? slides : [],
  };
}

function readStoredProjects(): StudioProject[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !Array.isArray(parsed.projects)) return [];
    return parsed.projects
      .map(decodeProject)
      .filter((project): project is StudioProject => project !== null)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  } catch {
    return [];
  }
}

let snapshot: StudioProject[] | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function persist(projects: ReadonlyArray<StudioProject>): void {
  snapshot = [...projects];
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ projects: snapshot }));
    } catch {
      // Private browsing or a full quota: the in-memory snapshot still works.
    }
  }
  emit();
}

export function getStudioProjectsSnapshot(): ReadonlyArray<StudioProject> {
  snapshot ??= readStoredProjects();
  return snapshot;
}

export function subscribeStudioProjects(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function sortProjects(projects: ReadonlyArray<StudioProject>): StudioProject[] {
  return [...projects].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

/** Reads the project list. Local for now; see the wiring point above. */
export async function listStudioProjects(): Promise<ReadonlyArray<StudioProject>> {
  snapshot = sortProjects(readStoredProjects());
  emit();
  return snapshot;
}

export async function saveStudioProject(input: StudioProjectInput): Promise<StudioProject> {
  const now = new Date().toISOString();
  const current = getStudioProjectsSnapshot();
  const existing =
    input.id === undefined ? undefined : current.find((project) => project.id === input.id);
  const project: StudioProject = {
    id: existing?.id ?? input.id ?? randomUUID(),
    name: input.name,
    kind: input.kind,
    theme: input.theme,
    aspect: input.aspect,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    slides: input.slides.map((slide) => ({ ...slide })),
  };
  persist(
    sortProjects(
      existing === undefined
        ? [project, ...current]
        : current.map((entry) => (entry.id === project.id ? project : entry)),
    ),
  );
  return project;
}

export async function deleteStudioProject(id: string): Promise<boolean> {
  const current = getStudioProjectsSnapshot();
  const next = current.filter((project) => project.id !== id);
  if (next.length === current.length) return false;
  persist(next);
  return true;
}

/**
 * Renders the authoritative HTML locally. The server export writes the same
 * bytes to disk; until that RPC lands we hand the file to the browser instead.
 */
export async function exportStudioProject(
  id: string,
): Promise<{ readonly path: string; readonly html: string }> {
  const project = getStudioProjectsSnapshot().find((entry) => entry.id === id);
  if (project === undefined) throw new Error("That Studio project no longer exists.");
  const html = renderStudioHtml(project);
  if (typeof window !== "undefined") {
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = `${project.name.replace(/[^a-z0-9-_]+/gi, "-").toLowerCase() || "studio"}.html`;
    anchor.click();
    URL.revokeObjectURL(url);
  }
  return { path: "Browser download (server export RPC not connected yet)", html };
}

export interface StudioStore {
  readonly projects: ReadonlyArray<StudioProject>;
  readonly source: "local" | "server";
  readonly error: string | null;
  readonly isLoading: boolean;
  readonly refresh: () => void;
  readonly save: (input: StudioProjectInput) => Promise<StudioProject>;
  readonly remove: (id: string) => Promise<boolean>;
  readonly exportProject: (id: string) => Promise<{ readonly path: string; readonly html: string }>;
}

export function useStudioStore(): StudioStore {
  const projects = useSyncExternalStore(
    subscribeStudioProjects,
    getStudioProjectsSnapshot,
    getStudioProjectsSnapshot,
  );
  return {
    projects,
    source: "local",
    error: null,
    isLoading: false,
    refresh: () => {
      void listStudioProjects();
    },
    save: saveStudioProject,
    remove: deleteStudioProject,
    exportProject: exportStudioProject,
  };
}
