import type { CodeitlabSketch } from "@codeitlab/core/sketch";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render as renderUi } from "../../../test/render";
import { CodeitlabSketchPage } from "./CodeitlabSketchPage";

const mock = vi.hoisted(() => ({
  sketch: { strokes: [] } as CodeitlabSketch,
  updates: [] as Array<{ sketch: CodeitlabSketch }>,
}));

vi.mock(import("../../codeitlab/effectsSettings"), async (original) => ({
  ...(await original()),
  useCodeitlabSettingsWriter: (() => ({
    codeitlab: { sketch: mock.sketch },
    environmentId: null,
    update: (patch: { sketch: CodeitlabSketch }) => {
      mock.updates.push(patch);
      mock.sketch = patch.sketch;
      return { sketch: mock.sketch };
    },
  })) as never,
}));

const buttonByText = (screen: { container: HTMLElement }, text: string) =>
  [...screen.container.querySelectorAll("button")].find((button) => button.textContent === text);

const canvasOf = (screen: { container: HTMLElement }) =>
  screen.container.querySelector('svg[aria-label="Sketch canvas"]') as SVGSVGElement;

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
    await using screen = await renderUi(<CodeitlabSketchPage />);
    expect(screen.getByText(/Nothing drawn yet/)).not.toBeNull();
    expect(buttonByText(screen, "Undo")?.disabled).toBe(true);
    expect(buttonByText(screen, "Clear")?.disabled).toBe(true);
  });

  it("draws a stroke, counts it and saves on release", async () => {
    mock.sketch = { strokes: [] };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeitlabSketchPage />);
    drag(canvasOf(screen));
    await vi.waitFor(() => expect(mock.updates.length).toBeGreaterThan(0));
    expect(mock.updates.at(-1)?.sketch.strokes).toHaveLength(1);
    expect(mock.updates.at(-1)?.sketch.strokes[0]?.points.length).toBeGreaterThan(1);
    expect(screen.getByText(/1 of 40 strokes/)).not.toBeNull();
  });

  it("switches colour and width, and clears a drawing", async () => {
    mock.sketch = { strokes: [] };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeitlabSketchPage />);
    await userEvent.click(screen.getByLabelText("Sketch colour #fbbf24"));
    await userEvent.click(screen.getByLabelText("Sketch width 8"));
    drag(canvasOf(screen));
    await vi.waitFor(() => expect(mock.updates.length).toBeGreaterThan(0));
    const clearButton = buttonByText(screen, "Clear");
    if (clearButton === undefined) throw new Error("Clear button missing");
    await userEvent.click(clearButton);
    await vi.waitFor(() => expect(mock.updates.at(-1)?.sketch.strokes).toHaveLength(0));
  });

  it("undoes a stroke from the keyboard", async () => {
    mock.sketch = { strokes: [] };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeitlabSketchPage />);
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
