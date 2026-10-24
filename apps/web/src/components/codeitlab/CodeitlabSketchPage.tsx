import { useRef, useState } from "react";
import {
  EMPTY_SKETCH,
  SKETCH_MAX_STROKES,
  clearSketch,
  extendSketchStroke,
  sketchPath,
  sketchPoint,
  startSketchStroke,
  undoSketchStroke,
  type CodeitlabSketch,
} from "@codeitlab/core/sketch";

import { useCodeitlabSettingsWriter } from "../../codeitlab/effectsSettings";
import { Button } from "../ui/button";
import { CodeitlabCard, CodeitlabSectionHeading } from "./CodeitlabPrimitives";

const COLORS = ["#f5f5f5", "#7dd3fc", "#fbbf24", "#f472b6"] as const;
const WIDTHS = [2, 4, 8] as const;

const VIEW_WIDTH = 1000;
const VIEW_HEIGHT = 700;

/**
 * Rough sketch surface. Strokes are normalised points, so the drawing survives
 * any panel width; there is no fill, text or layers, because this is a prompt
 * reference rather than a design tool.
 */
export function CodeitlabSketchPage() {
  const { codeitlab, update } = useCodeitlabSettingsWriter();
  // A stroke is drawn locally while the pointer is down and persisted on release,
  // so a fast drag never loses points to a stale settings snapshot.
  const [local, setLocal] = useState<CodeitlabSketch | null>(null);
  const sketch: CodeitlabSketch = local ?? codeitlab.sketch ?? EMPTY_SKETCH;
  const [color, setColor] = useState<string>(COLORS[0]);
  const [width, setWidth] = useState<number>(WIDTHS[1]);
  const drawing = useRef(false);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const persist = (next: CodeitlabSketch) => {
    setLocal(next);
    update({ sketch: next });
  };

  const pointFromEvent = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return sketchPoint(
      (event.clientX - rect.left) / rect.width,
      (event.clientY - rect.top) / rect.height,
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <CodeitlabSectionHeading
        description="Draw a rough sketch to attach to a prompt. Strokes are capped and saved with your settings; there is no fill, text or layers — this is a reference, not a design tool."
        eyebrow="CodeItLab // sketch"
        title="Sketch"
      />

      <CodeitlabCard className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-2xs text-muted-foreground">Colour</span>
          {COLORS.map((entry) => (
            <Button
              type="button"
              aria-label={`Sketch colour ${entry}`}
              aria-pressed={color === entry}
              key={entry}
              onClick={() => setColor(entry)}
              size="icon-sm"
              variant={color === entry ? "default" : "outline"}
            >
              <span
                aria-hidden
                className="size-3 rounded-full border border-border/60"
                style={{ backgroundColor: entry }}
              />
            </Button>
          ))}
          <span className="ms-2 text-2xs text-muted-foreground">Width</span>
          {WIDTHS.map((entry) => (
            <Button
              type="button"
              aria-label={`Sketch width ${entry}`}
              aria-pressed={width === entry}
              key={entry}
              onClick={() => setWidth(entry)}
              size="sm"
              variant={width === entry ? "default" : "outline"}
            >
              {entry}px
            </Button>
          ))}
          <div className="ms-auto flex items-center gap-2">
            <Button
              type="button"
              disabled={sketch.strokes.length === 0}
              onClick={() => persist(undoSketchStroke(sketch))}
              size="sm"
              variant="outline"
            >
              Undo
            </Button>
            <Button
              type="button"
              disabled={sketch.strokes.length === 0}
              onClick={() => persist(clearSketch())}
              size="sm"
              variant="outline"
            >
              Clear
            </Button>
          </div>
        </div>

        <svg
          aria-label="Sketch canvas"
          className="w-full touch-none rounded-md border border-border/60 bg-background"
          onPointerDown={(event) => {
            const point = pointFromEvent(event);
            if (point === null) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            drawing.current = true;
            setLocal(startSketchStroke(sketch, color, width, point));
          }}
          onPointerMove={(event) => {
            if (!drawing.current) return;
            const point = pointFromEvent(event);
            if (point === null) return;
            setLocal((current) => extendSketchStroke(current ?? sketch, point));
          }}
          onPointerUp={() => {
            drawing.current = false;
            setLocal((current) => {
              if (current !== null) update({ sketch: current });
              return current;
            });
          }}
          onPointerCancel={() => {
            drawing.current = false;
            setLocal((current) => {
              if (current !== null) update({ sketch: current });
              return current;
            });
          }}
          ref={svgRef}
          role="img"
          viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        >
          <rect fill="transparent" height={VIEW_HEIGHT} width={VIEW_WIDTH} />
          {sketch.strokes.map((stroke) => (
            <path
              d={sketchPath(stroke.points)}
              fill="none"
              key={`${stroke.color}-${stroke.width}-${sketchPath(stroke.points)}`}
              stroke={stroke.color}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={stroke.width}
            />
          ))}
        </svg>

        <p className="text-2xs text-muted-foreground">
          {sketch.strokes.length === 0
            ? "Nothing drawn yet. Drag on the canvas to start; Undo and Clear stay disabled until there is a stroke."
            : `${sketch.strokes.length} of ${SKETCH_MAX_STROKES} strokes · drag to add another`}
        </p>
      </CodeitlabCard>
    </div>
  );
}
