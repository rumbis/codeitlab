# Studio — decks and video scenes

Studio is the "make something" surface: a local-first deck and video-scene builder inside
CodeitLab, inspired by the idea behind [nexu-io/open-design](https://github.com/nexu-io/open-design)
(a collaborative design-agent workspace) but written from scratch for this fork. No code,
assets, or copy from that repository is vendored — the only shared thing is the concept of a
workspace where an outline becomes a rendered, shareable artefact.

## What it does

- **Projects**: a project is a name, a kind (`deck` or `video`), a theme (`matrix`, `noir`,
  `aurora`), an aspect ratio (`16:9`, `9:16`, `1:1`) and an ordered list of slides.
- **Slides**: each slide has a layout (`title`, `bullets`, `quote`, `two-col`, `visual`), a
  title, free-text body (`- ` lines become bullets) and optional speaker notes.
- **Preview and export**: both come from one renderer, so what you see is exactly what you
  hand off. The export is a single self-contained HTML file — no network, no fonts to fetch,
  no build step. Arrow keys / space / click advance; `Escape` toggles the chrome; animations
  are transform-only and disabled under `prefers-reduced-motion`.
- **Starters**: a four-slide outline per kind, so an empty project is never an empty screen.

## Where things live

| Path                                             | Contents                                 |
| ------------------------------------------------ | ---------------------------------------- |
| `<stateDir>/codeitlab/studio/projects/<id>.json` | one file per project, atomically written |
| `<stateDir>/codeitlab/studio/exports/<id>.html`  | the last export of that project          |

`<stateDir>` is the app's own state directory (the CodeitLab home), never a user's harness
config. Project ids are folded to `[A-Za-z0-9_-]` before they become file names, so a hostile
id cannot escape the directory.

## RPC surface

| Method                    | Payload                          | Result                                                                   |
| ------------------------- | -------------------------------- | ------------------------------------------------------------------------ |
| `codeitlab.studio.list`   | `{}`                             | `{ projects }`                                                           |
| `codeitlab.studio.save`   | `{ project }`                    | the saved project (timestamps filled in)                                 |
| `codeitlab.studio.delete` | `{ id }`                         | `{ deleted }`                                                            |
| `codeitlab.studio.export` | `{ id }`                         | `{ path, html }`                                                         |
| `codeitlab.studio.render` | `{ id, fps?, secondsPerSlide? }` | `{ path, width, height, fps, durationSeconds, totalFrames, slideCount }` |

Reads are orchestration-read scoped; save/delete/render are settings-write scoped (they
change persisted state).

## Guarantees

- **Deterministic**: the same project renders byte-identical HTML. That is what makes the
  export diffable and the preview trustworthy.
- **Escaped**: every user-controlled string is HTML-escaped; the renderer never interpolates
  raw input into markup or script.
- **Tolerant**: an undecodable project file is skipped with a warning and never breaks the
  list. Export of a missing project fails with a `CodeitlabServiceError` instead of writing an
  empty file.

## Video from code

`codeitlab.studio.render` turns a `video` project into an MP4 on the server:

1. `studioRenderPlan` (in `@codeitlab/core/studio`) fixes the timeline — frame size from
   the aspect ratio (1920x1080, 1080x1920, 1080x1080), fps and seconds per slide, with
   hostile inputs clamped instead of trusted.
2. Every slide is rendered by the same stylesheet as the interactive deck, then
   screenshotted at full resolution by headless Chromium (`playwright-core`).
3. ffmpeg concatenates the frames at the planned frame rate (h264, yuv420p, faststart)
   and trims to the exact planned duration.

The Studio editor exposes this as **Render video** on video projects: it saves the draft to the
server first (so the server renders the current draft, not a stale copy), then reports the path,
resolution, duration and frame count. When no server is connected the button explains that
instead of failing silently.

The output lands in `<stateDir>/codeitlab/studio/exports/<id>.mp4`. Frames are
deterministic: rendering the same project twice produces byte-identical PNGs (verified in
`renderVideo.test.ts`), so a video is reproducible from source.

The render browser is deliberately narrow: **JavaScript is disabled** and every
network request is routed to a closed local port (loopback included, since Chromium
otherwise bypasses the proxy for it), so a project cannot fetch remote assets, phone
home, or probe the local network while it renders. A slide is escaped static HTML, and
`studioBrowserLaunchOptions` keeps that policy in one place; the test asserts that an
`<img>` pointing at a local server produces zero requests and an inline `<script>` never
runs. `CODEITLAB_STUDIO_CHROME`
and `CODEITLAB_STUDIO_FFMPEG` point the renderer at specific binaries; without them it uses
the Playwright Chromium and `ffmpeg` on `PATH` and fails with an actionable error if a
binary is missing rather than writing a broken file.

## Not shipped yet

- **Agent-generated outlines**. The next step is a "draft from a brief" action that asks the
  routed provider (see `MEMORY-REA-ROUTING.md`) for an outline and imports it as a project.
  That needs a text-generation operation on the provider interface, which is a cross-provider
  change, so it is deliberately out of this slice.
- **Collaboration**. Projects are per environment; there is no share link or multiplayer.
