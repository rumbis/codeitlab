# Level, streak and XP on the send button

The send button carries a small ring, a level number and a streak. They come from
the server, not from a counter in the browser: the app records what actually
finished, the server keeps the ledger, and the ring is redrawn from that ledger.

## What earns XP

| What happened                                  | XP  |
| ---------------------------------------------- | --- |
| A turn finished                                | 10  |
| A board task was completed                     | 50  |
| Any UTC day that had at least one of the above | 5   |

That last row is the only thing that looks like a bonus, and it is still tied to
real work: a day with no finished turn and no finished task earns nothing. There
is no XP for opening the app, for sending a prompt, or for clicking the ring.

A task earns its 50 XP when its card lands in **Completed** on the board. The
server records it with the task's own id, so saving the same card again — or
reopening and completing it a second time — cannot farm XP, and the ring
refreshes as soon as the move is saved. The board itself never waits for the
ledger: if the XP write fails, the task is still completed and the ring simply
catches up on its next read.

## Levels and the ring

Level 1 starts at 0 XP. Level _n_ starts at 50·(n−1)·n XP, so level 2 needs 100,
level 3 needs 300, level 4 needs 600. The ring fills towards the next level; the
tooltip and the accessible name give the exact numbers ("Level 3, 130 of 300 XP").

The +10 or +50 appears for a moment when an award lands: it fades and lifts by a
few pixels, once, in under 200 ms. If your system asks for reduced motion, the
number still appears — it just does not move.

## Streak

The streak counts consecutive UTC days with at least one finished thing. It stays
alive through today: finishing yesterday keeps it, a full empty day ends it. The
best streak is stored, so a gap shows the record you reached instead of quietly
resetting it to zero.

## Sound, and turning the ring off

Sound is off by default; Effects → SFX enables it (and the ring itself has no
sound of its own). Nothing is gated: the send button works exactly the same at
level 1 as at level 20. If you would rather not see the ring, turn effects off in
Settings → CodeItLab → Effects; the numbers stay in the ledger either way.

## Honest limits

- XP is per server, in the settings file. There is no account, no leaderboard, and
  nothing leaves this machine.
- The ledger keeps the last 500 events. Older events fall off and the total is
  recomputed from what remains, so a very long history plateaus instead of
  growing forever.
- A repeated event id is ignored, so retrying a request never doubles an award.
  The flip side is that a client can only report _that_ something finished; it
  cannot ask for XP directly.
