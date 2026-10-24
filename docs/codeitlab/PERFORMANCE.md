# Performance baseline

Numbers, not adjectives. This page records what CodeitLab actually costs to
start and to sit idle, measured by a script in the repository, so any later
optimisation has a before and an after on the same machine.

Run it yourself:

```bash
node scripts/bench-startup.mjs            # server + web bundle, 3 runs
node scripts/bench-startup.mjs --json     # machine-readable
node scripts/bench-startup.mjs --desktop  # also the Electron shell (close the app first)
```

## What is measured

| Metric            | Definition                                                                                                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server ready`    | wall time from spawning `apps/server/dist/bin.mjs` (built bundle) to the first `200` from `GET /health` on a free loopback port, with a fresh `--base-dir` (so first-run migrations are included) |
| `server idle RSS` | resident set of that server process 1.5 s after it became healthy, read with `ps -o rss`                                                                                                          |
| `web bundle`      | every `.js`/`.css` in `apps/web/dist/assets`, raw and gzip -9                                                                                                                                     |
| `desktop ready`   | wall time from launching the built Electron entry to the main process logging `app ready`; needs the app closed because Electron focuses an existing instance instead of starting a second one    |

Each number is a median of three runs on the same machine. The script kills only
the child it spawned; it never touches another CodeitLab instance.

## Baseline — 2026-10-24

Machine: macOS 25.6.0 (Darwin), Apple Silicon `arm64`, Node v26.10.0. Server
bundle rebuilt immediately before the run (`vp run --filter t3 build:bundle`).

| Metric          | Value                                                                                                                                                                                                                |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server ready    | **1.20 s** (runs: 1.22 / 1.16 / 1.20 s)                                                                                                                                                                              |
| Server idle RSS | **402 MB** (runs: 408 / 399 / 402 MB)                                                                                                                                                                                |
| Web bundle      | **29.9 MiB raw**, **7.7 MiB gzip**                                                                                                                                                                                   |
| Desktop ready   | _not recorded yet_ — the desktop app was open during this run, so the second instance would have focused it instead of starting. Run `node scripts/bench-startup.mjs --desktop` on a quiet machine to fill this row. |

For reference, the competitor we benchmarked against (Panda Code) claims in its
video ~0.33 s window open and 130–160 MB idle against CodeitLab's ~3 s and
~700 MB. Those are its numbers on its machine; the table above is ours, measured
here. The gap is real: an Electron shell plus an always-on Node server is
heavier than a native webview with no server. Pretending otherwise would break
the honesty rule this documentation set runs on.

## What this baseline implies

- The server alone is ~400 MB idle, so "idle memory" is dominated by the server,
  not by the renderer. The biggest structural win is **not starting the server
  until the first turn needs it**; that is a Wave-2 change, not a rewrite.
- A 7.7 MiB gzip web bundle is the second lever: route-level lazy loading and
  trimming the always-loaded panels (CodeitLab settings, marketplace links,
  terminal) move first paint without touching the desktop architecture.
- Startup time (~1.2 s to a healthy server) is already in the range of the
  competitor's claim once the shell is warm; the memory is the honest gap.

| Board edit mirroring (3 tasks, move one card) | 3 `codeitlab.tasks.upsert` calls per edit | 1 call per edit — only tasks whose fields changed are sent | `apps/web/src/components/codeitlab/CodeitlabBoardPage.browser.test.tsx` ("mirrors only the task that changed") |

## Rules

1. No optimisation claim without a before/after row on this page.
2. Same machine, same Node, same bundle. If the machine changes, say so.
3. `--desktop` numbers are only comparable when the app was fully closed first.
4. A Tauri/native-webview port is a multi-month rewrite. It is a proposal with
   this baseline attached, not a task hidden inside an optimisation PR.
