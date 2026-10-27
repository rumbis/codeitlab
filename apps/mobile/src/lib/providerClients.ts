import { isProviderDriverKind } from "@codeitlab/contracts";
import { acpRegistryClient, hermesClient } from "@codeitlab/provider-acp-registry/client";
import { makeProviderClientRegistry } from "@codeitlab/provider-core/client";
import { cursorClient } from "@codeitlab/provider-cursor/client";
import { grokClient } from "@codeitlab/provider-grok/client";
import { museClient } from "@codeitlab/provider-muse/client";
import { openCodeClient } from "@codeitlab/provider-opencode/client";
import { piClient } from "@codeitlab/provider-pi/client";

const providerClients = makeProviderClientRegistry([
  cursorClient,
  grokClient,
  museClient,
  openCodeClient,
  piClient,
  hermesClient,
  acpRegistryClient,
]);

export function getProviderClient(driver: string | null | undefined) {
  return isProviderDriverKind(driver) ? providerClients.get(driver) : undefined;
}
