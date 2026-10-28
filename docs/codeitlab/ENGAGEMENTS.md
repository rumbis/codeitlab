# The marketplace bridge

The app is a **client** of the marketplace the user runs. It has no marketplace of
its own, no escrow, and no opinion about who gets paid: it reads what the
deployment reports and writes messages into the thread that deployment owns.

## Shape

```
app (EngagementsService)  ──HTTP + Bearer token──▶  user's marketplace deployment
   ▲   │                                                   │
   │   └─ settings: codeitlab.marketplace { url, enabled }   └─ /api/engagements
   └──── vault: codeitlab.marketplace.token                  /api/engagements/:id/messages
```

- `packages/codeitlab/src/engagements.ts` holds every shape and the pure rules
  (next step per role + status, amount formatting, URL normalisation, message
  validation). Both sides of the wire mean the same thing because the same module
  defines them.
- `apps/server/src/codeitlab/engagements/EngagementsService.ts` is the only thing
  that talks HTTP. It takes an injectable `httpJson`, so every test runs without a
  socket.
- The token is written through `ServerSecretStore` under
  `codeitlab.marketplace.token`. It is never stored in settings and never returned
  by an RPC; the bridge reports `tokenPresent` only.
- Five RPCs: `bridge`, `list`, `messages`, `postMessage`, `configure`. Reads take
  the orchestration-read scope, sending and configuring take settings-write.

## Read-only is a state, not an error

The bridge computes one of four honest states and returns it with every result:

| Missing / broken         | `reason`                                                |
| ------------------------ | ------------------------------------------------------- |
| No URL                   | "No marketplace URL is configured yet…"                 |
| No token in the vault    | "Add an API token from your marketplace deployment…"    |
| Bridge not opted in      | "The marketplace bridge is turned off…"                 |
| Deployment refuses/fails | "The marketplace answered 401: …" / "Could not reach …" |

A read-only bridge never calls the network for a read: `list` and `messages`
answer from local state with an empty collection, so the panel can render the
configuration form without waiting on a timeout. `postMessage` returns
`{ posted: false, reason }` — the UI shows the reason rather than a fake success.

## What the deployment must offer

The bridge assumes these endpoints exist on the user's deployment (they are part of
the marketplace in `apps/marketplace`):

- `GET /api/engagements` — the account's engagements, with `role`, `jobTitle` and
  `counterpartName` so a client can render without a second request.
- `GET /api/engagements/:id/messages?after=<id>` and
  `POST /api/engagements/:id/messages` — participants only, ascending order,
  optional evidence links.
- `POST /api/auth/tokens` — issues the API token the app stores in the vault.

If a deployment predates these endpoints, the bridge reports the 404/401 it got;
it does not guess a different API.

## Polling

Polling is opt-in with the bridge. The panel polls the list and the selected
thread every 15 s while `document.hidden` is false, and stops when the bridge is
read-only. There is no websocket and no new cloud dependency: the marketplace
stays the source of truth and the app just re-reads it.

## Delivery from a thread

`draftDelivery` turns a thread into a reviewed delivery without trusting the
client for facts. The RPC takes a thread id and an engagement id; the **server**
resolves the thread's working tree (`worktreePath`, else the project's workspace
root), reads `GitManager.localStatus` there, and composes two texts from what git
actually reports:

- `note` — a short delivery note: "Delivered: <job>", files changed with per-file
  `+insertions −deletions`, branch, and one line saying evidence links are still
  missing.
- `handoff` — the client-facing explanation in four sections: what was built, how
  it runs, what it cost (the marketplace's amount), and what was **not** done. The
  last one is a prompt, not a claim: the app cannot know what the coder left out.

Drafting is local and never needs the bridge, so it works read-only. `reason` is
empty when there is work to attach, otherwise it names the exact state ("not in a
project", "not a git repository", "no changed files").

`deliver` is the only step that writes: it validates the note (1..2000 chars) and
the evidence (full http(s), deduped, at most 5 — the marketplace's own cap), then
`POST /api/engagements/:id/deliver` with `{deliveryNote, deliveryEvidence}`. The
marketplace enforces role and ordering, so a refusal is returned verbatim and the
draft stays in the dialog. The UI never sends on the user's behalf: pressing
Deliver is the review.

## Explaining the delivery to the client

The deterministic handoff is accurate but dry. `deliveryHandoff` asks the thread's
own model to rewrite it as a note a business owner can read, and returns it for
review — it never sends anything.

- The server drafts first (same git facts, same `reason`), then calls the new
  `generateDeliveryHandoff` operation on `ProviderTextGeneration` with the
  engagement title, the deterministic note, the marketplace's amount label, and
  the thread's model selection. Providers that share `fromRunner` get it for free;
  ACP reports it as unsupported.
- The prompt pins the four sections and forbids claims the app cannot verify: no
  "tests pass", no "deployed", no "released". The amount is described as held by
  the marketplace, and the app says "(not available to the app)" when it has none.
  The summary is forced to one line of at most 160 characters and the body to at
  most 4,000.
- The result says who wrote it: `generated: true` with `model` set, or
  `generated: false` with a `reason` (no text generation in this build, no model
  selected for the thread, the model failed) and `body` set to the deterministic
  handoff. A model failure is a draft the coder can still edit, never an error page.
- The dialog shows the text in an editable box with "Use this text", which copies
  it into the delivery note. The coder still presses Deliver; the app does not
  speak to the client on its own.

What it still cannot know: whether tests were run, what was deployed, what the
client expected, or what was deliberately left out. Those stay prompts inside the
text, not facts, and the marketplace remains the record of what was delivered.

## Not built yet

- **Test evidence capture**: the app does not record test runs, so evidence links
  are the coder's own. A future thread-evidence reader could fill them in.
- **Realtime**: polling only. A push channel would be a marketplace feature.
- **Money**: the app never reads or moves balances; it shows the amount the
  marketplace charged and nothing else.
