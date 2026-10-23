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

| Method                    | Payload       | Result                                   |
| ------------------------- | ------------- | ---------------------------------------- |
| `codeitlab.studio.list`   | `{}`          | `{ projects }`                           |
| `codeitlab.studio.save`   | `{ project }` | the saved project (timestamps filled in) |
| `codeitlab.studio.delete` | `{ id }`      | `{ deleted }`                            |
| `codeitlab.studio.export` | `{ id }`      | `{ path, html }`                         |

Reads are orchestration-read scoped; save/delete are settings-write scoped (they change
persisted state).

## Guarantees

- **Deterministic**: the same project renders byte-identical HTML. That is what makes the
  export diffable and the preview trustworthy.
- **Escaped**: every user-controlled string is HTML-escaped; the renderer never interpolates
  raw input into markup or script.
- **Tolerant**: an undecodable project file is skipped with a warning and never breaks the
  list. Export of a missing project fails with a `CodeitlabServiceError` instead of writing an
  empty file.

## Not shipped yet

- **Agent-generated outlines**. The next step is a "draft from a brief" action that asks the
  routed provider (see `MEMORY-REA-ROUTING.md`) for an outline and imports it as a project.
  That needs a text-generation operation on the provider interface, which is a cross-provider
  change, so it is deliberately out of this slice.
- **Real video rendering**. `video` projects are scene lists with the same player as decks;
  exporting to MP4 would need a renderer (e.g. a headless composition pass) that is not in
  this build.
- **Collaboration**. Projects are per environment; there is no share link or multiplayer.
