# Deploying the marketplace

One Node process, one SQLite file, one reverse proxy. No build step for the
server (it runs TypeScript directly on Node 24), no external queue, no Redis.
The files next to this document are working examples, not pseudocode:

- `deploy/marketplace.env.example` — every variable, with the production values
- `deploy/codeitlab-marketplace.service` — systemd unit with a hardened sandbox
- `deploy/Caddyfile.example` — TLS + `/market` reverse proxy
- `deploy/codeitlab-backup.cron` — nightly verified backup

## 1. Host preparation

```bash
sudo useradd --system --home /opt/codeitlab --shell /usr/sbin/nologin codeitlab
sudo mkdir -p /opt/codeitlab /var/lib/codeitlab /var/backups/codeitlab /etc/codeitlab
sudo chown -R codeitlab:codeitlab /opt/codeitlab /var/lib/codeitlab /var/backups/codeitlab
sudo chmod 750 /etc/codeitlab

# Node 24.13.1 or newer (the marketplace uses node:sqlite and type stripping).
node --version

# Get the code onto the host (git, rsync, or the release archive).
sudo -u codeitlab git clone https://github.com/rumbis/codeitlab /opt/codeitlab
# or: rsync -a --delete ./codeitlab/ host:/opt/codeitlab/
```

The marketplace has **no runtime dependencies**; `pnpm install` is only needed
if you want to run its tests or the `doctor`/`smoke` scripts through pnpm. Plain
`node scripts/doctor.ts` works without an install.

## 2. Configuration

```bash
sudo cp /opt/codeitlab/docs/codeitlab/deploy/marketplace.env.example \
        /etc/codeitlab/marketplace.env
sudo chmod 600 /etc/codeitlab/marketplace.env
sudo -e /etc/codeitlab/marketplace.env
```

Fill at least `MARKETPLACE_ADMIN_TOKEN` (24+ random characters),
`MARKETPLACE_MAIL_*` (a webhook that actually delivers mail), `STRIPE_*` and
`PAYMENTS_WEBHOOK_SECRET`. Generate the admin token with
`openssl rand -hex 24`.

## 3. Gate the deploy before it is public

```bash
cd /opt/codeitlab/apps/marketplace
set -a; . /etc/codeitlab/marketplace.env; set +a
node scripts/doctor.ts     # must print READY
node scripts/smoke.ts      # must print SMOKE OK — 9 steps
```

`doctor` fails on dev email, mock payments, missing mail transport, an empty
admin token, a non-HTTPS base URL, non-Secure cookies, an in-memory database or
an invalid port, and warns about a disabled auto-release, a missing maintenance
loop or a typo in a rate-limit variable. `smoke` walks the whole money path on a
throwaway in-memory database, so a failure here is a broken build, not a broken
host.

## 4. Service

```bash
sudo cp /opt/codeitlab/docs/codeitlab/deploy/codeitlab-marketplace.service \
        /etc/systemd/system/codeitlab-marketplace.service
sudo systemctl daemon-reload
sudo systemctl enable --now codeitlab-marketplace
sudo systemctl status codeitlab-marketplace --no-pager
curl -fsS http://127.0.0.1:4174/health
# {"ok":true,"service":"marketplace","time":"...","schemaVersion":22}
```

The unit runs as an unprivileged user with a read-only filesystem except the
database and backup directories, no home access, no new privileges and no
executable memory. `Restart=always` covers a crash; migrations run at boot.

## 5. TLS and the `/market` mount

```bash
sudo cp /opt/codeitlab/docs/codeitlab/deploy/Caddyfile.example /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddy forwards the untouched path, so `MARKETPLACE_BASE_PATH=/market` keeps every
rendered link under `/market`; the app never sees the TLS terminator except
through the headers Caddy overwrites. Set `MARKETPLACE_TRUST_PROXY=1` **only**
because Caddy overwrites `X-Forwarded-For`; on a host where clients can reach the
process directly, leave it `0` or they can pick their own rate-limit bucket.

## 6. Stripe webhook

In the Stripe dashboard create a webhook endpoint:

```
https://codeitlab.com/market/api/payments/webhook
```

Subscribe to the payment-intent events the adapter handles
(`payment_intent.succeeded`, `payment_intent.payment_failed`,
`payment_intent.canceled`), copy the signing secret into
`PAYMENTS_WEBHOOK_SECRET`, restart, and confirm the route answers `503` without
the secret (it refuses unsigned events by design). The `stripe:sandbox` command
checks the adapter end to end with test keys before any real money moves.

## 7. Backups

```bash
sudo cp /opt/codeitlab/docs/codeitlab/deploy/codeitlab-backup.cron /etc/cron.d/codeitlab-backup
sudo touch /var/log/codeitlab-backup.log
sudo chown codeitlab:codeitlab /var/log/codeitlab-backup.log
```

The nightly job writes `marketplace-<timestamp>.sqlite` under
`/var/backups/codeitlab`, verifies it with `PRAGMA integrity_check` and exits 1
when the copy is unusable. The same backup is available from the admin panel
(**Back up now**) with an `admin_audit` row, which is what an operator should
press before payouts. Copy backups off the host — the ledger is append-only, the
disk is not.

## 8. Upgrade

```bash
cd /opt/codeitlab
sudo -u codeitlab git fetch --tags && sudo -u codeitlab git checkout <tag>
cd apps/marketplace
set -a; . /etc/codeitlab/marketplace.env; set +a
node scripts/doctor.ts && node scripts/smoke.ts
sudo systemctl restart codeitlab-marketplace
curl -fsS http://127.0.0.1:4174/health
```

Take a backup before the upgrade; migrations are additive and run at boot, so a
rollback is the previous commit plus the previous database file if the schema
changed. `/health` reports the schema version, which is the fastest way to see
that the new process opened the new schema.

## 9. What to watch

| Signal                                | Where                 | Meaning                                     |
| ------------------------------------- | --------------------- | ------------------------------------------- |
| `schemaVersion` in `/health`          | proxy or uptime check | a stale database behind a new build         |
| `journalctl -u codeitlab-marketplace` | systemd               | sweep failures, mail/webhook errors         |
| `/var/log/codeitlab-backup.log`       | cron                  | a backup that failed its integrity check    |
| `/api/admin/reconcile`                | admin                 | an engagement whose ledger does not balance |
| `/api/admin/ledger` held cents        | admin                 | escrow that should have been released       |

## 10. Security checklist

- [ ] Process bound to `127.0.0.1`, reached only through the proxy
- [ ] TLS with HSTS; `MARKETPLACE_COOKIE_SECURE=1`
- [ ] `MARKETPLACE_DEV_EMAIL=0` and a real mail transport
- [ ] `MARKETPLACE_ADMIN_TOKEN` random, 24+ chars, rotated if it ever appeared in a log
- [ ] `PAYMENTS_WEBHOOK_SECRET` set; unsigned events are refused
- [ ] `MARKETPLACE_TRUST_PROXY=1` only behind a proxy that overwrites the header
- [ ] Backups verified and copied off the host
- [ ] `MARKETPLACE_SECURITY_CONTACT` points at a mailbox a human reads
