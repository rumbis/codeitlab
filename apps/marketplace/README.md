# CodeItLab Marketplace

The codeitlab.com vibe-coder marketplace: people who use the app can say they
want paid work, businesses describe the work they need, and the service ranks
coders per job, runs the engagement and holds the money until the work is
approved.

This app is deliberately small and boring: Node's built-in HTTP server, Node's
built-in SQLite, server-rendered HTML, no framework and no build step. Money is
integer cents; the platform fee is computed in one place.

## Run

```bash
cd apps/marketplace
node src/server/main.ts            # http://127.0.0.1:4174
MARKETPLACE_DB=/tmp/m.sqlite PORT=4175 node src/server/main.ts
vp test run                        # focused tests
tsc-rs --noEmit                    # typecheck
```

Environment:

| variable                                 | default                          | meaning                                                                    |
| ---------------------------------------- | -------------------------------- | -------------------------------------------------------------------------- |
| `PORT`                                   | `4174`                           | HTTP port                                                                  |
| `MARKETPLACE_DB`                         | `<app>/.data/marketplace.sqlite` | SQLite file                                                                |
| `MARKETPLACE_BASE_URL`                   | `https://codeitlab.com/market`   | absolute canonical links (email, meta)                                     |
| `MARKETPLACE_BASE_PATH`                  | empty                            | mount prefix for every generated URL, e.g. `/market` behind the site proxy |
| `MARKETPLACE_ADMIN_TOKEN`                | empty                            | enables `/admin` when set                                                  |
| `MARKETPLACE_AUTO_APPROVE`               | `0`                              | approve new coder profiles immediately (demo mode)                         |
| `MARKETPLACE_DEV_EMAIL`                  | `1`                              | print login codes to stdout; `0` requires `MARKETPLACE_MAIL_TRANSPORT`     |
| `PAYMENTS_PROVIDER`                      | `mock`                           | `mock` or `stripe`                                                         |
| `STRIPE_SECRET_KEY`                      | empty                            | required when `PAYMENTS_PROVIDER=stripe`                                   |
| `STRIPE_CONNECTED_ACCOUNT_ID`            | empty                            | connected account that receives payouts (`acct_...`)                       |
| `STRIPE_API_BASE`                        | `https://api.stripe.com`         | override for tests/fake servers                                            |
| `PAYMENTS_WEBHOOK_SECRET`                | empty                            | Stripe signing secret; `/api/payments/webhook` is disabled until set       |
| `MARKETPLACE_COOKIE_SECURE`              | `0`                              | set `1` behind HTTPS                                                       |
| `MARKETPLACE_CHARGE_LIMIT_PER_HOUR`      | `10`                             | escrow charges one business may start per hour                             |
| `MARKETPLACE_TRANSITION_LIMIT_PER_HOUR`  | `120`                            | engagement actions one account may take per hour                           |
| `MARKETPLACE_INVITE_LIMIT_PER_HOUR`      | `60`                             | coder invitations one business may send per hour                           |
| `MARKETPLACE_REPORT_LIMIT_PER_HOUR`      | `20`                             | abuse reports one account may file per hour                                |
| `MARKETPLACE_AUTO_RELEASE_DAYS`          | `14`                             | days a delivery waits before escrow auto-releases; `0` disables            |
| `MARKETPLACE_MAINTENANCE_MINUTES`        | `0`                              | run reminders + alerts + auto-release every N minutes; `0` = manual only   |
| `MARKETPLACE_JOB_POST_LIMIT_PER_HOUR`    | `10`                             | jobs one business may post per hour                                        |
| `MARKETPLACE_APPLICATION_LIMIT_PER_HOUR` | `30`                             | job applications one coder may send per hour                               |
| `MARKETPLACE_MAIL_TRANSPORT`             | empty                            | `webhook` or `log`; required when `MARKETPLACE_DEV_EMAIL=0`                |
| `MARKETPLACE_MAIL_WEBHOOK`               | empty                            | gateway that receives `{to, subject, text}` JSON                           |
| `MARKETPLACE_MAIL_SECRET`                | empty                            | HMAC key for `x-codeitlab-signature` on mail pushes                        |
| `MARKETPLACE_SECURITY_CONTACT`           | `security@codeitlab.com`         | address published in `/.well-known/security.txt`                           |
| `MARKETPLACE_NOTIFY_WEBHOOK`             | empty                            | POST activity notifications here; empty disables the outbox                |
| `MARKETPLACE_NOTIFY_SECRET`              | empty                            | HMAC key for `x-codeitlab-signature` on outbox pushes                      |
| `VAPID_PUBLIC_KEY`                       | empty                            | Web Push public key (generate with `push:keys`); empty disables push       |
| `VAPID_PRIVATE_KEY`                      | empty                            | Web Push private key (PKCS#8, base64url); keep secret                      |
| `VAPID_SUBJECT`                          | `mailto:security@codeitlab.com`  | VAPID contact claim (`mailto:` or `https:`)                                |

Production deployment (systemd, Caddy, Stripe webhook, backups, upgrades):
[`docs/codeitlab/DEPLOY-MARKETPLACE.md`](../../docs/codeitlab/DEPLOY-MARKETPLACE.md).

## Production preflight

```bash
pnpm --filter @codeitlab/marketplace doctor
```

Fails (exit 1) on dev email in production, mock payments, missing mail
transport/webhook, empty admin token, non-HTTPS base URL, non-Secure cookies,
in-memory DB or invalid port; warns on short admin tokens, unsigned outbox
pushes, a **disabled auto-release**, an **auto-release with no maintenance loop**
(the sweep would never run), a mistyped `MARKETPLACE_*_LIMIT_PER_HOUR`, and
malformed VAPID/notify settings. Run it with the production environment loaded
before every deploy.

Then run the end-to-end smoke — a fresh in-memory database, nothing touched on
the host:

```bash
pnpm --filter @codeitlab/marketplace smoke
```

It signs two accounts in with codes, publishes and approves a profile, posts a
job, applies, funds escrow, accepts, starts, delivers with evidence, approves,
reads the printable receipt, checks the ledger totals (charge, fee, payout, held 0) and the health schema version. Exit 1 on the first broken step.

## Verifying the payment adapter

```bash
pnpm --filter @codeitlab/marketplace stripe:sandbox:mock   # no key needed
STRIPE_SECRET_KEY=sk_test_... STRIPE_CONNECTED_ACCOUNT_ID=acct_... \
  pnpm --filter @codeitlab/marketplace stripe:sandbox
```

Charges, retries with the same idempotency key (must not double-charge), pays
out, and prints a JSON report. Live keys are rejected before any request.

## Model

- **Account** — one email, one role (`coder` or `business`), passwordless login
  with a six-digit code.
- **Coder profile** — name, headline, bio, skills, availability, rate range,
  timezone, links. New profiles start unapproved; `approved` gates public
  listing and matching (an admin can approve, or set
  `MARKETPLACE_AUTO_APPROVE=1` for a demo).
- **Job** — a business describes the work, required skills, budget and timeline.
- **Match** — ranked coders for a job, scored on skill overlap (55%),
  availability (15%), rate fit (15%) and profile completeness/experience (15%),
  each with human-readable reasons.
- **Interest** — a coder applies to an open job with a short message.
- **Engagement** — business picks a coder and an amount; the platform charges the
  business (escrow), the coder delivers, the business approves, and the platform
  pays out `amount - 15%`. Every step is a state transition with a ledger entry;
  there is no way to skip a step and no way to edit an amount after charging.
- **Payments** — behind `PaymentProvider` (`src/server/payments.ts`). The mock
  provider records intents locally and settles instantly; a Stripe provider can
  be added without touching the escrow state machine.

## HTTP surface

Server-rendered pages: `/`, `/coders`, `/jobs`, `/jobs/:id`, `/join`, `/login`,
`/dashboard`, `/admin`. JSON API under `/api`:

```
POST /api/auth/request-code   { email, role }
POST /api/auth/verify         { email, code }        -> session cookie
POST /api/auth/logout
POST /api/auth/tokens         { label }              -> raw token, shown once
GET  /api/auth/tokens                                -> metadata only
DELETE /api/auth/tokens/:id
POST /api/coders/profile      (coder)
GET  /api/coders?skills=&limit=
POST /api/business/profile    (business)
POST /api/jobs                (business)
GET  /api/jobs
GET  /api/jobs/:id
GET  /api/jobs/:id/matches    (business, owner)
POST /api/jobs/:id/interests  (coder)
GET  /api/jobs/:id/interests  (business, owner)
POST /api/engagements         (business) { jobId, coderId, amountCents }
POST /api/engagements/:id/accept   (coder)
POST /api/engagements/:id/start    (coder)
POST /api/engagements/:id/deliver  (coder)
POST /api/engagements/:id/approve  (business)  -> payout
POST /api/engagements/:id/cancel   (either, before delivery)
POST /api/engagements/:id/dispute  (either, after acceptance)
GET  /api/engagements         (current account) -> adds role, jobTitle, counterpartName
GET  /api/engagements/:id/messages?after=  (either party)
POST /api/engagements/:id/messages { body, evidence? }  (either party)
GET  /api/admin/ledger        (admin token) -> totals + entries
POST /api/admin/coders/:id/approve (admin token)
GET  /api/health              (also GET /health)
```

All mutating API calls require a session cookie and the right role. An account
API token created at `POST /api/auth/tokens` works instead of the cookie as
`Authorization: Bearer mk_...`; only its SHA-256 is stored, so the raw value is
shown once. Errors are `{ error, message }` with 4xx statuses. Pages post the
same endpoints with a `form` body and redirect back; no client-side framework.

Messages are append-only and allowed in every engagement status; only the two
participants can read or write them, and a third account gets the same 404 as an
unknown engagement. The `after` cursor is a message id.

The engagement state machine is `requested -> accepted -> in_progress ->
delivered -> paid_out`, with `cancelled` (before delivery) and `disputed` as
alternate ends. A transition from the wrong status, by the wrong party, or a
second approve/payout is a `409`. The admin surface accepts the token as
`Authorization: Bearer ...` or `?token=...`.

When `MARKETPLACE_BASE_PATH=/market`, every generated link, form action,
stylesheet URL, redirect `Location` and session cookie `Path` is prefixed with
`/market`; incoming `/market/*` requests are routed as if the prefix were not
there, so both a stripping and a non-stripping reverse proxy work.

## Tests

`test/` covers fee math, matching order and reasons, the escrow state machine
(happy path, illegal transitions, double payout), auth code expiry and rate
limiting, and HTTP smoke tests through `createApp({ dbPath: ":memory:" })`.
