# Working with the business that hired you

If you are a vibe-coder selling work on a CodeItLab marketplace, the app can show
that work and let you talk to the business without leaving your thread.

## Turn the bridge on

The app talks to **your own marketplace deployment** — the one you run, not a
CodeItLab service. Settings → CodeItLab → Engagements:

1. Paste the deployment URL (for example `https://acme.example/market`).
2. Paste an API token created in that deployment (the marketplace's
   `POST /api/auth/tokens` endpoint issues one; the raw value is shown once).
3. Turn the bridge on.

The token goes into the local vault, not the settings file, and the app never
shows it again. Turn the bridge off at any time; the URL and token stay so you can
turn it back on.

## What the panel shows

- Engagements where you are the coder ("working for …") and where you are the
  business ("hired …"), active first, then settled.
- For each: the job title, the other side, the status the marketplace reports,
  the amount, and **one next step** derived from the state machine — accept,
  start, deliver, wait for review, approve, and so on.
- The amount is what the marketplace charged. The app does not hold it, move it,
  or compute a payout.

## The thread

Select an engagement to read its messages. Both sides write into the same thread
through the marketplace, so what you send is what the business sees. Evidence
links travel with a message and open in a new tab. The app polls every 15 seconds
while the bridge is on and the tab is visible; nothing is polled when it is off.

If the marketplace refuses a message, the panel shows its reason instead of
pretending it was sent.

## Delivering the work

When the engagement is in progress, open the thread you did the work in and press
the handshake button in the composer (the delivery dialog also lives behind the
Engagements settings page). Then:

1. Pick the engagement that is waiting for a delivery.
2. Press **Attach work from this thread**. The server reads that thread's working
   tree and drafts a note: what changed, which files, how many lines, and the
   branch. Nothing about test results is invented — if you want the business to see
   a test run, add its link.
3. Press **Explain this delivery to the client**. The model running in this thread
   rewrites the facts as a note a business can read: what was built, how it runs,
   what it cost, and what was **not** done. It can only rearrange what the app
   knows, so it never claims tests passed or that something was deployed. Read it,
   edit it, then press **Use this text** to put it in the delivery note. If no model
   is selected or the call fails, the dialog says why and shows the plain
   handoff instead — you can still send that.
4. Add evidence links (a pull request, a deploy, a test run) — one per line, at
   most five.
5. Press **Deliver**. Only then does anything leave your machine.

The marketplace records the delivery and moves the engagement to `delivered`;
approving and releasing money stay with the business. If the marketplace refuses,
the dialog shows its reason and keeps your draft.

## When it is read-only

The panel says exactly which piece is missing:

| State                        | What it says                                                      |
| ---------------------------- | ----------------------------------------------------------------- |
| No URL                       | Add the URL of your deployment.                                   |
| URL but no token             | Add an API token from that deployment.                            |
| Token but bridge off         | The bridge is turned off; turn it on to read and send.            |
| Unreachable or refused (4xx) | Could not reach it / the marketplace answered <status>: <reason>. |

Read-only is not an error state: the panel keeps the configuration form so you can
fix it in place.

## What the app never does

- It does not hold money, take a fee, or move escrow. The marketplace does.
- It does not accept, approve or cancel an engagement for you, and it only records a
  delivery after you press Deliver on a note you have seen.
- It does not decide what gets released. That stays with the business and the
  marketplace.
- It does not send anything you have not typed and confirmed.
