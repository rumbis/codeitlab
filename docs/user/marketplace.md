# Marketplace in the app

**Settings → CodeItLab → Marketplace** stores where the marketplace lives. The marketplace is a
separate server-rendered deployment (`apps/marketplace`), not a route inside the desktop app, so
the panel never pretends it is hosted here.

## Configure it

1. Deploy the marketplace (see `docs/codeitlab/DEPLOY-MARKETPLACE.md`).
2. Paste its full address, including `https://`, into **Marketplace URL**.
3. **Open marketplace** leaves CodeItLab and opens the address in your browser.

## Honest states

- Empty URL: the page opens with **Nothing to open yet**, a **Paste the marketplace address**
  button that moves focus to the field, and _Not configured_ under the input; the open
  button stays disabled and points at the reason it is disabled.
- A value that is not `http(s)`: the page says nothing will open instead of trying.
- A valid URL: _Configured. Opening it leaves CodeItLab and uses your browser._

Escrow, fees, jobs and payouts live in that deployment. This panel stores the address and
nothing else; no marketplace traffic is proxied through the app.

## What it costs

The panel spells this out before you leave the app: a **15%** platform fee on a
self-serve job and **20%** when the platform assists with matching. Payment sits
in escrow until the buyer approves the delivery, then the payout and the fee are
recorded; a cancelled job is refunded in full. Amounts are integer cents, so the
quote and the payout cannot drift apart. The app itself never touches the money.

## What each escrow state means

The panel also explains the states the deployment stores, so a status is never a
mystery:

| State         | What it means                                                                    |
| ------------- | -------------------------------------------------------------------------------- |
| `requested`   | You asked; nothing has moved yet.                                                |
| `accepted`    | The practitioner agreed; the job is ready to start.                              |
| `in_progress` | Work is happening; the payment stays in escrow.                                  |
| `delivered`   | Work was handed over and waits for the buyer's approval.                         |
| `approved`    | The buyer approved; the payout and the fee are recorded.                         |
| `paid_out`    | The practitioner has received the money.                                         |
| `cancelled`   | The job ended and the charge was refunded in full.                               |
| `disputed`    | Buyer and practitioner disagree; the money stays in escrow until it is resolved. |

## Who can move it, and from where

Every transition is checked on the server, so a stale page cannot move money. Anything
not listed here is refused with a conflict:

| Action    | Allowed from                           | Ends in       |
| --------- | -------------------------------------- | ------------- |
| `accept`  | `requested`                            | `accepted`    |
| `start`   | `accepted`                             | `in_progress` |
| `deliver` | `in_progress`                          | `delivered`   |
| `approve` | `delivered`                            | `paid_out`    |
| `cancel`  | `requested`, `accepted`, `in_progress` | `cancelled`   |
| `dispute` | `accepted`, `in_progress`, `delivered` | `disputed`    |

`approve` records the fee and the payout in the same step: if the payout does not settle,
the engagement goes back to `delivered` and nothing is charged.

## What you agree to before the money moves

The job post is the contract: description, skills, timeline and a budget range.
The engagement amount has to sit inside that range, a job can hold one active
engagement at a time, and an assisted job (20% tier) is scoped, shortlisted and
evidence-reviewed by an operator rather than charged as self-serve. Nothing is
captured until the engagement starts.

## If something goes wrong

A dispute is raised from the engagement while the money is still in escrow. An
operator of that deployment resolves it and must write a reason (at least ten
characters), which stays attached to the engagement as the audit trail. The
outcome is either **refunded** to the business or **released** to the
practitioner - never both. CodeItLab does not mediate, hold money, or decide the
outcome.
