import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/**
 * Rough sketches kept as normalised strokes (0–1 in both axes), so the same
 * drawing survives any surface size. This is a prompt reference, not a design
 * tool: strokes are capped and there is no fill, text or layers.
 */
export const SKETCH_MAX_STROKES = 40;
export const SKETCH_MAX_POINTS_PER_STROKE = 200;
export const SKETCH_MIN_WIDTH = 2;
export const SKETCH_MAX_WIDTH = 12;

export interface CodeitlabSketchPoint {
  readonly x: number;
  readonly y: number;
}

export interface CodeitlabSketchStroke {
  readonly color: string;
  readonly width: number;
  readonly points: ReadonlyArray<CodeitlabSketchPoint>;
}

export interface CodeitlabSketch {
  readonly strokes: ReadonlyArray<CodeitlabSketchStroke>;
}

export const EMPTY_SKETCH: CodeitlabSketch = { strokes: [] };

const clamp01 = (value: number): number =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;

export function sketchPoint(x: number, y: number): CodeitlabSketchPoint {
  return { x: clamp01(x), y: clamp01(y) };
}

export function sketchStrokeWidth(width: number): number {
  if (!Number.isFinite(width)) return SKETCH_MIN_WIDTH;
  return Math.min(SKETCH_MAX_WIDTH, Math.max(SKETCH_MIN_WIDTH, Math.round(width)));
}

export function startSketchStroke(
  sketch: CodeitlabSketch,
  color: string,
  width: number,
  point: CodeitlabSketchPoint,
): CodeitlabSketch {
  const strokes = sketch.strokes.slice(-(SKETCH_MAX_STROKES - 1));
  return {
    strokes: [
      ...strokes,
      { color, width: sketchStrokeWidth(width), points: [sketchPoint(point.x, point.y)] },
    ],
  };
}

export function extendSketchStroke(
  sketch: CodeitlabSketch,
  point: CodeitlabSketchPoint,
): CodeitlabSketch {
  const last = sketch.strokes.at(-1);
  if (last === undefined) return sketch;
  if (last.points.length >= SKETCH_MAX_POINTS_PER_STROKE) return sketch;
  return {
    strokes: [
      ...sketch.strokes.slice(0, -1),
      { ...last, points: [...last.points, sketchPoint(point.x, point.y)] },
    ],
  };
}

export function undoSketchStroke(sketch: CodeitlabSketch): CodeitlabSketch {
  return { strokes: sketch.strokes.slice(0, -1) };
}

export function clearSketch(): CodeitlabSketch {
  return EMPTY_SKETCH;
}

/** SVG path in a 1000×700 view box, so the page can render without a canvas. */
export function sketchPath(points: ReadonlyArray<CodeitlabSketchPoint>): string {
  return points
    .map((point, index) => {
      const x = (point.x * 1000).toFixed(1);
      const y = (point.y * 700).toFixed(1);
      return `${index === 0 ? "M" : "L"}${x} ${y}`;
    })
    .join(" ");
}

const SketchPointSchema = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
});
const SketchStrokeSchema = Schema.Struct({
  color: Schema.String,
  width: Schema.Number,
  points: Schema.Array(SketchPointSchema),
});
const SketchSchema = Schema.Struct({
  strokes: Schema.Array(SketchStrokeSchema),
});

/** Settings block; strokes are bounded so the settings row stays small. */
export const CodeitlabSketchSettings = SketchSchema.pipe(
  Schema.withDecodingDefault(Effect.succeed(EMPTY_SKETCH)),
);
export type CodeitlabSketchSettings = typeof CodeitlabSketchSettings.Type;
