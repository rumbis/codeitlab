# Remote access (CodeitLab)

CodeitLab runs an ordinary HTTP/WebSocket server, so every client — web, desktop, iOS, Android —
reaches the same server. There are three ways to get a phone to it. The first is ours and needs
no account; the second is the upstream relay the fork inherits; the third is a browser on the
same machine.

## 1. Tailnet / LAN + a pairing link (no account)

This is the path **Settings → CodeitLab → Remote** shows.

1. The host machine is in a tailnet (Tailscale running and signed in) or on the same Wi-Fi as the
   phone.
2. The server listens on an address the phone can reach. A loopback bind (`127.0.0.1`) is _not_
   reachable — the Remote page says so explicitly. Use:

   ```bash
   t3 serve --host <tailnet-ip>     # e.g. 100.125.101.79
   ```

   The desktop app does the same thing when **Settings → Connections → Network access** is on.

3. In **Settings → CodeitLab → Remote**, press **Create phone link**. The page mints a one-time
   pairing link (`http://<tailnet-ip>:<port>/pair#token=…`, 30 minutes) and renders it as a QR
   code.
4. In the CodeitLab mobile app choose **Add environment** and scan the QR (or paste the URL).

The link is a credential: anyone who scans it before it expires gets the scopes it was minted
with. Create a fresh one per device and let the old ones expire.

Tailscale Serve is the better option when a **browser** is the client: it terminates HTTPS on the
MagicDNS name and forwards to loopback, so the page is a secure context. Over plain
`http://<tailnet-ip>` the workspace and pairing do work (verified on a real tailnet), but
`window.isSecureContext` is `false` and `crypto.subtle` is unavailable, so browser-only WebCrypto
features — the T3 Connect DPoP path in particular — cannot run. The Remote page lists the HTTPS URL
when the server was started with serve enabled, and prefers it for the pairing link.

The startup pairing URL that `codeitlab serve` prints is for the server's own browser only; it is not a
pairing credential for another device. Use **Create phone link** (or `codeitlab pair`) for that.

## 2. T3 Connect (upstream relay, account-based)

The fork keeps T3 Code's relay client and sign-in untouched: **Settings → Connections → T3
Connect**, or `codeitlab connect` on a command-line host. This is the only path that works when the
host is behind NAT and not in a tailnet, and it is the only path that requires an account — the
account and relay are upstream T3 Code infrastructure, not something CodeitLab operates. The
Remote page links to it rather than pretending otherwise.

## 3. Browser on the host

`codeitlab serve` prints a pairing URL for the local browser; `codeitlab pair` mints a fresh one against a
running server. Useful for testing without a phone.

## What the Remote page shows

| Field                       | Meaning                                                                |
| --------------------------- | ---------------------------------------------------------------------- |
| Tailnet available / running | whether the Tailscale CLI answered and the backend is up               |
| Hostname / MagicDNS / IPv4  | the names and address to use from another device                       |
| Listen host + port          | what the server is bound to                                            |
| Loopback-only warning       | the server cannot be reached from another device as configured         |
| Reachable URLs              | tailnet first, then LAN, then a Tailscale Serve HTTPS URL when enabled |
| Create phone link           | mints a 30-minute pairing link and shows it as QR + copyable URL       |

## Not covered

- No push-notification registration change: mobile notifications still use the upstream relay.
- No automatic port forwarding, no UPnP, no relay of our own.
- The page does not silently enable Tailscale Serve; that stays an operator decision.

## Pairing link behaviour

A `/pair#token=<credential>` link pairs automatically in a normal browser
context — that is the phone path: scan the QR, the page consumes the token,
sets the session cookie and opens the workspace. The desktop app's own window
uses a desktop-managed pairing surface and does not consume the hash token;
paste the credential there or mint one with `codeitlab auth pairing create`. The
startup token printed in the server log is not a pairing credential.
