# Board

The board turns ideas into threads. Open it from the sidebar (the **Board** item next to
Studio and Usage), from **Settings → CodeItLab → Board**, or with `#/board`. It has four
columns:

| Column          | What it means                            |
| --------------- | ---------------------------------------- |
| **Pending**     | An idea that has not been started.       |
| **In progress** | A thread is working on it.               |
| **Review**      | The work is done and waiting for a look. |
| **Completed**   | Done and counted.                        |

The sidebar footer also shows one small chip per column with its active count once the
board has tasks; each chip is a link back to the board. The chips disappear when the
board is empty, so a quiet sidebar stays quiet.

## Add and move tasks

Type a title in the field above the board and press **Enter** (or **Add task**).
Each card has arrow buttons that move it one column left or right; every button is
reachable with **Tab** and labelled for screen readers ("Move Fix login to Review").

## Start a task

**Start** opens a new draft thread in your most recent project, puts the task title
(and notes, once you add them) in the composer, and moves the card to **In progress**
with the thread id recorded on it. Nothing runs on its own: the board is a view over
ordinary threads, so you steer, approve and diff the run exactly like any other thread.
If no project is open, the board says so instead of silently doing nothing.

## Auto review

When a task's own run finishes cleanly, the board moves the card from **In progress** to
**Review** by itself and tells you how many it moved. The rule is deliberately narrow:

- only the task whose thread is the run's root thread moves — a delegation inside the run
  does not move anything;
- a run that is still working, or whose last run ended with an error, leaves the card in
  **In progress** so the failure stays visible instead of looking reviewed;
- a completion older than the moment the task started is ignored, so an old run can never
  mark a fresh task reviewed.

You can still move cards by hand at any time, and **Completed** stays a manual step.

## Archive

Cards can be archived by hand at any time; **Archived** at the bottom of the page lists
them and **Unarchive** puts one back in its old column. **Completed** cards also archive
automatically once they have sat there for seven days, so the board stays focused; the
page tells you when that happens.

## Where tasks live

Tasks are stored in the CodeItLab settings document on your server, so they follow the
same sync, backup and permission rules as the rest of your settings. They are not files
in your repository and never leave the machine unless your own sync setup moves them.

## Open the thread

**Details** opens a side panel for the task: read the title and saved notes, edit
the notes and save them without leaving the board. Escape or the close button
closes it, and notes are trimmed before they are stored.

**Open thread** leaves the board and opens the task's thread as a full page. The
board does not embed a copy of the thread in a side panel: the chat view only
exists inside the chat route, and a second copy would be a second execution path
for the same conversation.

A started task keeps a link to its thread, so the card shows **Open thread** next to Start/Restart.
It navigates to the same thread the composer opened — the board never runs anything itself.

## Where the board is stored

The board is mirrored to the local database (migration 068), so the same tasks can be read from
another device on the same environment. Until the database answers, the page falls back to the
copy saved with your settings, and it says which copy it is showing:

- _Reading the shared board from the database._
- _Showing the local copy: the database has no tasks yet…_

A database failure never hides the board: the settings copy stays authoritative and the header
tells you so instead of pretending the tasks were shared.

## Keyboard

Tab reaches the move buttons on each card, and Enter or Space moves the card to
the next column, so the board works without a pointer. The buttons name the
destination ("Move <task> to In progress"), which is also what a screen reader
announces.

Archived tasks can be restored with **Unarchive** or removed for good with the
delete button. Deleting is immediate and has no undo, so use Unarchive when the
task is only parked.

## Progress

Above the columns the board shows how many tasks are **completed** and how many
days in a row something was finished. It counts only tasks completed on this
board, by UTC day, and moving a task out of Completed takes it back out of the
count. There are no points, levels, or badges: the number is there to show
momentum, not to be farmed.

If the shared database cannot be read, the board says so and names the reason,
and keeps working from the local copy instead of showing an empty page. Saving
then goes to your settings, so nothing you type is lost while the database is
unavailable.
