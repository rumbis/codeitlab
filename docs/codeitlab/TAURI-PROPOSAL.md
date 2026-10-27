# Tauri proposal (not a migration)

This page is a decision document, not a plan that is being executed. It follows the
rule in [PERFORMANCE.md](./PERFORMANCE.md): a native-webview port is a proposal with
the measured baseline attached, never a task hidden inside an optimisation change.

## The baseline it argues from

| Measure                   | Value                                      | Source                                             |
| ------------------------- | ------------------------------------------ | -------------------------------------------------- |
| Server idle RSS           | **402 MB** (408 / 399 / 402)               | `node scripts/bench-startup.mjs`, `PERFORMANCE.md` |
| Web bundle                | **29.9 MiB raw**, **7.7 MiB gzip**         | same run                                           |
| Startup to healthy server | **~1.2 s** (warm shell)                    | same run                                           |
| Desktop ready             | not recorded (app was open during the run) | `PERFORMANCE.md`                                   |

The honest reading of that table: the renderer is **not** the memory problem. A
native webview would not remove the 402 MB server, and the web bundle would still be
parsed by a webview engine. Tauri would change how the window is hosted, not what the
app does.

## What a port would change

- Window hosting: WebView2 / WKWebView instead of a bundled Chromium. Installer and
  update size drop substantially; cold start of the shell gets faster.
- Process model: one fewer Chromium process tree, so idle memory improves — but the
  server keeps running, so the headline number stays in the hundreds of MB until the
  server is started lazily (that is a separate, already-planned change).
- Packaging: `dmg`/`msi`/`AppImage` via Tauri's bundler, a different updater and a
  different code-signing story.

## What it would break or cost

- **Electron APIs in use**: IPC, `webview` tags, native menus, tray, global shortcuts,
  auto-update, file dialogs, `shell.openExternal`, and the app's own preload bridge all
  have to be reimplemented or replaced. Each is a real feature, not a mechanical port.
- **Rust toolchain** becomes a build requirement for every contributor and for CI.
- **Mobile/desktop parity**: the repo also ships a React Native client that talks to
  the same server; a desktop rewrite does not simplify that.
- **Updater and release channels** change, which needs a fallback release before the
  old channel is retired — the same reasoning that keeps the archive rename staged.

## Decision

Not now. The measured gap that matters first is the server's idle footprint and the
always-loaded bundle; both are addressable inside the current architecture, and the
second one already has a route-level lazy-loading plan in `PERFORMANCE.md`. Revisit
this page after:

1. the server starts lazily (first turn, not first paint), and
2. the web bundle's always-loaded share is measured after route-level lazy loading.

If those two move the numbers close to the competitor's claim, the Tauri port loses
most of its remaining justification and stays a proposal. If they do not, this page
becomes the cost estimate for the port, with the same baseline attached.
