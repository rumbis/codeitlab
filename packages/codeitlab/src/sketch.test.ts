import { describe, expect, it } from "vite-plus/test";

import {
  EMPTY_SKETCH,
  SKETCH_MAX_POINTS_PER_STROKE,
  SKETCH_MAX_STROKES,
  SKETCH_MAX_WIDTH,
  SKETCH_MIN_WIDTH,
  clearSketch,
  extendSketchStroke,
  sketchPath,
  sketchPoint,
  sketchStrokeWidth,
  startSketchStroke,
  undoSketchStroke,
} from "./sketch.ts";

const point = (x: number, y: number) => sketchPoint(x, y);

describe("sketch", () => {
  it("clamps points into the surface", () => {
    expect(point(-1, 2)).toEqual({ x: 0, y: 1 });
    expect(point(Number.NaN, 0.5)).toEqual({ x: 0, y: 0.5 });
  });

  it("clamps stroke width into the supported range", () => {
    expect(sketchStrokeWidth(0)).toBe(SKETCH_MIN_WIDTH);
    expect(sketchStrokeWidth(99)).toBe(SKETCH_MAX_WIDTH);
    expect(sketchStrokeWidth(4.4)).toBe(4);
  });

  it("adds points to the newest stroke only", () => {
    const started = startSketchStroke(EMPTY_SKETCH, "#fff", 4, point(0.1, 0.1));
    const extended = extendSketchStroke(started, point(0.2, 0.3));
    expect(extended.strokes).toHaveLength(1);
    expect(extended.strokes[0]?.points).toHaveLength(2);
    expect(extendSketchStroke(EMPTY_SKETCH, point(0.2, 0.3))).toEqual(EMPTY_SKETCH);
  });

  it("caps strokes and points instead of growing forever", () => {
    let sketch = EMPTY_SKETCH;
    for (let index = 0; index < SKETCH_MAX_STROKES + 5; index += 1) {
      sketch = startSketchStroke(sketch, "#fff", 4, point(0.5, 0.5));
    }
    expect(sketch.strokes).toHaveLength(SKETCH_MAX_STROKES);
    for (let index = 0; index < SKETCH_MAX_POINTS_PER_STROKE + 5; index += 1) {
      sketch = extendSketchStroke(sketch, point(0.6, 0.6));
    }
    expect(sketch.strokes.at(-1)?.points).toHaveLength(SKETCH_MAX_POINTS_PER_STROKE);
  });

  it("undoes one stroke and clears everything", () => {
    const one = startSketchStroke(EMPTY_SKETCH, "#fff", 4, point(0.5, 0.5));
    const two = startSketchStroke(one, "#fff", 4, point(0.2, 0.2));
    expect(undoSketchStroke(two).strokes).toHaveLength(1);
    expect(undoSketchStroke(EMPTY_SKETCH)).toEqual(EMPTY_SKETCH);
    expect(clearSketch()).toEqual(EMPTY_SKETCH);
  });

  it("builds an SVG path in the fixed view box", () => {
    expect(sketchPath([point(0, 0), point(0.5, 1)])).toBe("M0.0 0.0 L500.0 700.0");
    expect(sketchPath([])).toBe("");
  });
});
