import { describe, expect, it } from "vite-plus/test";

import { DEFAULT_MARKETPLACE_URL, resolveMarketplaceUrl } from "./marketplaceUrl";

describe("resolveMarketplaceUrl", () => {
  it("defaults to the public marketplace when unset or blank", () => {
    expect(resolveMarketplaceUrl(undefined)).toBe(DEFAULT_MARKETPLACE_URL);
    expect(resolveMarketplaceUrl("   ")).toBe(DEFAULT_MARKETPLACE_URL);
  });

  it("accepts a self-hosted base path and strips trailing slashes", () => {
    expect(resolveMarketplaceUrl("https://work.example.com/market/")).toBe(
      "https://work.example.com/market",
    );
    expect(resolveMarketplaceUrl("http://127.0.0.1:4174/market")).toBe(
      "http://127.0.0.1:4174/market",
    );
  });

  it("refuses anything that is not an http(s) URL", () => {
    expect(resolveMarketplaceUrl("javascript:alert(1)")).toBe(DEFAULT_MARKETPLACE_URL);
    expect(resolveMarketplaceUrl("data:text/html,<script>alert(1)</script>")).toBe(
      DEFAULT_MARKETPLACE_URL,
    );
    expect(resolveMarketplaceUrl("codeitlab.com/market")).toBe(DEFAULT_MARKETPLACE_URL);
  });

  it("drops a pasted query or hash but keeps the mount path", () => {
    expect(resolveMarketplaceUrl("https://work.example.com/market/?token=abc#x")).toBe(
      "https://work.example.com/market",
    );
  });
});
