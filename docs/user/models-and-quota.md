# Models, quota and what the session understood

Settings → CodeItLab → Models is the one place that answers "what can I run, what
is left, and why is the app choosing this one". It has three tabs:

- **Inventory** - every model your subscriptions and custom endpoints advertise,
  the quota each account reports, and the masking state of custom endpoints.
- **Routing** - the router's mode and weights, provider health, and the decisions
  it made.
- **Context** - how many tokens the app keeps for each model when it trims a
  thread.

The old Routing and Context pages still open from their links; they now land on
the matching tab.

## What the session understood

Above the model list is a card that shows what the app read from your newest
prompt: the task class (for example `coding`), the reason the router gave, and,
for each model, the numbers the router scored it with - smartness, quota left,
relative speed and the weighted score. The model the router would pick right now
is badged **would pick now**.

This is a reading of one prompt, not a promise. The card says **heuristic** next
to the class for exactly that reason, and before the first prompt of a session it
says there is nothing to explain instead of guessing. Nothing here changes the
model of a thread you already started.

The composer's model picker shows the same chip, so you can see the class and the
reason without opening Settings. It appears only after the app has real data from
your server.

## What it will not pretend

- A model the provider advertises but your installed CLI cannot serve is listed
  with the reason, not hidden.
- Hiding a model only changes the picker. The router still knows about it, and a
  thread already using it keeps working.
- Quota is only shown when the provider reports it. An account that reports
  nothing says so instead of showing a full bar.
- Token usage is per thread, so the Models page cannot show it. Open the picker
  inside the thread to see used and total tokens for the model that thread runs.
