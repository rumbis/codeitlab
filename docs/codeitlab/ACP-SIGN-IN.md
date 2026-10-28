# ACP agent sign-in matrix

How each installed ACP agent signs in, and what CodeItLab does when you press
**Sign in / Change account**. This reflects the fixes shipped for the 43 registry
agents installed on this machine (build `983fd7cf`).

## How the sign-in flow decides

| Agent advertises                          | CodeItLab runs                                                                                                                                                               |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type: "terminal"` auth method            | the agent command **without** its ACP transport args, plus the method's `args` (nova → `nova setup`, minimax → its setup)                                                    |
| `_meta["terminal-auth"]` (command + args) | the advertised command; bare names and forks run the agent's own managed binary (`opencode auth login`, `kilo auth login`, `amp-acp --setup`, `copilot login`, `kimi login`) |
| agent method, no meta                     | curated CLI setup for `goose` (`goose configure`), `glm-acp-agent` (`--setup`), `factory-droid` (interactive TUI → `/login`)                                                 |
| agent method with browser/device flow     | `authenticate` + URL elicitation (Gemini, Antigravity, Codex, Cursor, Sigit, Devin, Bob, Kimchi, Junie, Factory pairing)                                                     |
| `env_var` / API-key only                  | no Sign in button; the card names the variable to add under the instance's **Environment variables** (qwen-code → `OPENAI_API_KEY`, droid → `FACTORY_API_KEY`)               |
| no auth methods                           | Ready without sign-in (harn, crow-cli, cortex-code, auggie/poolside via meta)                                                                                                |

## Verified in-app sign-in (live, 2026-10-24)

- **Terminal, one command**: `amp-acp --setup`, `goose configure`, `nova setup`,
  `droid` (TUI `/login`), `opencode auth login`, `kilo auth login`, `copilot login`,
  `kimi login`, `opencode-v2 auth login`, `pi` terminal login.
- **Browser/device**: Antigravity, Codex (ChatGPT), Factory pairing, Devin, Junie,
  Kimchi, Sigit, Bob, Cursor.
- **Environment variables**: qwen-code (`OPENAI_API_KEY`), droid (`FACTORY_API_KEY`),
  deepagents/glm (`Z_AI_API_KEY`), qoder (`QODER_PERSONAL_ACCESS_TOKEN`).

## Known gaps

- `gemini` (Gemini CLI) rejects ACP clients: "This client is no longer supported
  for Gemini Code Assist for individuals — migrate to the Antigravity suite".
  Use `antigravity-acp` instead.
- An ACP agent that can create a session without credentials is reported as
  authenticated even when its paid/free-tier models later fail (opencode with no
  `auth.json`). Use **Change account** to store real credentials.
- Agents whose login needs a browser callback on localhost rely on the app's URL
  elicitation; the app shows the link and a consent step.
