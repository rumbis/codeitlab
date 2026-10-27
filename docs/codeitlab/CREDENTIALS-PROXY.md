# Credentials proxy — local privacy firewall

CodeItLab can keep secrets on the machine. When the proxy is on, every string
the app is about to send to a provider is inspected locally first: API keys,
passwords, tokens, private keys, connection strings, personal data and anything
inside a `/private` block are replaced with **deterministic, format-preserving
fakes**. The fake ↔ original map never leaves the machine: the gateway keeps it
in the CodeItLab home and the app keeps the turn map in memory, and both put the
real values back in answers and tool output.

The design follows the same idea as [Latet](https://github.com/Latet-AI/latet)
— a privacy firewall between the agent and the model — but it is implemented
natively: no Python service, no third-party account, no cloud call at scan time.
It is **privacy-first by default**: the credentials firewall is on for new
installations, so a key, password or token is replaced before the prompt leaves
the machine. Masking personal data (emails, phones, IBANs, cards) is a separate
switch, off by default, because replacing an address the model is asked to write
into a fixture changes the answer. Both live at **Settings → CodeItLab →
Privacy**, and both can be switched off.

## What it does

| Layer          | What happens                                                                                                                                                                                                                                                                                                                                    |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Patterns       | Known credential shapes: `sk-…`, `sk-ant-…`, `sk-proj-…`, `ghp_…`/`github_pat_…`, `glpat-…`, `AKIA…`/`ASIA…`, `AIza…`, `xox[baprs]-…`, `npm_…`, `whsec_…`, JWTs, PEM private keys, connection strings (`postgres://user:pass@…`), `Bearer` tokens, `KEY=`/`password:` assignments, `.env` lines.                                                |
| Personal data  | Emails, phone numbers (E.164), IBANs (checksum-validated) and card numbers (Luhn-validated), plus private IP ranges in `max`. Off by default: the `Also mask personal data` switch (or the `max` mode) turns it on.                                                                                                                             |
| `/private`     | `/private … /private`, `[private] … [/private]`, `<private> … </private>`. In `mask` mode the content becomes a placeholder; in `block` mode the whole request is refused.                                                                                                                                                                      |
| App generation | Thread titles, commit messages, PR content, branch names and review guides are masked in the `TextGeneration` service before they reach a provider, and their results are restored. These calls never pass through the turn dispatch path, so they need their own guard.                                                                        |
| Tiny model     | The smallest local model that can check credentials: a hashed character n-gram logistic regression with **8,233 int8 weights** (~40 KB of source). It runs on tokens the patterns miss and is trained to stay quiet on git SHAs, checksums, UUIDs and identifiers. No runtime, no GPU, no network.                                              |
| App turns      | Built-in provider turns are masked in the dispatch path (`RunExecutionService`) after every local-only context injection, so the prompt the adapter receives never contains a secret. The provider's output is restored before ingestion. In `block` mode a turn whose prompt contains a `/private` block fails before the provider is started. |

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
- Only answers requests addressed to loopback. A `Host` header that is not
  `127.0.0.1`, `localhost` or `[::1]` gets `403 codeitlab_gateway_host_rejected`,
  so a page that rebinds its own domain to 127.0.0.1 (DNS rebinding) cannot
  reach the vault.

## Using it

1. **Settings → CodeItLab → Privacy**, enable the firewall, pick a mode, save.
2. **Preview scan** — paste anything; the masked result and the finding kinds
   appear locally. Nothing is sent anywhere for this check.
3. **Local gateway for CLI agents** — start it, then point an OpenAI- or
   Anthropic-compatible agent at `http://127.0.0.1:5284/v1` and pass
   `x-codeitlab-upstream: https://api.anthropic.com` (or `?upstream=`). The page
   also shows copy-ready `/upstream/<base64url(upstream)>` URLs for agents that
   only accept a base URL (e.g. `ANTHROPIC_BASE_URL`/`OPENAI_BASE_URL`), which
   is what makes tool results and file contents those agents read go through the
   mask as well. The gateway masks request bodies, forwards them, and restores
   fakes in the response — including streamed `text/event-stream` responses.
4. **Download smallest model** — fetches the newest weights into the CodeItLab
   home (SHA-256 recorded) and keeps the bundled copy as the offline fallback.
   The default URL is a GitHub release asset; if it is not published yet the
   button reports the fetch failure and the bundled model keeps working.
   `CODEITLAB_CREDENTIALS_MODEL_URL` overrides the URL for self-hosted builds.
5. **Nothing else to configure** — with the firewall on, app-driven turns are
   masked automatically. The provider sees only fakes; the real values stay in
   the local vault.

## Where the code lives

- Contracts and settings: `packages/codeitlab/src/credentials.ts`
  (`CodeItLabCredentialsSettings` under `ServerSettings.codeitlab.credentials`).
- Engine (pure, shared): `packages/codeitlab/src/credentials/engine.ts` —
  detectors, `/private` parsing, deterministic fakes, `CredentialVault`.
- Tiny model: `packages/codeitlab/src/credentials/model.ts` plus generated
  weights in `model-weights.ts`; training script and metrics in
  `scripts/credentials-model/train.py` / `model.json`.
- Server service: `apps/server/src/codeitlab/credentials/CredentialsService.ts`
  — vault persistence, model download, gateway, audit counters.
- RPC: `codeitlab.credentials.{status,update,scan,restore,start,stop,downloadModel}`.
- UI: `apps/web/src/components/codeitlab/CodeItLabCredentialsPage.tsx`,
  route `/settings/codeitlab/credentials`.

## Honest limits

- Attachments and file contents a CLI agent reads with its own tools do not
  pass through the app guard; for those, point the agent's base URL at the
  loopback gateway, which masks whole request bodies.
- Patterns and a tiny model are not a general PII classifier. Free-form prose
  that never names a credential ("Mark from sales is interviewing") is not
  detected; a local LLM reviewer is the planned follow-up for that class, and
  the `reviewerUrl`/`reviewerModel` settings fields are reserved for it.
- App-driven turns mask the outgoing prompt and restore fakes in the provider
  event stream before ingestion, so assistant text, reasoning, tool output and
  diffs reach the projection with the real values. The turn map is in memory
  only: a restart cannot restore fakes that an earlier process created (new
  turns re-mask the same values to the same deterministic fakes, so they stay
  consistent). History written before this restore existed keeps its fakes.
- App-turn fakes use their own deterministic namespace (`codeitlab-app-turn-fakes-v1`)
  rather than the vault-keyed namespace the gateway and preview use, because the
  dispatch path deliberately avoids the credentials service and its key file.
  Values stay stable per value across turns and restarts; the in-memory map is
  bounded to 4,096 distinct values and is dropped when it would grow past that.
- App-turn scans are not added to the audit list (the dispatch path has no
  credentials service); the counters and audit cover preview scans and gateway
  traffic.
- App turns always use the bundled model; a downloaded model updates the
  preview scan and the gateway, not the provider dispatch path. That keeps the
  dispatch path free of downloads and file reads.
- Fakes are not cryptographic secrets: they are deterministic placeholders.
  They must not be treated as credentials.
