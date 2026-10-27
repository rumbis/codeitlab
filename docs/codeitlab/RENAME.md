# Naming: `CodeItLab`, `cil`, and `codeitlab`

`CodeItLab` is the product name users see. Two lowercase ids sit beside it, and every
surface picks exactly one:

- `cil` is the short id: namespaces CodeItLab owns, and filesystem or URL tokens that
  read better short (`~/.cil`, `cil.json`, `CIL_*`, `refs/cil/**`).
- `codeitlab` is the spelled-out id: identifiers published to, or shared with, other
  tools (npm package, release assets, binary name, bundle id, launchd label).

| Surface                                                                 | Token                                               |
| ----------------------------------------------------------------------- | --------------------------------------------------- |
| Product name, UI copy, user docs                                        | `CodeItLab`                                         |
| Package scope                                                           | `@codeitlab/*`                                      |
| npm package, CLI binary (`cil` symlink), release archives, npm launcher | `codeitlab`                                         |
| State directory                                                         | `~/.cil` (`CIL_HOME`)                               |
| Project file                                                            | `cil.json`                                          |
| Deep links                                                              | `cil-context://`, `cil-thread://`                   |
| Environment variables                                                   | `CIL_*` runtime config, `CODEITLAB_*` feature knobs |
| Git refs, temporary worktree branches                                   | `refs/cil/**`, `cil/<8 hex>`                        |
| Bundle id, macOS launchd label                                          | `app.codeitlab`, `com.cil.codeitlab.service`        |
| Packaged CLI executable, Windows                                        | `codeitlab`, `cil.exe` on Windows                   |
| Repo-committed tool config                                              | `.codeitlab/vcs.json`                               |

Hosted origins are placeholders until a domain is chosen: `app.codeitlab.com` and
`app.codeitlab.dev`, `relay.codeitlab.dev`, `ingest.codeitlab.dev`. The defaults live in
`packages/codeitlab/src/remote.ts`, `apps/server/src/cloud/publicConfig.ts` and
`.github/workflows/release.yml`; set them to the domain you own before the first public
release.

## Drift guard

`apps/web/src/components/codeitlab/renameDrift.test.ts` fails when the retired upstream
brand appears in any tracked path or text file. It walks the checkout instead of a
hand-picked directory list, and skips only build output, `.repos/`, dependency trees and
binary formats that cannot be edited as text.

## Upgrading from the upstream app

Nothing the upstream app wrote is read any more, because the paths that name it cannot
be mentioned in this repository:

- State moved to `~/.cil`. An install that predates CodeItLab keeps its state under the
  upstream app's own home directory; CodeItLab does not read, move or delete it. Copy
  `userdata/` across by hand if you want that history.
- The project file is `cil.json` only. A repository carrying the upstream project file
  is treated as having no project file until it is renamed by hand.
- Git refs live under `refs/cil/**`, and temporary worktree branches are `cil/<hex>`.
  Worktrees left on upstream-prefixed branches are not adopted or cleaned up.
- The CLI is `codeitlab` (alias `cil`); launchd label `com.cil.codeitlab.service`. The
  upstream command name and label are no longer recognised, so an old job must be
  removed by hand before the service is installed again.
