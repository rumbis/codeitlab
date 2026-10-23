import {
  AntigravitySettings,
  ClaudeSettings,
  CodexSettings,
  codeitlabAgentLabel,
  ProviderDriverKind,
} from "@t3tools/contracts";
import { acpRegistryClient, hermesClient } from "@t3tools/provider-acp-registry/client";
import { makeProviderClientRegistry } from "@t3tools/provider-core/client";
import { cursorClient } from "@t3tools/provider-cursor/client";
import { grokClient } from "@t3tools/provider-grok/client";
import { museClient } from "@t3tools/provider-muse/client";
import { openCodeClient } from "@t3tools/provider-opencode/client";
import { piClient } from "@t3tools/provider-pi/client";

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
