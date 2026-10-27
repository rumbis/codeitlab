# Sketch

**Settings → CodeItLab → Sketch** is a rough drawing surface for prompting: sketch the layout
you mean, then describe it in the composer.

## What it does

- Drag on the canvas to draw; colour and width apply to the next stroke.
- **Undo** removes the newest stroke, **Clear** removes all of them.
- Strokes are normalised points saved with your settings, so the same drawing looks the same at
  any panel width.
- Limits are deliberate and visible: 40 strokes, 200 points per stroke. When you reach the cap,
  the newest stroke replaces the oldest instead of the drawing growing without bound.

## What it is not

There is no fill, text, layers, or export. A sketch is a prompt reference, not a design tool —
use [mood boards](./mood-boards.md) when you need images, colours and notes side by side.

## Keyboard

Tab reaches the colour and width swatches and the Undo/Clear buttons; Enter or
Space activates the focused one. Undo and Clear stay disabled until there is a
stroke, so the toolbar never offers an action that would do nothing.
