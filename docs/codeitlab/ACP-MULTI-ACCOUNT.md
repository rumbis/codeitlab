# Multiple accounts for OAuth ACP agents

CodeItLab can keep **more than one account of the same ACP agent** side by side.
Each account is a normal provider instance, so it shows up in the model picker
with its own display name and can be enabled, disabled or removed on its own.

## Why a second instance is not enough on its own

OAuth ACP agents (Claude Agent, Gemini CLI, Codex, Cursor, opencode/Kilo, ...)
persist their credentials in the user's profile:

| Agent              | Where the credential lives                                 |
| ------------------ | ---------------------------------------------------------- |
| `claude-acp`       | `~/.claude/` (or the macOS Keychain)                       |
| `gemini`           | `~/.gemini/`                                               |
| `codex-acp`        | `~/.codex/`                                                |
| `opencode`, `kilo` | `~/.config/opencode`, `~/.local/share/opencode`            |
| others             | their own dot-directory under `$HOME` / `$XDG_CONFIG_HOME` |

A second provider instance that inherits the same `HOME` would therefore sign in
as the **same** account, and signing out of one instance would sign out the
other.

## What the app does

1. The provider card of an ACP instance has an **Add another account** button
   (`UserPlus` icon, editor mode only).
2. The button creates a sibling instance (for example
   `acpRegistry_gemini` → `acpRegistry_gemini_2`) with
   `config.accountProfile: true` and a display name such as
   `Gemini CLI · account 2`.
3. For `accountProfile` instances the ACP driver points the credential paths at
   a per-instance profile directory **before spawning the agent or running its
   sign-in flow**:

   ```
   <state dir>/acp-accounts/<instanceId>/
   ```

   | Variable            | Value                          |
   | ------------------- | ------------------------------ |
   | `HOME`              | `<profile>`                    |
   | `XDG_CONFIG_HOME`   | `<profile>/.config`            |
   | `XDG_DATA_HOME`     | `<profile>/.local/share`       |
   | `XDG_STATE_HOME`    | `<profile>/.local/state`       |
   | `XDG_CACHE_HOME`    | `<profile>/.cache`             |
   | `GIT_CONFIG_GLOBAL` | the real user's `~/.gitconfig` |

   `GIT_CONFIG_GLOBAL` keeps the user's git identity and credential helper
   working even though `HOME` is isolated.

4. The ACP sign-in confirmation is keyed by the instance **and** its profile
   paths, so each account reports its own "Authenticated" / "Sign in needed"
   state.

## Using it

1. Settings → Providers → pick an installed ACP agent.
2. Click **Add another account** in the card header.
3. Open the new instance and press **Sign in**; complete the agent's own OAuth
   flow (browser or terminal wizard) with the second account.
4. Both instances now appear in the composer; switch accounts by picking the
   model of the instance you want.

## Limits (honest list)

- **macOS Keychain:** agents that store tokens in the login keychain (Claude
  Code is the common case) may still share credentials across profiles; if the
  second sign-in replaces the first, use the agent's API-key / token
  environment variable on the second instance instead.
- **SSH:** the isolated `HOME` hides `~/.ssh`; git over SSH inside the agent
  will need `GIT_SSH_COMMAND` or a copied key in the profile directory.
- **Dotfiles:** shell startup files (`~/.zshrc`, `~/.npmrc`, ...) are not
  inherited; add the ones the agent needs as instance environment variables.
- The profile directory is not backed up and is removed with the instance's
  state if the app's state directory is deleted.

## Verification

- Unit: `packages/provider-acp-registry/src/server/accountProfile.test.ts`
  (no profile → untouched environment; profile → HOME/XDG/GIT_CONFIG_GLOBAL
  rewritten and the directory created).
- UI: `ProviderInstanceCard.browser.test.tsx` ("offers a second account action
  in the editor header").
