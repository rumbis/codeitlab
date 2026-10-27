# Vibe-coder marketplace

CodeItLab is free to use. The marketplace is how the people who use it can get
paid for the work they already do with it, and how businesses can find them.

- **People using the app** say they are open to paid work: a short profile with
  skills, availability, rate range and links.
- **Businesses** describe the job they need done. The marketplace ranks the
  coders who fit that job and shows why, then the business picks one.
- **Money** is held by the platform. The business pays when it picks a coder,
  the coder delivers, the business approves, and the platform pays the coder
  minus a **15% platform fee** (or **20%** on the _Assisted_ tier, where
  CodeItLab also helps run the project). Nobody can skip a step and the amount
  cannot change after the charge.
- **The app stays free.** The marketplace takes a cut of paid work, not a
  subscription. Hosted containers on a VPS are planned as a separate paid
  add-on later; nothing in this marketplace depends on it.

Surfaces:

| surface     | URL                            | what it is                                                                                |
| ----------- | ------------------------------ | ----------------------------------------------------------------------------------------- |
| app         | `https://app.codeitlab.com`    | the installable PWA (Android, iPhone, desktop browser); intended origin, not deployed yet |
| site        | `https://codeitlab.com`        | the marketing site and the marketplace entry point                                        |
| marketplace | `https://codeitlab.com/market` | the marketplace service described here                                                    |

The app links out to the marketplace from its Overview card. Self-hosters point
that link at their own mount when building the web app:
`VITE_CODEITLAB_MARKETPLACE_URL=https://work.example.com/market pnpm --filter @codeitlab/web build`.
Only `http(s)` URLs are accepted; anything else (a `javascript:` value in a
stray env file, a bare hostname, a pasted query string) falls back to the public
marketplace, so the value can never become script injection in the anchor.

The PWA links to the marketplace and the site links back to the app, but the
marketplace runs on its own so a static site deploy can never take the money
path down.

## How a job runs

1. A coder opens **Join** (`/market/join`), logs in with an email code, and
   saves a profile. New profiles wait for approval before they appear publicly.
2. A business opens **Jobs** (`/market/jobs`), posts the work with required
   skills, budget and timeline.
3. The business opens the job and sees **recommended coders**, scored on skill
   overlap (40%), declared interest (15%), evidence (15%), availability (10%),
   rate fit (10%), profile completeness (5%) and derived reputation (5%). Each
   recommendation carries the reasons, so a human can disagree — including the
   reputation line, which names paid deliveries and evidence-backed ones.
   The coder directory (`/coders`) filters the same profiles by skills (all
   listed skills), by **declared interest domain** (any listed domain), by
   **availability** and by the coder's own **minimum rate**, and can order by
   derived reputation instead of recency. An unknown availability value is
   ignored rather than showing an empty directory. Reputation order is
   opt-in: the default stays newest-first so a new coder is never hidden, and
   the "proven work first" option says exactly what it sorts on.
4. A coder can **apply** to an open job with a short message. The business sees
   the applications next to the recommendations.
5. The business creates an **engagement** for one coder and an amount. That
   charges the business through the payment provider and puts the money in
   escrow.
6. The coder accepts, works, and marks it **delivered**. The business approves
   it, which records the platform fee and the payout. A dispute or a cancel
   before delivery is an explicit state, not a silent edit.
7. The business can **close** an open job at any time (no fee, no escrow) and
   **reopen** it later; a job with an active engagement cannot be closed (cancel
   the engagement first), and a job removed after a report cannot be reopened by
   its owner — the removal is not reversible from the dashboard.

## Keeping the conversation on the platform

Escrow protects money only while the conversation that leads to money stays here.
The two private messages — a coder's **application** and a business's **invitation**
— refuse contact details (`src/server/contactGuard.ts`): email addresses, phone
numbers and links (`https://`, `www.`, or a bare domain on a common TLD) are
rejected with `off_platform_contact_*` before an engagement exists, and the error
says why. Ordinary text is untouched, so "Node.js", "TypeScript 5" or "3–4 days"
still pass. Public **job descriptions** and **delivery evidence** keep links on
purpose: a brief may point at a product, and evidence is where a repo or a deploy
belongs. The guard is a speed bump, not a lie detector — it makes the normal path
the on-platform path, and a report handles the rest.

## Matching

The ranker is intentionally simple and explainable:

```
score = 0.45 * skill_overlap      # required skills, softened by declared depth
      + 0.15 * interest_alignment # job category is one of the coder's interests
      + 0.15 * evidence_strength  # up to three proof links
      + 0.10 * availability
      + 0.10 * rate_fit
      + 0.05 * completeness
```

- `skill_overlap` is the Jaccard overlap between the job's required skills and
  the coder's skills, case-insensitive. The declared `skillLevels` (1–5, default
  3 when unset) scale it: matching at level 5 counts fully, a listed-but-unrated
  skill counts less.
- `interest_alignment` is 1 when the job's `category` is one of the coder's
  declared `interests` (web, video, data, ops, design, ai, other) — the
  difference between "I can do it" and "I want this kind of work".
- `evidence_strength` is `min(evidence_links, 3) / 3`, so one proof link already
  moves the score and three earn full credit.
- `availability` ranks full time over part time over weekends over unavailable.
- `rate_fit` is 1 when the coder's range intersects the job budget and falls off
  outside it.
- `completeness` rewards a bio, links and a useful skill list.

Every reason string names the number that moved the score (e.g. `After Effects
5/5`, `Declared interest in Video / motion (video)`), so a business can disagree
with a specific claim instead of the whole ranking. Ties break on profile age so
the same job always produces the same order.

## Public numbers

`/numbers` publishes what the marketplace actually did: paid to coders, platform
fees, money currently held in escrow, completed engagements, distinct coders and
businesses paid, average time from engagement start to payout, disputes resolved
and refunds issued. Every figure is a `SUM` over `ledger_entries` (plus counts
over engagements and reports), not an analytics table — the same rows the
reconcile endpoint checks. The page states the fee model plainly (15% standard,
20% assisted, 0% to post, full refunds) and says why it exists: _"If the numbers
on this page ever stop matching the ledger, the ledger wins."_

The fee card links to the **fee calculator** on `/how-it-works#fees`
(`GET /how-it-works?amount=1000`), which shows what each side gets on that
amount for both routes, computed with the same `platformFeeCents`/`payoutCents`
helpers the escrow uses, so the teaching page cannot drift from the money path.
There is one calculator, not two: `/numbers` explains where the money went, and
`/how-it-works` lets a visitor try an amount.

## Your data, in one file

The dashboard has a **Download my data** button; `GET /api/me/export` returns one
JSON file (`content-disposition: attachment`) with the account, profile, jobs
(business) or applications (coder), engagements, ledger entries for those
engagements, ratings written or received, the last 100 notifications and the
signed-in devices. It is generated from the same rows the pages read, is scoped
to the authenticated account (another business's job never appears), and never
contains session tokens or login-code hashes — there is no password material to
export. Leaving is one file, which is the cheapest proof there is no lock-in.

Deleting goes one step further. `POST /api/me/delete` (the dashboard's **Delete
my account** checkbox, confirmation `delete`) refuses while an engagement is
active — escrow must be settled by a human who is about to disappear — then in one
transaction: closes the account's open jobs, hides and empties the coder profile
(`Former member`, no headline/bio/skills/links) or business profile, removes
sessions, push subscriptions and saved searches, and replaces the email with
`deleted+<id>@deleted.invalid`. **Ledger rows and engagements stay** — they are
the accounting record and never contained the email, so the totals still
reconcile. Signing in later with the same address creates a brand-new account:
nothing is restored, and nothing personal is left behind.

## Active sessions

Login is passwordless, so the session cookie is the only proof of identity. The
dashboard lists every live session with a label a person can recognise
("Chrome on macOS", "Safari on iPhone", from the User-Agent recorded at sign-in),
the date it started and when it expires, and marks the current device. Each other
session has a **Sign out** button, plus **Sign out all other devices** when there
is more than one. Revoking deletes the session row, so the next request with that
cookie is `401`; the current session cannot revoke itself (use sign out). Expired
sessions are filtered out and `GET /api/auth/sessions` is scoped to the caller.

## Sign-in alerts and admin session revocation

A passwordless account is only as safe as its sessions. When a sign-in succeeds
from a User-Agent the account has never used before (and the account already has
live sessions), the marketplace emails a security notice: the derived device
label ("Firefox on Linux"), the time, and a link to Active sessions with the
instruction to sign out every device. This mail is **not** governed by the
email-notifications preference — it is the one message a person needs even if
they turned notifications off. First-ever sign-ins do not alert, and a device
that has signed in before does not alert again; the check is per live session,
so expired sessions do not keep a device "known" forever.

For a lost laptop or a suspected takeover, an operator can sign every device out
of one account:

```
curl -X POST -H "authorization: Bearer $MARKETPLACE_ADMIN_TOKEN" \
  "$MARKETPLACE_BASE_URL/api/admin/accounts/<accountId>/revoke-sessions"
# -> {"accountId":"...","revoked":2}
```

It deletes all of that account's sessions (the next request with any old cookie
sees the anonymous page) and writes `account.sessions_revoked` with the count to
the append-only admin audit. Unknown accounts get 404; no token gets 401.

## Account suspension

A report queue is not enough when an account is actively harmful (chargeback
fraud, stolen work, a compromised login). An operator can suspend it:

```
curl -X POST -H "authorization: Bearer $MARKETPLACE_ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"reason":"Chargeback after delivery"}' \
  "$MARKETPLACE_BASE_URL/api/admin/accounts/<accountId>/suspend"

curl -X POST -H "authorization: Bearer $MARKETPLACE_ADMIN_TOKEN" \
  "$MARKETPLACE_BASE_URL/api/admin/accounts/<accountId>/unsuspend"
```

At the top of the admin page is an **Operator snapshot** — counts only, never a
list: accounts (and how many are suspended), approved coders (and how many wait
for approval), open jobs, engagements still holding escrow (and how many are
delivered awaiting release), "needs a human" (open reports + open disputes) and
queued messages (mail + push). It answers the on-call question — _is anything
waiting for me?_ — without printing an email or an id.

The admin page has an **Accounts** search box: type an email fragment and it
shows each match with role, join date, id, Active/Suspended badge, the suspension
reason, and the Suspend/Restore form. `GET /api/admin/accounts?q=` is the JSON
form of the same lookup (an empty query returns nothing, so the surface cannot be
used to page through every account).

Suspension sets `accounts.suspended_at`/`suspended_reason`, **deletes every
session** (so open tabs stop working), and emails the account a safety notice
with the reason and how to appeal. While suspended: `request-code` still answers
the same `200` as always but sends no code (no enumeration signal), `verify`
returns **403 `account_suspended`**, and any session that somehow survives is
deleted on its next authenticated request. Unsuspend restores the account and
the person can sign in normally. Both actions are audited
(`account.suspended` / `account.unsuspended`) with the reason and how many
sessions were revoked.

A wrong-role request never reveals that an email is registered: asking to join as
a coder with an address that already owns a business account answers the same
`200` as a new address and sends the code to the account's real role, so the
form cannot be used to enumerate accounts or learn their role. The dashboard
shows the role after login; an account's role cannot be changed. `verify` is
uniform for the same reason: an unknown address and a known one with no live
code both answer `401 no_active_code`, so the login endpoint is not an
account-existence oracle either.

The admin token itself is rate-limited: a wrong token counts against the peer
(20 failures/hour) and the 21st attempt gets **429 `rate_limited`**. A valid
token never consumes that bucket, so an operator is not locked out by someone
else guessing.

## Abuse reports

A marketplace that takes 15–20% has to be safe to stand in. Any signed-in user
can report a job or a coder profile from the page itself ("Report this job" /
"Report this profile"); the form asks one reason (scam, spam, harassment, stolen
work, impersonation, other), one optional paragraph, and says exactly what
happens next:

- **A person reads it, not a model.** Reports land in the operator queue with the
  reporter's email on them.
- **The reported party is never told who reported them** — retaliation is not a
  feature.
- **The reporter hears back** when it is resolved, in the activity feed and by
  push if enabled.

Operators resolve a report as `dismissed`, `job_removed` (the job leaves the
list) or `coder_unapproved` (the profile leaves the directory and its public page
returns 404). A resolution that does not fit the target kind is rejected, every
resolution is written to `admin_audit`, and one account may file at most
`MARKETPLACE_REPORT_LIMIT_PER_HOUR` (default 20) reports per hour. A duplicate
open report for the same target returns `409 already_reported`; self-reports are
`400 self_report`.

## Email notifications (opt-in, action-only)

The feed is the default and push is per device; email is the third channel, and
it is **off by default**. The dashboard toggle ("Also email me about invitations,
deliveries, approvals and disputes") stores `accounts.email_notifications` and
only these kinds are ever emailed: `application`, `engagement`, `invite`,
`delivery`, `approved`, `resolved`, `disputed` — a dispute freezes escrow until a
human acts, so it is not something to learn about by refreshing. Informational
kinds (`scope`, `shortlist`, `review`, `cancelled`) stay in the feed. Each message goes through the same
`email_outbox` as login codes — with an absolute link built from
`MARKETPLACE_BASE_URL`, one line saying why it arrived, and a line saying it can
be turned off at `${MARKETPLACE_BASE_URL}/dashboard#notifications` (the dashboard
section carries that anchor, so the link lands on the exact switch),
be turned off — and is delivered by the same `POST /api/admin/mail/drain` cron,
never inline with the action that triggered it. Login codes are always emailed
regardless of this setting.

## Web Push (no dependency, no plaintext)

Notifications already land in the in-app feed; Web Push adds the same events on
the device, even with the tab closed. The implementation is built on WebCrypto
and two RFCs, with no npm package in the path:

- **VAPID (RFC 8292)** signs every request with an ES256 JWT (`aud`, `exp`, `sub`);
  the browser's push service verifies it against the public key.
- **aes128gcm (RFC 8291)** encrypts the payload to the subscription's `p256dh`
  key with an ephemeral ECDH key and HKDF-derived AES-GCM keys. The push service
  only ever sees ciphertext — the notification text never leaves the server in
  the clear.

Operators generate a pair once with `pnpm --filter @codeitlab/marketplace push:keys`
and set `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` (a `mailto:` or
`https:` contact). Without them the API reports `enabled: false` and the dashboard
says push is off instead of showing a dead button.

The browser side is a dashboard switch ("Enable notifications", no marketing
ever): it asks permission, subscribes through the existing service worker, and
posts `{endpoint, keys}` to `/api/push/subscribe`. The service worker handles
`push` (shows the notification) and `notificationclick` (focuses the tab or opens
the href). The server validates the subscription (endpoint http(s), `p256dh` 65
bytes, `auth` 16 bytes) before storing it.

Delivery is queued, not inline: `notify()` writes a row to `push_outbox`, and
`POST /api/admin/push/drain` (run from cron, like the mail/outbox drains) sends
each pending row to every subscription on that account. A `404`/`410` from the
push service deletes the dead subscription; other failures back off
`30s·n²` up to an hour and keep `last_error`. `GET /api/admin/push` reports
`enabled`, `subscriptions`, `pending`, `delivered`, `failed`.

## Authorization matrix

Security is not a header list; it is every route answering the same question the
same way. `test/authorization.test.ts` walks the surface as a stranger, the wrong
business, the wrong coder and an admin, and asserts:

- private API routes answer `401` without a session (notifications, jobs,
  engagements, quests, admin ledger, mail drain);
- a business cannot see another business's matches, cannot apply, and a coder
  cannot post a job or start an engagement;
- every engagement action is refused to non-parties and to the wrong party of
  the same engagement (`403 wrong_role` — this round changed those from `409`,
  because an authorization failure is not a state conflict);
- notifications and engagement lists are scoped to the caller, and marking read
  cannot clear someone else's unread count;
- profile creation is role-bound; cross-origin writes are `403 cross_origin`
  while same-origin writes pass; a form `redirectTo` can never leave the origin;
- the session cookie is `HttpOnly`, `SameSite=Lax`, `Secure` under HTTPS, private
  pages are `no-store`, and HTML carries CSP/`frame-ancestors 'none'`/nosniff.

Every rule is a test, so a later refactor that opens one of these doors fails the
suite instead of production.

## Disclosure and crawling

`/.well-known/security.txt` (RFC 9116) publishes the contact address, a one-year
expiry and an absolute canonical URL; `MARKETPLACE_SECURITY_CONTACT` overrides
the address. `/security` is the readable policy page — scope, out of scope, and
what we already do. `robots.txt` allows the pages a stranger should find (job
board, coder directory, how it works) and disallows `/admin`, `/api/`,
`/dashboard` and `/login`, because those only make sense for a signed-in person.
`/sitemap.xml` lists exactly those public pages plus every **open job** and
**approved coder profile**, as absolute URLs built from the same queries the
pages use (so a pending profile or a closed job never appears); `robots.txt`
points at it, and the mount path is kept once (`/market/jobs`, never
`/market/market/jobs`). Solo practitioners get a profile that search engines can
actually find, which is the discovery half of "work for people with vision".

## Transport limits

The app rejects bodies over 64 KiB, but by the time `request.text()` runs the
whole body is already in memory — so the **socket** enforces the limit first.
`src/server/transport.ts` streams the request and stops as soon as the total
passes 64 KiB, answering **413 `payload_too_large`** and closing the connection
(measured: a 200 KB body is rejected in ~5 ms without buffering it). The Node
server also sets `headersTimeout` 15 s, `requestTimeout` 30 s and
`keepAliveTimeout` 5 s, so a stalled or slow-writing client cannot hold a socket
forever. Both limits are unit-tested.

## Money-path rate limits

Actions that cost something real are guarded per account with a sliding one-hour
window (`rate_events`), **after** validation and before the work happens — a
stolen session or a runaway client cannot grind the payment provider, hammer the
state machine, or flood the board. Defaults: **10** escrow charges per business,
**120** engagement actions per account, **60** invitations per business, **20**
abuse reports per account, **10** job posts per business and **30** applications
per coder, each per hour. Configure with `MARKETPLACE_CHARGE_LIMIT_PER_HOUR`,
`MARKETPLACE_TRANSITION_LIMIT_PER_HOUR`, `MARKETPLACE_INVITE_LIMIT_PER_HOUR`,
`MARKETPLACE_REPORT_LIMIT_PER_HOUR`, `MARKETPLACE_JOB_POST_LIMIT_PER_HOUR` and
`MARKETPLACE_APPLICATION_LIMIT_PER_HOUR`. Invalid requests (bad amount, wrong
owner, closed job, a typo in a job form) are rejected before the guard, so they
never consume quota; a 429 answers `{ error: "rate_limited", message }`. These are
abuse guards, not fraud detection: the limits are high enough that a person doing
real work never meets them.

## How it works (public page)

`/how-it-works` is the two-minute explanation a business can read before it
trusts the marketplace with money: the six escrow states with who acts next, the
two exits (cancel refunds; dispute waits for an operator and ends refunded or
released), what the platform takes and when, why evidence is the product, a
short "what we never do" list, and a **"Where AI is — and is not"** section: the
ranking is arithmetic with readable weights, no model approves a delivery, sets a
fee or moves money, and AI only helps draft/scope an assisted job. The
auto-release bullet and window follow `MARKETPLACE_AUTO_RELEASE_DAYS`, so the
page cannot promise a release the deployment does not do. The fee table is not copy — it is computed from
`FEE_TIER_BPS` and `platformFeeCents`/`payoutCents` for an amount the visitor
types (default €1,000, hostile input clamped), so the page cannot drift from the
money code. The only form on the page is a GET calculator: nothing there can
charge, approve or move escrow. It is linked from the main nav and the home page.

The fee sentence on `/numbers` is written against the code, not a template: the
fee is deducted from the amount the business funds (€1,000 → €150 fee, €850 to
the coder), so the page says that instead of the usual "on top of the price"
claim. A test asserts the wording and the absence of the wrong one.

## Quest board

`/api/quests` (and the top of the dashboard) turns the product's mechanics into
a short checklist derived from real work, not clicks. A coder walks publish
profile → declare interests → add evidence → apply → deliver a paid engagement →
deliver with proof → reach Trusted reputation → save a job search → get a rating. A business walks company profile →
post a job → fund escrow → approve a delivery → approve from evidence → turn on
notifications → rate the work. Each quest
carries a 60-second lesson explaining the mechanic it gates (escrow, match
weights, evidence, derived reputation) and the capability it unlocks. Done is
computed from the database, so the board can never congratulate someone for
nothing; there are no points, no streaks and no nags. The last two coder quests
are deliberately about proof and reputation: the mechanics that make approval and
hiring decisions defensible.

## Money

All amounts are integer cents in a single currency per engagement. The fee is
computed in one place (`platformFeeCents` in
[`apps/marketplace/src/shared/contracts.ts`](../../apps/marketplace/src/shared/contracts.ts)):

```
fee_bps = 1500 (standard) | 2000 (assisted)   // stored on the engagement row
fee     = round(amount * fee_bps / 10000)
payout  = amount - fee
```

Ledger entries are append-only: `charge` when the engagement is created,
`platform_fee` and `payout` when it is approved, `refund` on a cancel that
already charged. The admin view totals those entries and never shows card data.

Payments sit behind a `PaymentProvider` interface
([`apps/marketplace/src/server/payments.ts`](../../apps/marketplace/src/server/payments.ts)).
The default `mock` provider settles instantly, stores an opaque reference and
honours idempotency keys, so the whole flow works locally and in tests without
keys. The `stripe` provider is implemented behind the same interface:

- `charge` → `POST /v1/payment_intents` (automatic capture, money lands in the
  platform balance), `payout` → `POST /v1/transfers` to the connected account.
- Every call carries an `Idempotency-Key` derived from the engagement
  (`engagement:<id>:charge` / `:payout`), so a retried request cannot move money
  twice.
- A decline surfaces as `402` with the provider's code (`card_declined`) and the
  engagement reservation is released — no ledger entry, no stuck job.
- The service refuses to start with `PAYMENTS_PROVIDER=stripe` unless
  `STRIPE_SECRET_KEY` and `STRIPE_CONNECTED_ACCOUNT_ID` are set.

Tests run the provider against a local fake Stripe server (`node:http`), so the
request shape, auth header, idempotency key, decline path and the full
escrow-through-provider flow are verified without network access or keys.

## Running it

```bash
# app: server + web, the usual dev flow
vp run dev

# marketplace only
cd apps/marketplace
node src/server/main.ts            # http://127.0.0.1:4174, prints login codes to stdout
vp test run
tsc-rs --noEmit
```

Environment: `PORT`, `MARKETPLACE_DB`, `MARKETPLACE_BASE_PATH` (set `/market`
behind the reverse proxy), `MARKETPLACE_BASE_URL`, `MARKETPLACE_ADMIN_TOKEN`,
`MARKETPLACE_AUTO_APPROVE`, `PAYMENTS_PROVIDER`, `PAYMENTS_WEBHOOK_SECRET`,
`STRIPE_SECRET_KEY`, `STRIPE_CONNECTED_ACCOUNT_ID`, `STRIPE_API_BASE` (tests),
`MARKETPLACE_COOKIE_SECURE`, `MARKETPLACE_TRUST_PROXY`,
`MARKETPLACE_NOTIFY_WEBHOOK`, `MARKETPLACE_NOTIFY_SECRET`,
`MARKETPLACE_MAIL_TRANSPORT`, `MARKETPLACE_MAIL_WEBHOOK`,
`MARKETPLACE_MAIL_SECRET`, `MARKETPLACE_CHARGE_LIMIT_PER_HOUR`,
`MARKETPLACE_TRANSITION_LIMIT_PER_HOUR`, `MARKETPLACE_INVITE_LIMIT_PER_HOUR`,
`MARKETPLACE_REPORT_LIMIT_PER_HOUR`, `MARKETPLACE_AUTO_RELEASE_DAYS`,
`MARKETPLACE_MAINTENANCE_MINUTES`,
`MARKETPLACE_JOB_POST_LIMIT_PER_HOUR`,
`MARKETPLACE_APPLICATION_LIMIT_PER_HOUR`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
`VAPID_SUBJECT` (Web Push; see below).

Rate limiting identifies clients by the **socket address**, which the HTTP server
writes into `x-marketplace-peer` and a client cannot spoof. `x-forwarded-for` and
`x-real-ip` are ignored unless `MARKETPLACE_TRUST_PROXY=1` is set behind a real
reverse proxy — otherwise any client could rotate a fake header and get a fresh
login-code bucket per request.

Schema migrations (applied in order on open): 1 core, 2 one active engagement per
job, 3 profiles/interests/skills/evidence, 4 fee tiers + webhook inbox, 5 delivery
note/evidence, 6 dispute resolution, 7 admin audit, 8 activity feed, 9 outbox,
10 mail outbox, 11 rate events, 12 ratings, 13 job invites, 14 assisted jobs,
15 push subscriptions + push outbox, 16 abuse reports, 17 session user agents,
18 email notification opt-in, 19 account suspension, 20 saved job searches,
21 account deletion (email scrubbed, ledger kept), 22 coder alerts.

## Assisted tier

The 20% assisted fee is not a label on the same product. On an assisted
engagement, a delivered engagement enters an operator queue (`/admin` →
"Assisted deliveries waiting for review") with the delivery note and every
evidence link, and the operator records what the evidence showed
(`POST /api/admin/assisted/:id/review`, note 10–1000 chars). The review is
**advisory and audited**: it writes an `assisted.review` admin-audit entry,
notifies both sides, and never changes the status or the ledger — escrow still
releases only on approval or a dispute decision. Standard engagements cannot be
reviewed this way (`409 not_assisted`), and only `delivered` ones can
(`409 not_delivered`). The hire form explains both tiers next to the choice, so
the buyer knows what the extra five percent buys before charging escrow.

## Delivery evidence

A delivery is not a button, it is a claim with proof. When the coder marks work
delivered, the form carries a **note** (what is done, where it lives, how to
check it) and up to **five evidence links** (repos, deploys, recordings, docs).
Both are validated before anything is written — http(s) only, deduplicated, at
most five links and 2000 characters of note — so a rejected delivery leaves the
engagement `in_progress` and the coder can fix the links and retry.

The business sees the note and the links on the engagement panel _before_ the
approve button, with one line of context: approval releases the escrow. That is
the whole trust design of the marketplace in one screen: the platform does not
ask anyone to trust a status flag, it shows the evidence the money is being
released against. Evidence is retained after payout and never feeds the ledger,
so the money path stays exactly as reconciled.

Every engagement card also carries one **next-step line** derived from its state
("Waiting for the coder to start", "Waiting for the business to check the
evidence and approve or dispute", "Done: the fee and payout are in the ledger")
and, while a delivery is waiting, the **auto-release date** and the amount that
will move — the lesson sits where the state is, not on a help page.

## Reputation

Reputation is **derived from engagements**, never stored and never self-declared:
paid deliveries, payout cents, deliveries that carried evidence links, refunded
disputes, and businesses that came back for a second engagement. The coder
dashboard and the directory card show the same numbers, so there is nothing to
game — the only way to change the record is to deliver paid work and attach
proof.

Levels are `New → Proven → Trusted → Expert` (0, 1, 3-with-evidence, 8-clean
paid deliveries). Four badges carry a one-sentence lesson each: first delivery,
evidence backed, repeat client, dispute free. A refunded dispute is the only
thing that can lower the record, and it only removes the dispute-free badge —
the completed work stays true. `src/server/reputation.ts` loads all summaries for
the directory in two queries, so the cards stay cheap to render.

## Assisted jobs

The 20% assisted tier is not just a fee label: the business marks a job
"Ask CodeItLab to help run this project" when posting, and an operator then

1. writes a **scoping note** — what "done" means, which skills actually matter,
   what to check in the delivery — visible to the business on the job page, and
2. **shortlists up to three coders** from the ranked matches; both the business
   and the shortlisted coders are notified, and the job page marks them
   "Operator pick".

Both are advisory: the operator never hires, never approves and never moves
money — the business still chooses, pays and approves. A job marked assisted
uses the 20% tier when an engagement starts (the standard tier is refused with
`assisted_tier_required`), which is what makes the promise honest: the fee pays
for the help that actually happened. Admin routes:
`POST /api/admin/assisted/jobs/:id/scope` and
`POST /api/admin/assisted/jobs/:id/shortlist` (admin token, audited like the
rest of the admin surface).

## Public coder profiles

Every directory card, match card and application now links to `/coders/:id`: a
public profile with the bio, skills and declared depth, the fields the coder
wants to work in, evidence links, the derived track record (paid deliveries,
evidence deliveries, repeat clients, earned, level and badges with their
lessons), and the ratings written after payout. Nothing on it is self-reported
except the profile text itself — a stranger can judge the work from what the
ledger already proves, and a coder can send the URL to a client.

Pending profiles return 404 to strangers (so nobody is exposed before review)
but the owner sees a "Pending review" preview. The page is crawlable, which is
the point: work and people should be findable.

## Saved searches and job alerts

A coder who filters `/jobs` can press **Save this search** (up to 10 per account,
at least one filter required, duplicates rejected). The dashboard lists each one
with its current match count, a link back to the exact filter and a Remove
button. `POST /api/admin/job-alerts/run` — also a button on the admin page —
checks every saved search for jobs posted **since that search's last check**,
writes one `job_alert` notification per search with a count and the first title,
and moves the watermark. The same jobs are never announced twice, and the sweep
only writes notifications: it never emails (the email channel stays reserved for
money and invitations) and never touches a job.

```cron
*/15 * * * * curl -fsS -X POST -H "authorization: Bearer $ADMIN_TOKEN" https://codeitlab.com/market/api/admin/job-alerts/run
```

## Job templates

A business without time can start from one of four **templates** on the dashboard
(`/dashboard?template=landing-page|video-edit|data-cleanup|ops-automation`): each
fills title, description, skills, field, budget range and timeline, and shows
what a complete brief looks like ("definition of done", deliverables, an honest
budget range). The template **only prefills the form** — nothing is published
until Publish, every field stays editable, and an unknown id is ignored. A repeat
hire takes precedence over a template. The values are ordinary job fields, so a
template-prefilled post goes through exactly the same validation as a hand-written
brief.

## Coder alerts (the business mirror)

The side with no time should not have to browse either. A business can **watch
for coders** from the dashboard: any combination of skills (all required), an
interest domain and a maximum rate — at least one filter, at most 10 watches,
duplicates refused. The sweep (`POST /api/admin/coder-alerts/run`, part of
`app.sweep()` and the maintenance loop) notifies the business once per watch
about **newly approved** coders who fit since the last check, with a link to the
same filtered `/coders` view. Feed and push only, never email; it never changes a
ranking, and the watermark makes repeated runs idempotent.

## Job search

`/jobs` (and `GET /api/jobs`) accepts `q`, `category` and `minBudget`. Search is a
case-insensitive `LIKE` over the title, description and skills the business
actually wrote; `category` must be one of the seven job fields (an unknown value
is ignored, not an error) and `minBudget` is euros compared against the job's
maximum budget. Filters are shown in the form, the count says "matching your
filters", and `Clear` returns to everything. No ranking, no click tracking: a
person looking for something specific should be able to find it.

## Job board pages

`/jobs` pages **20 open jobs at a time** (`?page=2`), with "Page 2 of 3 · 47 open
jobs" and Previous/Next links that keep the active filters. The total comes from
a `COUNT(*)` on the same filter, so the page never loads the whole board to count
it; a hostile or stale `page` (99, `-3`, `two`) is clamped to the last real page
instead of showing an empty board.

## Recommendations and the business track record

A coder's dashboard gets **"Jobs for your declared interests"**: open jobs that
overlap the skills and fields the coder declared, with the overlap named next to
each one ("Matches your skills: After Effects", "Field you want: video"). The
score is 60% skill overlap + 40% declared field; jobs already applied to are
excluded, and there is no click history, no model and no hidden ranking. It is
the payoff for declaring interests at all.

Every job page also shows the business's **track record**, derived only from
`paid_out` engagements: "Has paid out 3 engagements through escrow since
2026-01", or for a new business: "no completed engagements yet. Escrow still
protects you — the money is charged when the engagement starts and held until
they approve." A requested or delivered engagement does not count; a coder can
check whether this business has actually paid anyone before saying yes.

## Repeat hire

The hardest part of a marketplace for busy companies is finding someone again.
After an engagement is approved or paid out, the business dashboard shows
**"Hire <name> again"**; it opens the job form prefilled with the old brief
(title, description, skills, field, budget, timeline) plus a note that this is a
new posting with new escrow. Publishing with that `repeatEngagementId` creates a
fresh job and **invites the same coder in the same step**, so the person they
already trust gets a notification instead of having to notice the listing. Only
the business that owns the engagement can prefill from it, and only an
`approved`/`paid_out` engagement is offered; a delivered-but-unapproved one still
goes through the normal flow. If the invite fails (coder paused, already
invited), the job is still published — the two steps are not coupled.

## Invitations

The business can reach out first: on a job page, every ranked coder has an
"Invite to apply" form (with an optional 300-character note). It sends a
notification and shows the job under "Invitations" on the coder's dashboard.
An invitation is deliberately **not** an application — the coder still chooses
to apply, so the record of interest stays something the coder declared. The
business sees "Invited ✓" instead of the form for coders it already invited, one
invite per coder per job, and 60 invitations per business per hour by default
(`MARKETPLACE_INVITE_LIMIT_PER_HOUR`).

## Ratings

After a payout, the paying business can leave one rating — a score from 1 to 5
and an optional sentence — for the engagement it just closed. The order is the
point: the form appears only once the money has moved, so a score can never be
used to negotiate a refund or pressure a coder into rework. One rating per
engagement, written only by the business that paid; the coder is notified and
the score appears on their directory card, on job match cards, and in the
dashboard (average plus the last three comments).

Ratings are separate from the derived reputation record: reputation is what the
platform can prove from money and evidence, a rating is what the client thought.
Both are shown together, because a business wants the proof and the opinion.
`GET`-free and CSRF-checked like every other form, and the score is validated
1–5 server-side; the directory loads all averages in one grouped query.

## Dispute resolution

A dispute is the reverse state of approval: the money stays in escrow and nobody
can move it by clicking again. Only an operator with `MARKETPLACE_ADMIN_TOKEN`
can close it, and only in one of two ways:

- **refunded** — the escrow returns to the business (same money movement as a
  cancellation, recorded as a `refund` ledger entry), and the job reopens.
- **released** — the escrow pays the coder through exactly the same provider
  path as a normal approval (`platform_fee` + `payout`), so the reconcile
  invariant is identical.

Both require a **note of at least 10 characters** explaining the decision; it is
stored on the engagement with the outcome and shown to both parties. The
compare-and-set on `status = 'disputed'` means a second resolution attempt loses
and returns `409 illegal_transition` — the provider is never called twice. If the
payout provider declines, the engagement stays `disputed`, no ledger entry is
written, and the operator can retry.

The admin page lists open disputes with the delivery note attached and two
buttons, so the decision is made from evidence rather than from who complained
first.

## Payment sandbox

The Stripe adapter is tested against a fake API in CI, but a real test-mode
account is the only way to prove the contract end to end. One command does it:

```bash
STRIPE_SECRET_KEY=sk_test_... STRIPE_CONNECTED_ACCOUNT_ID=acct_... \
  pnpm --filter @codeitlab/marketplace stripe:sandbox
```

It charges a small amount, retries the **same** charge with the same
`Idempotency-Key` (the retry must return the same reference, not a second
intent), then pays out the amount minus the 15% fee, and prints a JSON report
with three checks. `--mock` runs the identical checks with no key at all, so the
harness itself is verifiable offline. A live key (`sk_live_...`), a missing key
or a non-test key is rejected **before any request** with exit code 2 — a script
that moves money must never be able to run in live mode by accident.

## Payment webhooks and reconciliation

`POST /api/payments/webhook` accepts Stripe-style events
(`t=<unix>,v1=<hex hmac>` over `${t}.${rawBody}`, five-minute tolerance, constant
time compare). The raw body is verified **before** parsing, the event is stored
once in `payment_events`, and a replay is acknowledged as `duplicate: true`
instead of being processed twice. Without `PAYMENTS_WEBHOOK_SECRET` the route
answers `503`, so a deployment cannot accidentally accept unsigned events.

`GET /api/admin/reconcile` (admin token) compares every engagement's ledger with
what the state machine promises — a charge, then either fee+payout or a refund —
and names each mismatch (`payout: expected 10200 cents, ledger has 20400`)
instead of silently summing. The admin page renders the same report at the top:
a green "All N engagements balance across M ledger entries" badge, or the list of
offending engagements with their details. It is read-only and safe to run against
production; run it before payouts and from a nightly job.
See the [marketplace README](../../apps/marketplace/README.md) for the full
surface.

## Auto-release when a business goes quiet

A reminder is not a remedy: if the business never answers, the coder who already
delivered is still unpaid. After **14 days** (`MARKETPLACE_AUTO_RELEASE_DAYS`,
0 disables) with no approval and no dispute, `POST /api/admin/auto-release/run`
releases the escrow through the **same `releaseEscrow` path as a manual
approval** — same compare-and-set, same `platform_fee` + `payout` ledger rows,
same reconciliation — and records `escrow.auto_released` in the admin audit. A
provider failure leaves the row `delivered` so the next run retries; the
compare-and-set makes a double release impossible. Both parties are notified,
the engagement stores the resolution note, and the public how-it-works page
states the window it is running with. Run the sweep from cron next to the
reminder sweep.

## The entrypoint is tested, not assumed

`test/server-entry.test.ts` boots `src/server/main.ts` as a real child process on
a free port with a temporary database and `/market` mount, waits for `/health`,
then checks the security headers, `cache-control: no-store`, the `/market`-prefixed
links, a parseable `/app.js`, the manifest scope and the sitemap origin before
signalling it to stop. The unit suite calls `createApp` directly, so this is the
only test that covers the body collector, static assets and base-path wiring the
process actually runs with.

## Lint and generated browser code

The marketplace passes `vp lint` with zero warnings. The generated `app.js`
(service-worker registration and push subscription) is a string in `pwa.ts`, so
a stray backslash is invisible to the type checker and fatal in the browser:
`/app.js` is compiled with `new Function()` in a test to prove it parses, and the
base64url regexes are asserted literally.

## End-to-end smoke

`pnpm --filter @codeitlab/marketplace smoke` runs one pass over the real request
handler with a throwaway in-memory database and a mock provider: code sign-in for
two accounts, profile created unapproved then approved, job posted, application,
escrow funded, accept/start/deliver/approve, printable receipt, ledger totals
(charge €120, fee €18, payout €102, held 0) and `/health` schema 23. It prints
one line per step and exits **1** at the first failure, so it can gate a deploy
right after `doctor`. It never touches the host's database, files or provider.

## Backups

`pnpm --filter @codeitlab/marketplace backup` (or `node scripts/backup.ts
--dir=/var/backups/codeitlab`) makes a **consistent copy of the live SQLite
database without stopping the server**: `VACUUM INTO` reads under one
transaction and writes a defragmented file, so it can run next to the
maintenance loop. The copy is reopened read-only and checked with
`PRAGMA integrity_check`; the script prints the path, size, table count and
schema version as JSON and exits **1** when the copy is not usable. `--dir`
defaults to `MARKETPLACE_BACKUP_DIR` or `.data/backups`, and `MARKETPLACE_DB`
must point at a real file (an in-memory database refuses instead of writing an
empty backup). Schedule it from cron next to the maintenance loop and keep the
copies off the same disk — the ledger is append-only, but the disk is not.

The same function is on the admin page (**Back up now**, `POST
/api/admin/backup/run`) and writes an `admin_audit` row (`backup.run`, path and
integrity) so an operator snapshot is never a mystery. It answers **409
`in_memory_database`** when the process has nothing on disk to copy.

## The admin surface

`/admin` is guarded by `MARKETPLACE_ADMIN_TOKEN`. The token can arrive as a
bearer header (scripts), as `?token=` (a bookmark), or — the normal browser path
— once in the address bar, after which the page trades it for a **short-lived
HttpOnly, SameSite=Strict cookie** signed with HMAC-SHA256 over the token. The
token is therefore never repeated in the page's form actions, is not readable
from scripts, and rotating the token invalidates every admin cookie at once. The
page itself is sent with `referrer-policy: no-referrer` and
`x-robots-tag: noindex, nofollow`, and the same-origin check still guards every
admin POST. A forged cookie is a failed attempt and counts against the admin
failure rate limit.

## Receipts

`GET /engagements/<id>/receipt` is a printable record for the two people who
paid and were paid: parties, job, amount held, the fee with its tier, the coder
payout, the payment reference and every ledger row for that engagement. It is
participant-only and answers **404** to a stranger rather than 403, so an
engagement id cannot be probed; anonymous requests get the normal sign-in
redirect. It is deliberately **not a tax invoice** — the platform is not the
seller of the work — and the page says so; the accountant pairs it with the
operator ledger CSV. A `@media print` block drops the nav and buttons so the
browser's "Save as PDF" produces a clean page. The engagement card links to it
for both roles.

## Ledger CSV for the accountant

`GET /api/admin/ledger.csv` (admin token) downloads every ledger entry as RFC
4180 CSV — `entry_id, created_at, engagement_id, kind, amount_cents, currency,
note` — with `content-type: text/csv` and an attachment filename. The admin page
links it from the Ledger section. Cells are quoted properly, and a cell starting
with `=`, `+`, `-`, `@`, tab or CR is prefixed with a single quote so a spreadsheet
cannot execute it: the note on a charge contains the job title, which is user
input. That is the whole CSV-injection class handled where the export is built,
not trusted to whoever opens the file.

## One maintenance loop

A single-binary deployment should not need an external cron. Set
`MARKETPLACE_MAINTENANCE_MINUTES` (default **0** = manual only) and the server
runs one pass every N minutes that calls, in order: waiting-delivery reminders,
saved-search job alerts, coder alerts for businesses and stale-delivery
auto-release. The loop is a
`setTimeout` chain, not `setInterval`, so a slow provider cannot stack sweeps; a
failing pass is logged and the loop continues; the timer is unref'd and stopped
on SIGINT/SIGTERM. `app.sweep()` is the same function, callable directly from a
cron or a test. The manual endpoints and admin buttons remain available and are
idempotent between runs.

## Waiting-delivery reminders

A coder can deliver and then wait days because the business lost track — the
money is already in escrow, so the person who did the work is the one paying for
the silence. `POST /api/admin/reminders/run` (also a button on the admin page,
under "Deliveries waiting on a business") finds engagements that are `delivered`
for more than **3 days** and notifies the business: how long it has waited, the
amount still in escrow, and that approving pays the coder. The same delivery is
reminded at most once per **48 hours**, the reminder is a normal `delivery`
notification (so it also follows the business's push/email preferences), and the
endpoint never approves, pays or mutates an engagement. Run it from the same
cron as the queues if you want it automatic:

```cron
*/30 * * * * curl -fsS -X POST -H "authorization: Bearer $ADMIN_TOKEN" https://codeitlab.com/market/api/admin/reminders/run
```

## Activity feed

Every state change that changes whose turn it is writes one row into
`notifications` for the party who has to act next: an application tells the
business, funded escrow tells the coder, a delivery tells the business, an
approval tells the coder, a cancellation and a dispute tell the other side, and a
resolved dispute tells both parties the outcome and the reason. The row is
written in the same transaction as the change, so the feed cannot drift from what
actually happened.

The dashboard shows the latest ten with an unread count and a "Mark all read"
button; `GET /api/notifications` returns the same feed as JSON and
`POST /api/notifications/read` clears it. The feed is the record; external
delivery is the outbox below, and login codes use the separate mail outbox.

## Installable app (PWA)

`/manifest.webmanifest`, `/icon.svg`, `/app.js`, `/sw.js` and `/offline` make the
marketplace installable on a phone, which is where a coder checks a delivery.
The cache policy is deliberately boring because this app shows money and account
state: the worker precaches only `styles.css`, the icon and one static offline
page; navigations are network-first (so a page is never a stale copy of someone
else's dashboard), and nothing under `/api/` is cached or replayed. Non-GET
requests are ignored entirely — escrow and approvals only happen on the server.
`/sw.js` is served `no-cache` so a new version can take over, and every generated
URL respects `MARKETPLACE_BASE_PATH`. Pages keep working with JavaScript off: the
only script is the deferred service-worker registration.

The manifest also publishes launcher **shortcuts** — Open jobs, My dashboard and
Public numbers — each built from the base path, so a long-press on the installed
icon goes straight to the right page. In-app, every engagement notification (push
and feed) links to `#engagement-<id>` and the engagement card carries that id, so
a delivery notification opens the exact card that needs an approval instead of
the top of a long dashboard. The service worker's `notificationclick` focuses an
existing window at that URL or opens a new one.

### Tunnel verification (2026-10-24)

The marketplace was run behind a throwaway Cloudflare quick tunnel
(`cloudflared tunnel --url http://127.0.0.1:4180`) with
`MARKETPLACE_BASE_PATH=/market`, `MARKETPLACE_BASE_URL=https://<tunnel>/market`,
`MARKETPLACE_COOKIE_SECURE=1` and a fresh database, then driven with `curl` over
HTTPS (no browser). Evidence:

| Check                                                     | Result                                                                                                                                     |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /market/`, `/market/jobs`                            | 200, HTML rendered                                                                                                                         |
| `GET /market/engagements/<id>/receipt`                    | printable receipt (participants only)                                                                                                      |
| `GET /market/api/health`                                  | `{"ok":true,"service":"marketplace","schemaVersion":22}` (schema version = last applied migration, a readiness signal)                     |
| `GET /market/manifest.webmanifest`, `/market/sw.js`       | 200, `start_url`/`scope` `/market/`, precache paths `/market/...`                                                                          |
| Response headers                                          | `strict-transport-security`, CSP (`default-src 'self'`, `frame-ancestors 'none'`), `x-frame-options: DENY`, `referrer-policy: same-origin` |
| Login (`request-code` → code from the dev log → `verify`) | 200, `market_session` cookie `HttpOnly; SameSite=Lax; Secure; Path=/market`                                                                |
| `GET /market/dashboard` with that cookie                  | 200, account email rendered                                                                                                                |
| `POST /market/api/jobs` with the tunnel `Origin`          | 201, job created                                                                                                                           |
| `GET /market/jobs?q=booking`                              | the new job is listed                                                                                                                      |
| Same POST with `Origin: https://evil.example`             | **403 `cross_origin`**                                                                                                                     |
| `/market/robots.txt`, `/market/.well-known/security.txt`  | served, `Canonical:` uses the tunnel base URL                                                                                              |

That is the remote-ready path: HTTPS, secure cookies, base-path-aware URLs,
CSRF enforced against the public origin, and PWA assets correct under a prefix.
The quick-tunnel hostname is disposable and was stopped after the check; a named
tunnel or a real domain should be used for a staging deployment.

## Login mail

Login is passwordless, so the code has to reach the user. In dev
(`MARKETPLACE_DEV_EMAIL=1`) it is printed. In production the operator names a
transport: `MARKETPLACE_MAIL_TRANSPORT=webhook` posts
`{event, to, subject, text}` to `MARKETPLACE_MAIL_WEBHOOK` (any Resend/Postmark/
SES relay), signed with `x-codeitlab-signature` when `MARKETPLACE_MAIL_SECRET`
is set — the same scheme as payment and activity webhooks. The app **refuses to
start** with `MARKETPLACE_DEV_EMAIL=0` and no transport, because otherwise login
codes would be generated and never delivered.

Delivery is attempted inline (a login that waits for a cron feels broken). If the
gateway is down or slow (5s timeout), the message is written to the
`email_outbox` instead of failing the request — the caller still gets the same
`200` either way, so the response does not reveal whether an address exists.
`POST /api/admin/mail/drain` retries with attempt counts, the last error and a
backoff capped at one hour; `GET /api/admin/mail` shows pending/delivered/failed.
Run the drain from cron every minute. The code never appears in an HTTP response.

## Outbox (external notifications)

Setting `MARKETPLACE_NOTIFY_WEBHOOK` turns every activity row into a durable
outbox entry (`notification_outbox`), written in the same transaction as the
notification. Nothing is sent on the money path: an operator or cron calls
`POST /api/admin/outbox/drain`, which posts due rows as JSON with
`x-codeitlab-event: notification.<kind>` and, when `MARKETPLACE_NOTIFY_SECRET` is
set, `x-codeitlab-signature: t=<unix>,v1=<hmac>` over `${t}.${body}` — the same
scheme as payment webhooks, so one verifier covers both. Failures keep the row
pending with an attempt count, the last error, and a backoff capped at one hour;
`GET /api/admin/outbox` shows pending/delivered/failed counts and the 20 most
recent rows. A drain is idempotent per row (delivered rows are never resent), so
running it every minute is safe.

## Admin audit

Every operator action that moves money or changes who can be hired — dispute
decisions and profile approvals — appends a row to `admin_audit` with the action,
the target, a human-readable detail and a timestamp. There is no update or delete
path. `GET /api/admin/audit` (admin token) returns the trail newest first, and the
admin page shows the last 20 actions next to the ledger. The admin token is a
role, not a person, so the audit records what was decided and why, not a name.

## Deploying

1. Build the PWA (`vp run build:web`) and serve the static output at
   `app.codeitlab.com` over HTTPS.
2. Build the marketing site (`vp run build:marketing`) and serve it at
   `codeitlab.com`.
3. Run the marketplace as a small Node service with a persistent volume for
   `MARKETPLACE_DB`, behind the same reverse proxy:

   ```
   location /market/ {
     proxy_pass http://127.0.0.1:4174/;
     proxy_set_header Host $host;
     proxy_set_header X-Forwarded-Proto $scheme;
   }
   ```

   Set `MARKETPLACE_BASE_PATH=/market`, `MARKETPLACE_BASE_URL=https://codeitlab.com/market`,
   `MARKETPLACE_COOKIE_SECURE=1` and `MARKETPLACE_TRUST_PROXY=1` (the proxy is
   the only thing that can see the real client address). The service binds
   loopback by default; put HTTPS in front of it.

4. **Run the preflight before starting it**:

   ```bash
   pnpm --filter @codeitlab/marketplace doctor
   ```

   It fails on the mistakes that are cheap to catch here: dev email left on,
   mock payments in production, missing mail transport/webhook (nobody could log
   in), empty admin token, non-HTTPS base URL, non-Secure cookies, an in-memory
   database or an invalid port. It warns on a short admin token and on an
   unsigned activity outbox. Exit code 1 means "do not deploy".

5. Drain the two queues from cron (they are the only outbound work that is not
   request-driven):

   ```cron
   * * * * * curl -fsS -X POST -H "authorization: Bearer $ADMIN_TOKEN" https://codeitlab.com/market/api/admin/mail/drain
   * * * * * curl -fsS -X POST -H "authorization: Bearer $ADMIN_TOKEN" https://codeitlab.com/market/api/admin/outbox/drain
   ```

6. Back up the SQLite file like any other database; the ledger is the record of
   who is owed money.

The preflight (`pnpm --filter @codeitlab/marketplace doctor`) checks the scheduled
half too: auto-release off, auto-release on with `MARKETPLACE_MAINTENANCE_MINUTES=0`
(the sweep would never run), and a mistyped rate-limit variable all produce a
warning instead of silently falling back to a default.

Without `MARKETPLACE_ADMIN_TOKEN` the admin pages are disabled. Without a real
payment provider the service only moves mock money, so a misconfigured deploy
cannot charge anyone — and the preflight above makes sure you know which one you
are running.

## Roadmap

Done since the first draft: ratings after approval, web push for the activity
feed, opt-in email notifications, job search, public numbers, active sessions,
new-device sign-in alerts, waiting-delivery reminders, and the HTTPS tunnel check.

- Stripe Connect for real charges and payouts (the provider interface and the
  sandbox harness are ready; only the account setup is missing).
- Hosted containers on a VPS as the later subscription add-on; the free app and
  the marketplace stay free.
