import type { CodeItLabRemotePairingLink, CodeItLabRemoteTunnel } from "@codeitlab/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  cloudflaredBadge,
  cloudflaredInstallCommand,
  cloudflaredPlatform,
  hasHostedPairingLink,
  hostedPairingHint,
  pairingLinkTargets,
  remoteTunnelBadges,
  tunnelBadge,
  tunnelPublicUrl,
} from "./remoteTunnel";

function tunnel(overrides: Partial<CodeItLabRemoteTunnel> = {}): CodeItLabRemoteTunnel {
  return { available: true, running: false, ...overrides };
}

function pairingLink(
  overrides: Partial<Pick<CodeItLabRemotePairingLink, "url" | "hostedUrl">> = {},
): Pick<CodeItLabRemotePairingLink, "url" | "hostedUrl"> {
  return {
    url: "https://100.64.1.2:3773/pair#token=direct-token",
    ...overrides,
  };
}

describe("cloudflare tunnel badges", () => {
  it("shows the cloudflared version when the CLI answered", () => {
    expect(cloudflaredBadge(tunnel({ version: "2024.8.0" }))).toEqual({
      id: "cloudflared",
      label: "cloudflared 2024.8.0",
      tone: "outline",
    });
    expect(cloudflaredBadge(tunnel())).toEqual({
      id: "cloudflared",
      label: "cloudflared detected",
      tone: "outline",
    });
  });

  it("reports a missing CLI without claiming a tunnel state", () => {
    expect(cloudflaredBadge(tunnel({ available: false, running: false }))).toEqual({
      id: "cloudflared",
      label: "cloudflared not installed",
      tone: "secondary",
    });
    expect(tunnelBadge(tunnel({ available: false }))).toEqual({
      id: "tunnel",
      label: "tunnel unavailable",
      tone: "secondary",
    });
  });

  it("distinguishes a stopped tunnel from a running one", () => {
    expect(tunnelBadge(tunnel())).toEqual({
      id: "tunnel",
      label: "tunnel stopped",
      tone: "warning",
    });
    expect(tunnelBadge(tunnel({ running: true, url: "https://x.trycloudflare.com/" }))).toEqual({
      id: "tunnel",
      label: "tunnel running",
      tone: "success",
    });
    expect(remoteTunnelBadges(tunnel({ running: true })).map((badge) => badge.id)).toEqual([
      "cloudflared",
      "tunnel",
    ]);
  });

  it("only surfaces a public URL while the tunnel is running", () => {
    expect(tunnelPublicUrl(tunnel({ url: "https://x.trycloudflare.com/" }))).toBeNull();
    expect(tunnelPublicUrl(tunnel({ running: true }))).toBeNull();
    expect(tunnelPublicUrl(tunnel({ running: true, url: " https://x.trycloudflare.com/ " }))).toBe(
      "https://x.trycloudflare.com/",
    );
  });
});

describe("cloudflared install hint", () => {
  it("detects the host platform from the user agent", () => {
    expect(
      cloudflaredPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"),
    ).toBe("macos");
    expect(cloudflaredPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("windows");
    expect(cloudflaredPlatform("Mozilla/5.0 (X11; Linux x86_64)")).toBe("linux");
    expect(cloudflaredPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe(
      "mobile",
    );
    expect(cloudflaredPlatform("Mozilla/5.0 (Android 14; Mobile)")).toBe("mobile");
    expect(cloudflaredPlatform("")).toBe("unknown");
  });

  it("maps desktop platforms to a copyable install command", () => {
    expect(cloudflaredInstallCommand("macos")).toBe("brew install cloudflared");
    expect(cloudflaredInstallCommand("windows")).toBe("winget install --id Cloudflare.cloudflared");
    expect(cloudflaredInstallCommand("linux")).toBeNull();
    expect(cloudflaredInstallCommand("mobile")).toBeNull();
  });
});

describe("pairing card targets", () => {
  it("prefers the hosted PWA link and keeps the direct link secondary", () => {
    const targets = pairingLinkTargets(
      pairingLink({ hostedUrl: "https://app.codeitlab.com/pair?host=abc#token=hosted-token" }),
    );

    expect(targets.primary.kind).toBe("hosted");
    expect(targets.primary.url).toBe("https://app.codeitlab.com/pair?host=abc#token=hosted-token");
    expect(targets.primary.title).toBe("PWA link");
    expect(targets.secondary?.kind).toBe("direct");
    expect(targets.secondary?.url).toBe(pairingLink().url);
    expect(hasHostedPairingLink(pairingLink({ hostedUrl: "https://app.codeitlab.com/pair" }))).toBe(
      true,
    );
  });

  it("falls back to the direct link when no hosted URL exists", () => {
    const targets = pairingLinkTargets(pairingLink());
    expect(targets.primary.kind).toBe("direct");
    expect(targets.primary.url).toBe(pairingLink().url);
    expect(targets.secondary).toBeNull();
    expect(hasHostedPairingLink(pairingLink({ hostedUrl: "   " }))).toBe(false);
  });

  it("explains how to reach the hosted PWA when the link is direct-only", () => {
    expect(hostedPairingHint({ link: pairingLink(), tunnel: tunnel() })).toContain(
      "Start the Cloudflare tunnel",
    );
    expect(
      hostedPairingHint({ link: pairingLink(), tunnel: tunnel({ available: false }) }),
    ).toContain("Install cloudflared");
    expect(hostedPairingHint({ link: pairingLink(), tunnel: tunnel({ running: true }) })).toContain(
      "Create a new phone link",
    );
    expect(
      hostedPairingHint({
        link: pairingLink({ hostedUrl: "https://app.codeitlab.com/pair" }),
        tunnel: tunnel(),
      }),
    ).toBeNull();
  });
});
