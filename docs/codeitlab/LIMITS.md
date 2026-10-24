# What CodeItLab does not do

Every feature page says what it cannot do where the user meets it. This page
collects those statements in one place so the claim can be checked instead of
trusted. If a limit here disagrees with the app, the app is wrong and this page
should be fixed with it.

## Behaviour that is deliberately bounded

| Surface                | Limit                                                                | What it actually does                                                                                                                                                             | Evidence                                                                                                                                                                                 |
| ---------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Goal budget            | A budget is a **warning, not a stop**                                | Progress is shown against the number you set; nothing blocks a turn when it is exceeded                                                                                           | `packages/codeitlab/src/budget.test.ts` (ok / near / over, never negative)                                                                                                               |
| Issues                 | Local to this machine's CodeItLab settings                           | No sync, no issue-tracker write, no API call to GitHub or Jira                                                                                                                    | `packages/codeitlab/src/issues.test.ts`; the page imports no network client                                                                                                              |
| Deploy                 | Runs your command **in a normal thread**                             | CodeItLab calls no hosting API; the agent runs the command and asks before installing or logging in                                                                               | `packages/codeitlab/src/deploy.test.ts` plus deploy page browser tests                                                                                                                   |
| Bots                   | A **persona over a normal thread**                                   | No separate bot runtime; each chat is a regular thread with a saved persona and message                                                                                           | `packages/codeitlab/src/bots.test.ts` plus bots page browser tests                                                                                                                       |
| Agent teams            | Changed files cover **the run's own checkpoints**                    | Files edited outside those checkpoints are not attributed to the run, and the card says so                                                                                        | `apps/web/src/codeitlab/team.test.ts` (`aggregateTeamChangedFiles`)                                                                                                                      |
| Board storage          | Database first, **settings as fallback**                             | If the database read fails the board keeps working from settings and the header says which copy won                                                                               | board browser test "keeps the local board when the database has no rows"                                                                                                                 |
| Board side panel       | The board opens a task's thread as a **full page**, not a side panel | The thread renderer only exists inside the chat route; mounting it in a sheet would be a second execution path, so the board links to the real thread instead of embedding a copy | board browser test asserting Open thread navigates to `/$environmentId/$threadId`                                                                                                        |
| Board progress         | Counts **only this board's completed tasks**, by UTC day             | There is no account-wide score and no points; moving a task out of Completed removes it from the count, while archiving hides a task but keeps it in the history                  | `packages/codeitlab/src/progress.test.ts` (unique days, streak grace, best kept, completion day), `apps/web/src/codeitlab/board.test.ts` (archive clock, archive/unarchive keep the day) |
| Profile                | Interest domain and skillset are **declared by you**, not inferred   | Nothing is derived from your files or chats, and an empty profile sends no context at all. Bot briefs carry it; ordinary threads do not inject it automatically.                  | `packages/codeitlab/src/profile.test.ts` (empty profile yields no block), `bots.test.ts` (bot brief)                                                                                     |
| Context sizes          | Estimates are marked with `~`                                        | A size that is not recorded is an estimate, not a measurement                                                                                                                     | `packages/codeitlab/src/context.test.ts` (labelled family estimate)                                                                                                                      |
| Marketplace            | A **separate deployment**                                            | This app stores its address and opens it; escrow, fees and jobs are not proxied through the app                                                                                   | marketplace page browser tests; no server route proxies it                                                                                                                               |
| Memory / REA / routing | Local files and settings                                             | Nothing is uploaded to a CodeItLab service; there is no CodeItLab cloud                                                                                                           | the settings schema has no remote endpoint for these blocks                                                                                                                              |
| Rename                 | A few technical ids still say `t3`                                   | Package scope, archive executable and `app.t3.codes` origins need a release or a domain; everything user-facing says CodeItLab, and a drift test enforces it                      | `apps/web/src/components/codeitlab/renameDrift.test.ts`                                                                                                                                  |
| Wallpaper              | Opacity is capped at 60%                                             | Above that the UI stops being readable, so the control refuses rather than letting it happen                                                                                      | `packages/codeitlab/src/wallpaper.test.ts` (caps opacity)                                                                                                                                |

## Blocked work, with the reason

| Item                                     | Why it is not done                                                                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Telegram bots                            | Needs a bot token from the user; the code path is local web chat only until one is configured                            |
| Per-bot schedules and shared threads     | Follows Telegram and the vault wiring; not started rather than half-built                                                |
| Tart sandbox + MCP tools (G4)            | The `tart` CLI is not installed on this machine and pulling VM images is a machine-level decision, so nothing is stubbed |
| Stripe Connect sandbox                   | Needs `sk_test_…` and `acct_…` credentials; the escrow code exists but is unverified against a real sandbox              |
| Marketplace browser e2e                  | Needs the separate marketplace deployment running; there is no fake of it in the test suite                              |
| Lighthouse PWA score                     | Needs a production build served over HTTPS on a quiet machine                                                            |
| Desktop cold start row in PERFORMANCE.md | Needs the app fully closed and a quiet machine, otherwise the second instance just focuses the first                     |

## Naming

`t3` still appears in the package scope, the internal archive executable, the
`app.t3.codes` origins, and `$HOME/.t3` on WSL and SSH remotes (the worktree
branch prefix is now `cil`). Those are staged,
not forgotten: each needs a fallback release, a real domain, or a migration that
can reuse an old directory. [RENAME.md](./RENAME.md) records the reasoning.

## Telemetry

CodeItLab sends no telemetry by default and has no CodeItLab-operated endpoint to
send it to. That is a statement about this code, not a promise about the other
harnesses or providers you connect: they keep their own behaviour and their own
policies.
