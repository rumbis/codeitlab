import { DEFAULT_HOSTED_APP_URL } from "@codeitlab/core/remote";
import type { CodeItLabRemotePairingLink, CodeItLabRemoteTunnel } from "@codeitlab/contracts";

/**
 * Presentation rules for the managed Cloudflare quick tunnel and the pairing
 * card. Kept pure so the badge, install-command and hosted-link decisions can be
 * tested without rendering the Remote page.
 */

export type RemoteTunnelBadgeTone = "success" | "warning" | "outline" | "secondary";

export interface RemoteTunnelBadge {
  readonly id: "cloudflared" | "tunnel";
  readonly label: string;
  readonly tone: RemoteTunnelBadgeTone;
}

export function cloudflaredBadge(tunnel: CodeItLabRemoteTunnel): RemoteTunnelBadge {
  if (!tunnel.available) {
    return { id: "cloudflared", label: "cloudflared not installed", tone: "secondary" };
  }
  const version = tunnel.version?.trim();
  return {
    id: "cloudflared",
    label:
      version === undefined || version.length === 0
        ? "cloudflared detected"
        : `cloudflared ${version}`,
    tone: "outline",
  };
}

export function tunnelBadge(tunnel: CodeItLabRemoteTunnel): RemoteTunnelBadge {
  if (!tunnel.available) {
    return { id: "tunnel", label: "tunnel unavailable", tone: "secondary" };
  }
  if (tunnel.running) {
    return { id: "tunnel", label: "tunnel running", tone: "success" };
  }
  return { id: "tunnel", label: "tunnel stopped", tone: "warning" };
}

export function remoteTunnelBadges(
  tunnel: CodeItLabRemoteTunnel,
): ReadonlyArray<RemoteTunnelBadge> {
  return [cloudflaredBadge(tunnel), tunnelBadge(tunnel)];
}

/** Public URL to show while the quick tunnel is up; a stale URL is not useful. */
export function tunnelPublicUrl(tunnel: CodeItLabRemoteTunnel): string | null {
  const url = tunnel.url?.trim();
  if (!tunnel.running || url === undefined || url.length === 0) return null;
  return url;
}

export type CloudflaredPlatform = "macos" | "windows" | "linux" | "mobile" | "unknown";

export const CLOUDFLARED_DOWNLOAD_URL =
  "https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/";

const INSTALL_COMMANDS: Readonly<Partial<Record<CloudflaredPlatform, string>>> = {
  macos: "brew install cloudflared",
  windows: "winget install --id Cloudflare.cloudflared",
};

/**
 * The tunnel is installed on the machine running the server, which is usually —
 * but not always — the machine whose browser renders this page. Mobile is
 * treated separately so a phone viewing the page is not told to run `brew`.
 */
export function cloudflaredPlatform(userAgent: string): CloudflaredPlatform {
  const ua = userAgent.toLowerCase();
  if (ua.includes("android") || ua.includes("iphone") || ua.includes("ipad")) return "mobile";
  if (ua.includes("windows")) return "windows";
  if (ua.includes("mac os x") || ua.includes("macintosh")) return "macos";
  if (ua.includes("linux") || ua.includes("x11")) return "linux";
  return "unknown";
}

export function cloudflaredInstallCommand(platform: CloudflaredPlatform): string | null {
  return INSTALL_COMMANDS[platform] ?? null;
}

const HOSTED_APP_HOST = new URL(DEFAULT_HOSTED_APP_URL).host;

export type PairingLinkKind = "hosted" | "direct";

export interface PairingLinkTarget {
  readonly kind: PairingLinkKind;
  readonly url: string;
  readonly title: string;
  readonly description: string;
}

export interface PairingLinkTargets {
  /** Rendered with the QR code and the primary copy button. */
  readonly primary: PairingLinkTarget;
  /** Direct link kept beside the hosted one; absent when the hosted link is absent. */
  readonly secondary: PairingLinkTarget | null;
}

export function hasHostedPairingLink(link: Pick<CodeItLabRemotePairingLink, "hostedUrl">): boolean {
  return link.hostedUrl !== undefined && link.hostedUrl.trim().length > 0;
}

export function pairingLinkTargets(
  link: Pick<CodeItLabRemotePairingLink, "url" | "hostedUrl">,
): PairingLinkTargets {
  const direct: PairingLinkTarget = {
    kind: "direct",
    url: link.url,
    title: "Direct link",
    description: "Native app or browser on this network",
  };

  const hostedUrl = link.hostedUrl?.trim();
  if (hostedUrl === undefined || hostedUrl.length === 0) {
    return { primary: direct, secondary: null };
  }

  return {
    primary: {
      kind: "hosted",
      url: hostedUrl,
      title: "PWA link",
      description: "Install/open the app on your phone",
    },
    secondary: direct,
  };
}

/**
 * One-line nudge toward the hosted PWA path. A link minted before the tunnel
 * started has no `hostedUrl`, so the advice depends on the tunnel state rather
 * than on the link alone.
 */
export function hostedPairingHint(input: {
  readonly link: Pick<CodeItLabRemotePairingLink, "hostedUrl">;
  readonly tunnel: CodeItLabRemoteTunnel;
}): string | null {
  if (hasHostedPairingLink(input.link)) return null;
  if (!input.tunnel.available) {
    return `Install cloudflared and start the Cloudflare tunnel to get a PWA link that opens ${HOSTED_APP_HOST} on your phone.`;
  }
  if (input.tunnel.running) {
    return `The tunnel is running. Create a new phone link to get a PWA link for ${HOSTED_APP_HOST}.`;
  }
  return `Start the Cloudflare tunnel above to get a PWA link that installs ${HOSTED_APP_HOST} on your phone.`;
}
