# The auto router: why this model, and how to override it

Pick **Auto router** in the composer's model picker and every turn is routed for
you. Each prompt is classified first - `coding`, `reasoning`, `vision`, `chat`,
`fast` or `cheap` - and the candidates are scored on three signals:

- **quota left** (default weight 35%)
- **smartness** (40%)
- **speed** (25%)

The weights are yours to change in Settings → CodeItLab → Models → Routing. The
task class also shifts them: a `fast` turn cares much more about speed, a
`coding` turn about smartness, a `cheap` turn about quota.

## See why it picked a model

Models → Routing shows the newest decision under **Why this model**: the task
class, the model it picked, and a table of every candidate with the numbers it
was scored on - quota left as a percentage, smartness, relative speed and the
weighted score - with **picked** on the winner. A model that was not available
says so instead of quietly scoring zero.

The prose reason under the title is the router's own explanation, including the
task signals that fired and the runner-up it beat.

## Override it per task

Under **Per-task overrides** you can pin a provider and model to a task class. An
override wins over scoring for that class, so `coding` turns always run where you
say. Two limits, on purpose:

- A thread that already picked its own model keeps it. Routing never swaps a
  model under a conversation that has started.
- If the pinned provider or model is not usable right now, the router falls back
  to scoring and the decision says which override target was unavailable - it
  does not fail the turn.

**Router decides** clears the pin.

## Providers that route themselves

Some providers pick the model inside their own product (a gateway's auto mode,
for example). Under **Providers that route themselves** you can tell CodeItLab
which ones: it then stops scoring that provider's models and reports the
provider's choice, marked **delegated** in the decision. Only turn this on when
the provider really does its own routing - otherwise you are asking the app to
skip the comparison you wanted.

## What it will not pretend

- Smartness and speed are name-based tiers, not benchmarks. A measured latency
  from the speed probe replaces the estimate for the models it covers.
- The router never changes a model silently inside a thread; an override that
  would replace a pinned model is reported, not applied.
- If no provider is available, the turn fails with a clear message instead of
  inventing a fallback.
