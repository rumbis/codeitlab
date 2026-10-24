# The rename, and what deliberately keeps the old name

The rule is that the `t3` name should not appear in user-facing surfaces, and it
is replaced with `cil`. This page records what has moved, what has not, and why
the rest is staged rather than done in one sweep.

## Done

| Surface                  | Change                                                                                                                                                                                                                            |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project file             | `cil.json` is read first, `t3.json` is still read as a fallback, and `cil.json` wins when both exist (server loader and web hook).                                                                                                |
| macOS background service | launchd label is `com.cil.t3code.service`; the pre-rename `com.t3tools.t3code.service` is booted out as an optional install step and still counts as a live service for ownership, so an old install cannot be orphaned or raced. |
| Worktree branch prefix   | New temporary worktree branches are `cil/<8 hex>` (and `cil-<8 hex>` when a plain `cil` branch exists). Ref names written before the rename - `t3/…`, `t3-…`, `t3code/…` - are still recognised, so old worktrees keep working.   |
| Local state directory    | `~/.cil`, with a one-time move from `~/.t3`. A failed move keeps the old directory working and retries next launch.                                                                                                               |
| Panel and docs           | CodeItLab labels, panel sections, user docs and marketplace link.                                                                                                                                                                 |

## Deliberately not renamed yet

| Surface                               | Why it waits                                                                                                                                                                                                                                   |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@t3tools/*` package scope            | Every package, import and lockfile entry moves at once. Doing it without a fallback release leaves installed CLIs and the desktop app on an old scope.                                                                                         |
| Internal archive executable name `t3` | The updater verifies the pinned runtime by that name; renaming it needs a release that can still install the old one.                                                                                                                          |
| `app.t3.codes` URLs                   | They are real deployed origins used by auth return URLs and hosted defaults. Pointing them at a domain that does not exist yet would break sign-in, not rename it.                                                                             |
| `$HOME/.t3` inside WSL distros        | That directory lives on a machine this app does not own. The SSH remote scripts now pick `$HOME/.cil` and fall back to `$HOME/.t3` without moving anything; the WSL launcher still writes the old path and needs the same read-both treatment. |

## Rule for every future slice

1. Read both names; write the new one.
2. Never rewrite another harness's config, and never delete a legacy directory
   without a successful move.
3. A slice lands only when the old name still works for an existing install.

## Drift check

`apps/web/src/components/codeitlab/renameDrift.test.ts` walks `docs/user` and the
CodeItLab panels and fails on any `t3` word that is not one of the staged
technical ids above. When the rename moves forward, delete the matching entry
from its allowlist rather than editing the test's intent.
