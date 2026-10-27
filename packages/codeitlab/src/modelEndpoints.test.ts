import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  CodeItLabModelEndpointProbeResult,
  summarizeModelEndpointProbe,
} from "./modelEndpoints.ts";

const decode = Schema.decodeSync(CodeItLabModelEndpointProbeResult);

const result = (patch: Partial<CodeItLabModelEndpointProbeResult>) => ({
  ...decode({ checkedAt: "2026-10-25T03:00:00.000Z", baseUrl: "https://api.example.com/v1" }),
  reachable: true,
  models: [],
  ...patch,
});

describe("model endpoint probe result", () => {
  it("decodes a bare answer without inventing models", () => {
    const decoded = decode({ checkedAt: "2026-10-25T03:00:00.000Z", baseUrl: "https://x/v1" });
    expect(decoded.reachable).toBe(false);
    expect(decoded.models).toEqual([]);
  });

  it("reports a missing key as its own cause, not as a network failure", () => {
    expect(summarizeModelEndpointProbe(result({ reachable: false, missingKey: true }))).toBe(
      "The key variable is not set on this machine, so the endpoint was not asked.",
    );
  });

  it("distinguishes unreachable from reached-but-empty", () => {
    expect(summarizeModelEndpointProbe(result({ reachable: false, error: "timed out" }))).toBe(
      "Could not reach the endpoint: timed out",
    );
    expect(summarizeModelEndpointProbe(result({ reachable: true }))).toBe(
      "Reached the endpoint, but it listed no models.",
    );
    expect(summarizeModelEndpointProbe(result({ reachable: true, models: ["a"] }))).toBe(
      "Reached the endpoint: 1 model listed.",
    );
    expect(summarizeModelEndpointProbe(result({ reachable: true, models: ["a", "b"] }))).toBe(
      "Reached the endpoint: 2 models listed.",
    );
  });

  it("does not call an HTTP error a discovery success", () => {
    expect(summarizeModelEndpointProbe(result({ reachable: true, status: 401 }))).toBe(
      "The endpoint answered 401 and listed no models.",
    );
  });
});
