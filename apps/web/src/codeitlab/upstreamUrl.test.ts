import { describe, expect, it } from "vite-plus/test";

import { FIREWALL_UPSTREAMS, firewallUpstreamUrl } from "./upstreamUrl";

const decode = (segment: string): string => atob(segment.replace(/-/gu, "+").replace(/_/gu, "/"));

describe("firewallUpstreamUrl", () => {
  it("encodes the upstream in a path segment the gateway understands", () => {
    const url = firewallUpstreamUrl("http://127.0.0.1:5284/v1", "https://api.anthropic.com");
    expect(url.startsWith("http://127.0.0.1:5284/upstream/")).toBe(true);
    const segment = url.slice("http://127.0.0.1:5284/upstream/".length);
    expect(segment).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(segment).not.toContain("=");
    expect(decode(segment)).toBe("https://api.anthropic.com");
  });

  it("accepts a gateway URL with a trailing slash or without the version path", () => {
    for (const gateway of [
      "http://127.0.0.1:5284",
      "http://127.0.0.1:5284/",
      "http://127.0.0.1:5284/v1/",
    ]) {
      expect(firewallUpstreamUrl(gateway, "https://api.openai.com")).toBe(
        firewallUpstreamUrl("http://127.0.0.1:5284/v1", "https://api.openai.com"),
      );
    }
  });

  it("ships one row per provider API the agents speak", () => {
    expect(FIREWALL_UPSTREAMS.map((entry) => entry.environmentVariable)).toEqual([
      "ANTHROPIC_BASE_URL",
      "OPENAI_BASE_URL",
    ]);
    for (const entry of FIREWALL_UPSTREAMS) {
      expect(firewallUpstreamUrl("http://127.0.0.1:5284/v1", entry.upstream)).toContain(
        "/upstream/",
      );
    }
  });
});
