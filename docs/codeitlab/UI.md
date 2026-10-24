# CodeitLab UI quality bar

Every CodeitLab surface — panel pages, marketplace pages, the overlay launcher,
and anything added later — is held to this bar. It is a checklist for the agent
writing the feature, not a design brief for a separate team.

## The feeling

Calm, fast, and legible. The panel is a control room, not a landing page: one
idea per screen, real numbers over decoration, and motion only where it explains
a state change. When in doubt, remove an animation instead of speeding it up.

## Rules

1. **Motion budget.** One entrance per page change, 120–200 ms, opacity plus at
   most 4 px of translate. No continuously repainting animation, no parallax on
   scroll, no hover effect that changes layout. A frame dropped on a high-refresh
   display is a bug.
2. **Reduced motion is a feature, not a fallback.** Every animation and
   transition gets a `prefers-reduced-motion: reduce` branch that removes it.
   `codeitlab-page-enter` and the studio tilt already do this; follow the same
   pattern.
3. **Keyboard first.** Anything clickable is reachable by Tab, has a visible
   `focus-visible` ring, and Enter/Space does the obvious thing. Groups of
   links behave as one tab stop with arrow keys (see `CodeitlabSectionNav`).
   Escape closes overlays and dialogs.
4. **Honest states.** Loading shows a skeleton that matches the final layout
   (never a spinner that lies about progress). Empty shows what to do next, not
   just "nothing here". Errors say what failed and what still works.
5. **Numbers are tabular.** Metrics, timers, and counts use `tabular-nums` so
   they do not jitter as values change.
6. **No layout shift.** Reserve space for async content; a badge appearing must
   not move the row it lives in.
7. **Contrast over phosphor.** The green/cyan accents are for state and
   identity. Body text uses `foreground`/`muted-foreground` tokens; never put
   accent text on accent backgrounds at small sizes.
8. **SFX is opt-in and short.** Clicks use the existing `playCodeitlabSfx`
   path, respect the persisted volume/mute, and never fire on hover or on
   timers. Silence is the default state.
9. **Sticky, not fixed.** Section navigation sticks inside its scroll container
   so it cannot cover the app chrome or the marketplace header.
10. **Docs for behaviour, not pixels.** A new control does not need a page; a
    new workflow needs a paragraph in `docs/user/` or the feature guide.

## Verifying UI work

- Unit-test the logic (roving focus math, formatting, state transitions).
- Browser-test the interaction: `vp test run --project browser <path>` from
  `apps/web`. Assert what a user observes (focused element, visible label,
  disabled state), not class strings.
- Typecheck and lint the touched files only. Do not run repo-wide checks.
- For a user-visible change, walk the four surfaces: chat, settings panel,
  command palette, and the desktop shell. A panel-only fix is not a fix.

## How the budget is checked

`apps/web/src/codeitlab/motionBudget.test.ts` reads `index.css` and fails if the
panel entrance leaves the 120–200 ms window or if the reduced-motion branch for
the entrance or the sheet primitive is removed. Primitives that animate through
Tailwind utilities get their branch in the stylesheet, because the utilities
cannot carry a media query of their own.
