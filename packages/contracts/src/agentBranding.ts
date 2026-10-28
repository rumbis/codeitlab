/**
 * White-label agent naming.
 *
 * CodeItLab ships every harness under its own brand: a provider that would
 * otherwise surface a vendor name ("Codex", "Qoder CLI", "Hermes") is shown as
 * "CodeItLab <name>". Model ids keep their real slugs — routing, pricing and
 * saved selections depend on them — but the agent identity the user sees is
 * ours.
 */
export const AGENT_BRAND_PREFIX = "CodeItLab";

export function codeitlabAgentLabel(
  displayName: string | null | undefined,
  fallback = "Agent",
): string {
  const trimmed = (displayName ?? "").trim();
  if (trimmed.length === 0) return `${AGENT_BRAND_PREFIX} ${fallback}`;
  if (trimmed.toLowerCase().startsWith(AGENT_BRAND_PREFIX.toLowerCase())) return trimmed;
  return `${AGENT_BRAND_PREFIX} ${trimmed}`;
}
