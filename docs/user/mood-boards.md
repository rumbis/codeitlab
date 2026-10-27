# Mood boards

Design intent usually lives in a few colours, two references and one rule you keep repeating.
**Settings → CodeItLab → Mood boards** keeps it where the agent can read it.

## What a board holds

- **Palette** — `#rgb` or `#rrggbb` colours, normalized to lowercase `#rrggbb`. Invalid input is
  rejected with a reason instead of silently dropped.
- **References** — a URL plus a caption saying what to take from it.
- **Notes** — short constraints, for example "no gradients" or "dense, not airy".

A board with no name or no content cannot be sent anywhere; the page says which part is missing.

## Using a board

- **Copy markdown** puts the palette, references and notes on the clipboard, ready for any tool.
- **Send to thread** opens a draft thread in your most recent project and puts a brief in the
  composer. The brief asks the agent to follow the palette and references, keep contrast
  readable, and say so when a reference cannot be fetched instead of inventing it.

Boards are settings, not canvas state: no binary blobs, and nothing to sync separately. They are
saved per environment with the rest of the CodeItLab panel.

## Keyboard

Tab reaches **New board** and the per-board actions; Enter or Space activates the
focused one. Adding a colour still needs a valid hex value, and the page says why
when it does not get one.
