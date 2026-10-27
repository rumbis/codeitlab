# Models, quota and custom endpoints

One page answers three questions that used to be spread across the picker, the
routing panel and the global Limits view: which models exist, how much of each
subscription is left, and what leaves this machine when a prompt is sent.

The page lives at **Settings → CodeItLab → Models**. Its source is
`apps/web/src/components/codeitlab/CodeItLabModelsPage.tsx`; the pure fold that
turns provider snapshots into rows is `apps/web/src/codeitlab/modelsInventory.ts`.

## Every model, and why some are not in the picker

The picker shows what a turn can select right now. That is deliberately narrower
than what a provider advertises, and the difference is what makes a model look
missing. The Models page lists the advertised set and labels each row with the
reason it is not selectable:

| Row state         | Meaning                                       | Where it comes from                                        |
| ----------------- | --------------------------------------------- | ---------------------------------------------------------- |
| Selectable        | The picker will offer it                      | provider snapshot `models`                                 |
| Update required   | The installed CLI cannot serve this model yet | `updateRequiredModels`; updating the provider unlocks it   |
| Legacy            | Retired model kept for old threads            | `isLegacy`                                                 |
| Hidden by you     | Turned off in the Models page                 | `clientSettings.providerModelPreferences[id].hiddenModels` |
| Provider disabled | The whole instance is off                     | `providerInstances[id].enabled`                            |

Hiding a model is presentation only. A thread that already selects a hidden
model keeps working, and the row stays listed with the reason it is hidden —
a one-way "disappear" would be a bug.

The page writes the same setting the picker reads
(`providerModelPreferences`, patched with `setModelsHidden`), not a list of its
own: two sources of truth would let the page say "hidden" while the picker kept
offering the model. Custom endpoints are not in the picker at all, so their rows
say "not in the picker" instead of offering a toggle that would do nothing.

`modelCount` on the routing catalog is the number the provider advertises; when
it is larger than the listed models the page says "showing N of M advertised"
instead of pretending the list is complete.

## What the session understood

The Models page answers two different questions on one surface, so the tabs keep
them apart without splitting the data:

| Tab       | What it holds                                                                     |
| --------- | --------------------------------------------------------------------------------- |
| Inventory | every advertised model, the quota each account reports, custom endpoints, masking |
| Routing   | the router's mode, weights, health and decision history                           |
| Context   | the per-model context sizes the app uses when it trims a thread                   |

`/settings/codeitlab/routing` and `/settings/codeitlab/context` still resolve; they
open the Models surface on that tab, so old deep links and saved searches keep
working.

At the top of Inventory sits **Session understanding**: what this app read from the
newest prompt, joined onto the same rows. It is built by
`apps/web/src/codeitlab/modelsSession.ts` and the composer's picker calls the same
function, so the two surfaces cannot disagree about the task class or the reason.

- The coverage line counts what providers advertise (`modelCount`), not what the
  page lists, plus the OmniRoute virtual models and custom endpoints.
- The chip reads `<task class> · heuristic` and repeats the router's own reason for
  its last decision. It is a reading of one prompt by this app, not the router's
  log, and the page says so next to the reason.
- Each row carries the router's numbers for that model when it was a candidate:
  `smartness 0.92, quota 40%, speed 0.70 → score 0.78`. A model that was not a
  candidate says it was not scored rather than showing a zero.
- The model the router would pick right now is badged `would pick now`. That badge
  is a reading of the last decision; it does not change a thread's model.
- When the provider routes with its own router (an ACP agent), the row says the
  choice belongs to the provider and this app only reports it.
- With no decision yet, every row says so. The page never invents a verdict.

The composer picker shows the same chip beside the model trigger, but only in the
composer and only once the server has answered: while the routing catalog is still
a local preview the chip stays hidden, because a preview verdict would be a lie.
The settings page is not inside a thread, so it has no honest source for the
active thread's token usage: it says where that number lives instead of printing
zeros. The composer is inside a thread, so its chip reads the route's thread
projection (`threadSessionContextUsage`) and renders `12,000 / 200,000 tokens`
next to the class once that thread has run. A thread that never reported usage
shows no number at all, which is the truth, not a zero.

## Overrides, delegation and the explanation

The router scores every candidate on the same three signals - remaining quota,
smartness and speed - with defaults 35% / 40% / 25%
(`apps/server/src/codeitlab/routing/scoring.ts`). The task class shifts those
weights before scoring, so a `fast` turn weights speed far more than a
`coding` turn does; the multipliers live next to the defaults and are covered by
`scoring.test.ts`.

Three things can stand between scoring and the decision:

| Mechanism           | Where it lives                   | What it does                                                                                                                      |
| ------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Per-task override   | `routing.taskOverrides`          | Pins a provider/model to a task class. Honored before scoring; an unusable target falls back to scoring with the reason prefixed. |
| Delegated providers | `routing.delegatedProviderKinds` | Provider kinds the user declared to route themselves. The decision is marked `delegated` and the app stops scoring that kind.     |
| OmniRoute mode      | `routing.mode = "omniroute"`     | The gateway picks the real model, so its decision is always `delegated`.                                                          |

Delegation never changes which candidate wins: it changes who gets the credit and
stops the app from second-guessing a provider that already routes. An override is
still subject to enforcement, so a thread that pinned its own model keeps it - the
decision reports `enforced: false` with a `skipReason` instead of swapping the
model under the conversation. That is the "no silent model change inside a thread"
rule, enforced server-side in `withEnforcement` and mirrored in the composer by
`routingDecidesComposerSelection`.

The prose explanation is built by `describeDecision` on the server and already
carries the numbers; the Routing tab renders the same candidates as a table so the
prose and the table cannot disagree about a score.

## Subscription quota

Quota comes from the same usage-limit probes the Limits view uses, so the two
surfaces can never disagree: each account reports windows (`session`, `weekly`,
`monthly`) with a used percentage and a reset time.

An endpoint that cannot report windows says **not reported** and names the
reason. An API key has no plan behind it, and a probe that failed this time is
not the same as an account that can never report — the page distinguishes them
instead of drawing an empty bar that looks like 0% used.

## Custom OpenAI-compatible endpoints

`codeitlab.models.endpoints` holds endpoints the user added by hand:

```json
{
  "id": "work-gateway",
  "label": "Work gateway",
  "baseUrl": "https://gateway.example.com/v1",
  "apiKeyEnv": "WORK_GATEWAY_KEY",
  "models": ["gpt-5.5", "claude-opus-5"],
  "enabled": true,
  "maskPrompts": true
}
```

- **The key is a variable name, never a value.** Settings are a plain JSON file
  on disk; a key written there would end up in a backup. The server reads the
  variable at request time and never returns it.
- **Base URLs are validated on both sides.** `normalizeModelEndpointBaseUrl`
  rejects credentials in the URL, queries, fragments and non-HTTP schemes, and
  allows plain HTTP only for loopback and RFC 1918 hosts, because a public
  endpoint would carry the bearer token in the clear.
- **Discovery is a server call.** `codeitlab.models.probeEndpoint` fetches
  `{baseUrl}/models`, parses the OpenAI `{ data: [{ id }] }` envelope (or a bare
  array, or `{ models: [...] }`), caps the list at
  `MODEL_ENDPOINT_MODEL_LIMIT` and reports reachability separately from "reached
  but empty". The browser cannot do this itself: the token is server-side and
  CORS would block it.

Adding an endpoint registers it in the inventory and makes its models visible
with their probe state. It does **not** yet make CodeItLab dispatch a coding
turn to that endpoint: turns run through provider harnesses (Codex, Claude,
Cursor, Grok, OpenCode, Antigravity, ACP agents), and an OpenAI-compatible
endpoint has no agent runtime behind it. See `LIMITS.md`.

## Privacy masking

Masking is not a per-endpoint invention; it is the local credentials firewall
(`docs/codeitlab/CREDENTIALS-PROXY.md`), which already runs on every prompt a
built-in provider adapter receives (`guardProviderPrompt`) and restores the real
values in provider output.

The Models page does not claim more than that. Each endpoint shows one of:

- **masked** — firewall on and the endpoint opts in; prompts are replaced with
  deterministic fakes before they leave the machine.
- **raw** — firewall on, endpoint opts out; the prompt is sent as typed.
- **off** — the firewall is disabled, so nothing is masked regardless of the
  per-endpoint switch.

A toggle that says "masked" while the firewall is off would be a lie, which is
why `modelMaskingBadge` takes both inputs and reports `off` first.
