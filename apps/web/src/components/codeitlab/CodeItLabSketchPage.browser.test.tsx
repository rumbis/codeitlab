import type { CodeItLabSketch } from "@codeitlab/core/sketch";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render as renderUi } from "../../../test/render";
import { CodeItLabSketchPage } from "./CodeItLabSketchPage";

const mock = vi.hoisted(() => ({
  sketch: { strokes: [] } as CodeItLabSketch,
  updates: [] as Array<{ sketch: CodeItLabSketch }>,
}));

vi.mock(import("../../codeitlab/effectsSettings"), async (original) => ({
  ...(await original()),
  useCodeItLabSettingsWriter: (() => ({
    codeitlab: { sketch: mock.sketch },
    environmentId: null,
    update: (patch: { sketch: CodeItLabSketch }) => {
      mock.updates.push(patch);
      mock.sketch = patch.sketch;
      return { sketch: mock.sketch };
    },
  })) as never,
}));

const buttonByText = (screen: { container: HTMLElement }, text: string) =>
  [...screen.container.querySelectorAll("button")].find((button) => button.textContent === text);

const canvasOf = (screen: { container: HTMLElement }) =>
  screen.container.querySelector('svg[aria-label^="Sketch canvas"]') as SVGSVGElement;

const drag = (svg: SVGSVGElement) => {
  const rect = svg.getBoundingClientRect();
  const dispatch = (type: string, x: number, y: number) => {
    svg.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        clientX: rect.left + x,
        clientY: rect.top + y,
        pointerId: 1,
      }),
    );
  };
  dispatch("pointerdown", 20, 20);
  dispatch("pointermove", 60, 50);
  dispatch("pointerup", 60, 50);
};

describe("sketch page", () => {
  it("explains the empty canvas and disables undo and clear", async () => {
    mock.sketch = { strokes: [] };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeItLabSketchPage />);
    expect(screen.getByText(/Nothing drawn yet/)).not.toBeNull();
    expect(buttonByText(screen, "Undo")?.disabled).toBe(true);
    expect(buttonByText(screen, "Clear")?.disabled).toBe(true);
  });

  it("lets the keyboard reach the canvas and hear the stroke count", async () => {
    mock.sketch = { strokes: [] };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeItLabSketchPage />);
    const canvas = canvasOf(screen);
    expect(canvas.getAttribute("tabindex")).toBe("0");
    canvas.focus();
    expect(document.activeElement).toBe(canvas);
    expect(canvas.getAttribute("aria-describedby")).toBe("sketch-state");
    const state = screen.container.querySelector("#sketch-state");
    expect(state?.getAttribute("aria-live")).toBe("polite");
    // The label is honest about the pointer requirement instead of implying keys draw.
    expect(canvas.getAttribute("aria-label")).toContain("Drawing needs a pointer");
    drag(canvas);
    await vi.waitFor(() => expect(state?.textContent).toContain("1 of 40 strokes"));
    expect(buttonByText(screen, "Undo")?.getAttribute("aria-describedby")).toBe("sketch-state");
  });

  it("draws a stroke, counts it and saves on release", async () => {
    mock.sketch = { strokes: [] };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeItLabSketchPage />);
    drag(canvasOf(screen));
    await vi.waitFor(() => expect(mock.updates.length).toBeGreaterThan(0));
    expect(mock.updates.at(-1)?.sketch.strokes).toHaveLength(1);
    expect(mock.updates.at(-1)?.sketch.strokes[0]?.points.length).toBeGreaterThan(1);
    expect(screen.getByText(/1 of 40 strokes/)).not.toBeNull();
  });

  it("switches colour and width, and clears a drawing", async () => {
    mock.sketch = { strokes: [] };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeItLabSketchPage />);
    await userEvent.click(screen.getByLabelText("Sketch colour #fbbf24"));
    await userEvent.click(screen.getByLabelText("Sketch width 8"));
    drag(canvasOf(screen));
    await vi.waitFor(() => expect(mock.updates.length).toBeGreaterThan(0));
    const clearButton = buttonByText(screen, "Clear");
    if (clearButton === undefined) throw new Error("Clear button missing");
    await userEvent.click(clearButton);
    await vi.waitFor(() => expect(mock.updates.at(-1)?.sketch.strokes).toHaveLength(0));
  });

  it("moves the width choice with the arrow keys", async () => {
    mock.sketch = { strokes: [] };
    await using screen = await renderUi(<CodeItLabSketchPage />);
    const four = screen.container.querySelector<HTMLButtonElement>('[aria-label="Sketch width 4"]');
    const eight = screen.container.querySelector<HTMLButtonElement>(
      '[aria-label="Sketch width 8"]',
    );
    expect(four?.tabIndex).toBe(0);
    expect(eight?.tabIndex).toBe(-1);
    four?.focus();
    await userEvent.keyboard("{ArrowRight}");
    await vi.waitFor(() => expect(document.activeElement).toBe(eight));
    expect(eight?.getAttribute("aria-pressed")).toBe("true");
    await userEvent.keyboard("{Home}");
    await vi.waitFor(() =>
      expect(document.activeElement?.getAttribute("aria-label")).toBe("Sketch width 2"),
    );
  });

  it("undoes a stroke from the keyboard", async () => {
    mock.sketch = { strokes: [] };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeItLabSketchPage />);
    drag(canvasOf(screen));
    await vi.waitFor(() => expect(mock.updates.length).toBeGreaterThan(0));
    const undo = buttonByText(screen, "Undo");
    expect(undo?.disabled).toBe(false);
    expect(undo?.type).toBe("button");
    undo?.focus();
    expect(document.activeElement).toBe(undo);
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(mock.updates.at(-1)?.sketch.strokes).toHaveLength(0));
    expect(screen.getByText(/Nothing drawn yet/)).not.toBeNull();
  });
});
