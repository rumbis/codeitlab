import { describe, expect, it } from "vite-plus/test";

import { nextSectionIndex } from "./sectionNav";

describe("section nav roving focus", () => {
  it("moves right and left with wrap-around", () => {
    expect(nextSectionIndex(0, "ArrowRight", 4)).toBe(1);
    expect(nextSectionIndex(3, "ArrowRight", 4)).toBe(0);
    expect(nextSectionIndex(0, "ArrowLeft", 4)).toBe(3);
    expect(nextSectionIndex(2, "ArrowLeft", 4)).toBe(1);
  });

  it("jumps to the ends with Home and End", () => {
    expect(nextSectionIndex(2, "Home", 4)).toBe(0);
    expect(nextSectionIndex(1, "End", 4)).toBe(3);
  });

  it("ignores keys that are not navigation keys", () => {
    expect(nextSectionIndex(1, "Enter", 4)).toBeNull();
    expect(nextSectionIndex(1, "Tab", 4)).toBeNull();
    expect(nextSectionIndex(1, "a", 4)).toBeNull();
  });

  it("returns null for an empty section list instead of dividing by zero", () => {
    expect(nextSectionIndex(0, "ArrowRight", 0)).toBeNull();
  });
});
