# Credentials proxy — local privacy firewall

CodeitLab can keep secrets on the machine. When the proxy is on, every string
the app is about to send to a provider is inspected locally first: API keys,
passwords, tokens, private keys, connection strings, personal data and anything
inside a `/private` block are replaced with **deterministic, format-preserving
fakes**. The fake ↔ original map stays in the CodeItLab home, and the real
values are put back in answers and tool output.

The design follows the same idea as [Latet](https://github.com/Latet-AI/latet)
— a privacy firewall between the agent and the model — but it is implemented
natively: no Python service, no third-party account, no cloud call at scan time.
It is **opt-in** (off by default) and lives at
**Settings → CodeitLab → Privacy**.

## What it does

| Layer         | What happens                                                                                                                                                                                                                                                                                       |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Patterns      | Known credential shapes: `sk-…`, `sk-ant-…`, `sk-proj-…`, `ghp_…`/`github_pat_…`, `glpat-…`, `AKIA…`/`ASIA…`, `AIza…`, `xox[baprs]-…`, `npm_…`, `whsec_…`, JWTs, PEM private keys, connection strings (`postgres://user:pass@…`), `Bearer` tokens, `KEY=`/`password:` assignments, `.env` lines.   |
| Personal data | Emails, phone numbers (E.164), IBANs (checksum-validated) and card numbers (Luhn-validated). On in `balanced`, off in `secrets`, plus private IP ranges in `max`.                                                                                                                                  |
| `/private`    | `/private … /private`, `[private] … [/private]`, `<private> … </private>`. In `mask` mode the content becomes a placeholder; in `block` mode the whole request is refused.                                                                                                                         |
| Tiny model    | The smallest local model that can check credentials: a hashed character n-gram logistic regression with **8,233 int8 weights** (~40 KB of source). It runs on tokens the patterns miss and is trained to stay quiet on git SHAs, checksums, UUIDs and identifiers. No runtime, no GPU, no network. |

Fakes preserve the shape that matters to code: an `sk-proj-` key keeps its
prefix and length, a JWT keeps three segments, an IBAN keeps its country and
length with a valid checksum, a card number stays Luhn-valid, an email stays an
email. They are deterministic per value, so the same key gets the same fake in
every request and every session — history that repeats a value costs nothing
and code the model writes still lines up.

## What it never does

- Never logs, audits, or returns a value. Findings carry a kind and a span;
  the audit list carries counts and kinds. `scan` returns only the masked text.
- Never sends the vault anywhere. The fake ↔ original map is sealed with
  AES-256-GCM under `<stateDir>/codeitlab/credentials/vault.enc.json`, and the
  key is generated locally with `0600` permissions in `vault.key`.
- Never guesses where to forward. The gateway needs an explicit upstream
  (`x-codeitlab-upstream` header, `?upstream=` query, or `/upstream/<base64url>`
  prefix) and only listens on `127.0.0.1`.

## Using it

1. **Settings → CodeItLab → Privacy**, enable the firewall, pick a mode, save.
2. **Preview scan** — paste anything; the masked result and the finding kinds
   appear locally. Nothing is sent anywhere for this check.
3. **Local gateway for CLI agents** — start it, then point an OpenAI- or
   Anthropic-compatible agent at `http://127.0.0.1:5284/v1` and pass
   `x-codeitlab-upstream: https://api.anthropic.com` (or `?upstream=`). The
   gateway masks request bodies, forwards them, and restores fakes in the
   response — including streamed `text/event-stream` responses.
4. **Download smallest model** — fetches the newest weights into the CodeItLab
   home (SHA-256 recorded) and keeps the bundled copy as the offline fallback.
   `CODEITLAB_CREDENTIALS_MODEL_URL` overrides the URL for self-hosted builds.

## Where the code lives

- Contracts and settings: `packages/codeitlab/src/credentials.ts`
  (`CodeitlabCredentialsSettings` under `ServerSettings.codeitlab.credentials`).
- Engine (pure, shared): `packages/codeitlab/src/credentials/engine.ts` —
  detectors, `/private` parsing, deterministic fakes, `CredentialVault`.
- Tiny model: `packages/codeitlab/src/credentials/model.ts` plus generated
  weights in `model-weights.ts`; training script and metrics in
  `scripts/credentials-model/train.py` / `model.json`.
- Server service: `apps/server/src/codeitlab/credentials/CredentialsService.ts`
  — vault persistence, model download, gateway, audit counters.
- RPC: `codeitlab.credentials.{status,update,scan,restore,start,stop,downloadModel}`.
- UI: `apps/web/src/components/codeitlab/CodeitlabCredentialsPage.tsx`,
  route `/settings/codeitlab/credentials`.

## Honest limits

- Patterns and a tiny model are not a general PII classifier. Free-form prose
  that never names a credential ("Mark from sales is interviewing") is not
  detected; a local LLM reviewer is the planned follow-up for that class, and
  the `reviewerUrl`/`reviewerModel` settings fields are reserved for it.
- App-driven provider turns still go through the provider adapters; the gateway
  is the path that covers CLI agents' own HTTP calls today. Wiring the app's
  own turn prompt/response through the same engine is the next step, and the
  service API (`scan` / `restore`) is already shaped for it.
- Fakes are not cryptographic secrets: they are deterministic placeholders
  keyed by the local vault key. They must not be treated as credentials.
