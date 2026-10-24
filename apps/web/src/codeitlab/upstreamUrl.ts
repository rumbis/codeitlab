/**
 * The credentials gateway needs to know where a request should go. Agents only
 * get one base URL, so the upstream travels in the path: the gateway accepts
 * `/upstream/<base64url(upstream)>/...` and forwards the rest of the path there.
 * These helpers build that URL for the two provider APIs agents usually speak,
 * so the settings page can show a copy-ready value instead of a header rule most
 * agents cannot send.
 */

export interface FirewallUpstream {
  readonly id: string;
  readonly label: string;
  readonly upstream: string;
  readonly environmentVariable: string;
}

export const FIREWALL_UPSTREAMS: ReadonlyArray<FirewallUpstream> = [
  {
    id: "anthropic",
    label: "Anthropic-compatible",
    upstream: "https://api.anthropic.com",
    environmentVariable: "ANTHROPIC_BASE_URL",
  },
  {
    id: "openai",
    label: "OpenAI-compatible",
    upstream: "https://api.openai.com",
    environmentVariable: "OPENAI_BASE_URL",
  },
];

const base64Url = (value: string): string =>
  btoa(value).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");

/** `http://127.0.0.1:5284/v1` -> `http://127.0.0.1:5284`. */
const gatewayBase = (gatewayUrl: string): string =>
  gatewayUrl
    .trim()
    .replace(/\/v1\/?$/u, "")
    .replace(/\/+$/u, "");

/** The base URL an agent should use to reach `upstream` through the gateway. */
export function firewallUpstreamUrl(gatewayUrl: string, upstream: string): string {
  return `${gatewayBase(gatewayUrl)}/upstream/${base64Url(upstream)}`;
}
