# Goal budget

A goal budget is a number of tokens you are willing to spend on a thread. Open
**Settings → CodeItLab → Goal budget**, find the thread, and type the budget. Clearing the
field removes it.

## Where you see it

The context meter in the composer shows the budget, how much of it is used, and what is left.
It warns at **80%** and marks the thread **over** at **100%**.

## What it does not do

It does not stop anything. The server owns run lifecycle, and CodeItLab does not cancel a
running turn behind your back, so the meter says "warning only" and "nothing stops
automatically" instead of pretending to enforce a limit. If you need to stop a run, interrupt
it the normal way.

The budget is per thread and applies to the thread's whole life, including resumed runs. It is
stored with the rest of the CodeItLab settings, so it follows the environment, not the device.
