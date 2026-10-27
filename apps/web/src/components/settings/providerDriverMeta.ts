import {
  AntigravitySettings,
  ClaudeSettings,
  CodexSettings,
  codeitlabAgentLabel,
  ProviderDriverKind,
} from "@codeitlab/contracts";
import { acpRegistryClient, hermesClient } from "@codeitlab/provider-acp-registry/client";
import { makeProviderClientRegistry } from "@codeitlab/provider-core/client";
import { cursorClient } from "@codeitlab/provider-cursor/client";
import { grokClient } from "@codeitlab/provider-grok/client";
import { museClient } from "@codeitlab/provider-muse/client";
import { openCodeClient } from "@codeitlab/provider-opencode/client";
import { piClient } from "@codeitlab/provider-pi/client";

export const providerClients = makeProviderClientRegistry([
  {
    driverKind: ProviderDriverKind.make("codex"),
    label: codeitlabAgentLabel("Codex"),
    settingsSchema: CodexSettings,
  },
  {
    driverKind: ProviderDriverKind.make("claudeAgent"),
    label: codeitlabAgentLabel("Claude"),
    settingsSchema: ClaudeSettings,
  },
  cursorClient,
  grokClient,
  openCodeClient,
  {
    driverKind: ProviderDriverKind.make("antigravity"),
    label: codeitlabAgentLabel("Antigravity"),
    settingsSchema: AntigravitySettings,
  },
  museClient,
  piClient,
  hermesClient,
  acpRegistryClient,
]);
