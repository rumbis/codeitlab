import {
  studioStarterSlides,
  type StudioAspect,
  type StudioKind,
  type StudioLayout,
  type StudioProjectInput,
  type StudioSlide,
  type StudioTheme,
} from "@codeitlab/core/studio";

import { randomUUID } from "~/lib/utils";

export const STUDIO_THEME_LABELS: Readonly<Record<StudioTheme, string>> = {
  matrix: "Matrix",
  noir: "Noir",
  aurora: "Aurora",
};

export const STUDIO_ASPECT_LABELS: Readonly<Record<StudioAspect, string>> = {
  "16:9": "16:9 · widescreen",
  "9:16": "9:16 · vertical",
  "1:1": "1:1 · square",
};

export const STUDIO_LAYOUT_LABELS: Readonly<Record<StudioLayout, string>> = {
  title: "Title",
  bullets: "Bullets",
  quote: "Quote",
  "two-col": "Two columns",
  visual: "Visual",
};

export const STUDIO_KIND_LABELS: Readonly<Record<StudioKind, string>> = {
  deck: "Deck",
  video: "Video",
};

export const STUDIO_THEMES: ReadonlyArray<StudioTheme> = ["matrix", "noir", "aurora"];
export const STUDIO_ASPECTS: ReadonlyArray<StudioAspect> = ["16:9", "9:16", "1:1"];
export const STUDIO_LAYOUTS: ReadonlyArray<StudioLayout> = [
  "title",
  "bullets",
  "quote",
  "two-col",
  "visual",
];

export function studioSlideId(): string {
  return `slide-${randomUUID()}`;
}

/**
 * Seeds a new project with the shared starter outline. The server applies the
 * same seed when it creates a project without slides, so a locally seeded
 * project and a server-seeded one stay comparable.
 */
export function createStudioProjectInput(options: {
  readonly kind: StudioKind;
  readonly name?: string | undefined;
  readonly theme?: StudioTheme | undefined;
  readonly aspect?: StudioAspect | undefined;
}): StudioProjectInput {
  return {
    name: options.name ?? (options.kind === "video" ? "Untitled video" : "Untitled deck"),
    kind: options.kind,
    theme: options.theme ?? "matrix",
    aspect: options.aspect ?? "16:9",
    slides: studioStarterSlides(options.kind).map((slide) => ({ ...slide })),
  };
}

/** Moves a slide by `delta` positions, clamping at the ends. */
export function moveStudioSlide(
  slides: ReadonlyArray<StudioSlide>,
  index: number,
  delta: number,
): ReadonlyArray<StudioSlide> {
  const target = index + delta;
  if (index < 0 || index >= slides.length || target < 0 || target >= slides.length) {
    return slides;
  }
  const next = [...slides];
  const [moved] = next.splice(index, 1);
  if (moved === undefined) return slides;
  next.splice(target, 0, moved);
  return next;
}

export function addStudioSlide(
  slides: ReadonlyArray<StudioSlide>,
  slide: StudioSlide,
): ReadonlyArray<StudioSlide> {
  return [...slides, slide];
}

export function removeStudioSlide(
  slides: ReadonlyArray<StudioSlide>,
  slideId: string,
): ReadonlyArray<StudioSlide> {
  if (slides.length <= 1) return slides;
  return slides.filter((slide) => slide.id !== slideId);
}

export function updateStudioSlide(
  slides: ReadonlyArray<StudioSlide>,
  slideId: string,
  patch: Partial<Omit<StudioSlide, "id">>,
): ReadonlyArray<StudioSlide> {
  return slides.map((slide) => (slide.id === slideId ? { ...slide, ...patch } : slide));
}

export function emptyStudioSlide(): StudioSlide {
  return { id: studioSlideId(), layout: "bullets", title: "New slide", body: "- " };
}

export function studioSlideCountLabel(count: number): string {
  return `${count} slide${count === 1 ? "" : "s"}`;
}
