# Agent teams

A team is a saved preset: one architect plus up to three workers, each with a role and,
optionally, its own provider and model. Starting a team opens an ordinary thread in your most recent
project with a brief already written in the composer. You review it, send it, and the architect does
the rest.

Open **Settings → CodeitLab → Team**.

## Building a preset

- **Team name** — what the preset is called in the list.
- **Architect provider / model** — leave both empty to run the architect on the thread's current
  model. The pickers suggest the providers and models your environment already reports; you can
  type any id.
- **Workers** — one row per worker: a name, a role (`implementation`, `tests`, `review`, or your
  own word), and optionally a provider and model. Empty provider means "same as the architect";
  empty model means "that provider's default".

**Save preset** keeps the current values. **New preset** starts from a two-worker default. Deleting
the last preset returns the page to its empty state.

## Starting a team

1. Describe the task in **Task**.
2. Press **Start team**.
3. CodeitLab opens a draft thread in your most recent project and puts the team brief in the
   composer.

Nothing runs until you send. That is deliberate: the brief names every worker, its role and its
model, and you can edit it before the architect starts.

## What the architect does

The brief tells the architect to split the task into one delegation per worker, use `delegate_task`
with the worker's provider and model, run independent workers in parallel, and then answer with:

- one row per worker (what it owned, what it changed, status), and
- a synthesis: decisions, conflicts, the deduplicated list of changed files, and open questions.

Worker work appears in the thread as delegated tasks, so you can follow, steer and review it like
any other thread. There is no separate team runtime and no hidden second conversation.

## Limits worth knowing

- Teams need a project: the draft opens in your most recent one, because changes and diffs need a
  home. There is no project picker in the Team page yet.
- The aggregated changed-files list is the architect's summary, not a filesystem scan. If the
  architect skips it, ask for it.
- A worker's provider and model are suggestions in the brief; the architect is instructed to honour
  them, and `delegate_task` reports what actually ran.
- The team preset is stored in CodeitLab settings, so it follows the environment, not the device.

## Recent runs

Starting a team records the run under the preset picker: the task, the preset
name, when it started and the thread it opened. Each run card lists one row per
worker as soon as the architect delegates, with the worker's state (`working`,
`idle`, `done`, `failed`, `stopped`). Once every worker settles, the card adds a
synthesis block with the counts and each worker's written result, so you can
compare them without opening every child thread.

The card only claims what the roster reports: with no delegation yet it says so,
and a missing thread projection is shown as "no worker rows yet" instead of a
success. Open the thread for the full transcript, diffs and approvals.

## Changed files

A run card lists the files its thread changed, deduplicated across checkpoints: a file edited
three times appears once with its latest additions and deletions. The card caps the list at
twelve rows and points at the thread diff for the rest.

The list reads the run's own checkpoints, so a worker editing a separate worktree may not appear
there. The card says that plainly instead of implying full coverage; the thread diff remains the
source of truth for what each worktree changed.

## From the composer

The composer footer has a small **Agent teams** button (keyboard reachable with Tab, labelled for
screen readers). It opens the team setup rather than starting a run: a team needs a saved preset
and a task, and hiding the brief the architect receives would make the run harder to trust.
