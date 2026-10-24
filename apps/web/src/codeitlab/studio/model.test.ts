import { describe, expect, it } from "vite-plus/test";

import {
  addStudioSlide,
  createStudioProjectInput,
  moveStudioSlide,
  removeStudioSlide,
  STUDIO_ASPECT_LABELS,
  STUDIO_THEME_LABELS,
  studioSlideCountLabel,
  updateStudioSlide,
} from "./model";
import type { StudioSlide } from "@codeitlab/core/studio";

const slides: ReadonlyArray<StudioSlide> = [
  { id: "a", layout: "title", title: "A", body: "" },
  { id: "b", layout: "bullets", title: "B", body: "- one" },
  { id: "c", layout: "quote", title: "C", body: "quote" },
];

describe("studio model", () => {
  it("seeds four starter slides for both kinds", () => {
    const deck = createStudioProjectInput({ kind: "deck" });
    const video = createStudioProjectInput({ kind: "video" });

    expect(deck.slides).toHaveLength(4);
    expect(video.slides).toHaveLength(4);
    expect(deck.theme).toBe("matrix");
    expect(deck.aspect).toBe("16:9");
    expect(deck.name).toBe("Untitled deck");
    expect(video.name).toBe("Untitled video");
    expect(new Set(deck.slides.map((slide) => slide.id)).size).toBe(4);
  });

  it("moves slides and clamps at the edges", () => {
    const moved = moveStudioSlide(slides, 0, 1);
    expect(moved.map((slide) => slide.id)).toEqual(["b", "a", "c"]);

    const clampedLow = moveStudioSlide(slides, 0, -1);
    const clampedHigh = moveStudioSlide(slides, 2, 1);
    expect(clampedLow.map((slide) => slide.id)).toEqual(["a", "b", "c"]);
    expect(clampedHigh.map((slide) => slide.id)).toEqual(["a", "b", "c"]);
    expect(moveStudioSlide(slides, 9, 1)).toBe(slides);
  });

  it("adds, updates, and removes slides", () => {
    const added = addStudioSlide(slides, { id: "d", layout: "visual", title: "D", body: "" });
    expect(added.map((slide) => slide.id)).toEqual(["a", "b", "c", "d"]);

    const updated = updateStudioSlide(added, "b", { title: "B2", notes: "speaker note" });
    expect(updated.find((slide) => slide.id === "b")).toMatchObject({
      title: "B2",
      notes: "speaker note",
    });

    expect(removeStudioSlide(added, "c").map((slide) => slide.id)).toEqual(["a", "b", "d"]);
  });

  it("keeps at least one slide", () => {
    const single = [slides[0]!];
    expect(removeStudioSlide(single, "a")).toBe(single);
  });

  it("maps themes, aspects, and slide counts to labels", () => {
    expect(STUDIO_THEME_LABELS.matrix).toBe("Matrix");
    expect(STUDIO_ASPECT_LABELS["9:16"]).toBe("9:16 · vertical");
    expect(studioSlideCountLabel(1)).toBe("1 slide");
    expect(studioSlideCountLabel(3)).toBe("3 slides");
  });
});
