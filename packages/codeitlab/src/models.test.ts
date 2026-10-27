import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  CodeItLabModelEndpoint,
  CodeItLabModelsSettings,
  MODEL_ENDPOINT_MODEL_LIMIT,
  modelEndpointDisplayLabel,
  modelEndpointSlug,
  modelEndpointUrl,
  modelMaskingBadge,
  modelVisibilityKey,
  normalizeModelEndpointBaseUrl,
  parseModelEndpointModelIds,
} from "./models.ts";

const decodeSettings = Schema.decodeSync(CodeItLabModelsSettings);
const decodeEndpoint = Schema.decodeSync(CodeItLabModelEndpoint);

const endpoint = (patch: Partial<CodeItLabModelEndpoint>): CodeItLabModelEndpoint => ({
  ...decodeEndpoint({}),
  id: "local",
  label: "Local gateway",
  baseUrl: "https://api.example.com/v1",
  apiKeyEnv: "",
  models: [],
  enabled: true,
  maskPrompts: true,
  ...patch,
});

describe("custom model endpoints", () => {
  it("decodes an empty block with the firewall on", () => {
    const settings = decodeSettings({});
    expect(settings.endpoints).toEqual([]);
    expect(decodeEndpoint({}).maskPrompts).toBe(true);
    expect(decodeEndpoint({}).enabled).toBe(true);
  });

  it("canonicalizes a base URL and drops trailing slashes", () => {
    expect(normalizeModelEndpointBaseUrl("https://api.example.com/v1/")).toEqual({
      ok: true,
      baseUrl: "https://api.example.com/v1",
    });
    expect(normalizeModelEndpointBaseUrl("  https://api.example.com  ")).toEqual({
      ok: true,
      baseUrl: "https://api.example.com",
    });
    expect(normalizeModelEndpointBaseUrl("https://api.example.com:8443/v1")).toEqual({
      ok: true,
      baseUrl: "https://api.example.com:8443/v1",
    });
  });

  it("allows plain http only on this machine or the LAN", () => {
    for (const host of [
      "http://localhost:1234/v1",
      "http://127.0.0.1:8080/v1",
      "http://192.168.1.20:8000/v1",
      "http://10.0.0.5/v1",
      "http://172.20.1.9/v1",
    ]) {
      expect(normalizeModelEndpointBaseUrl(host).ok).toBe(true);
    }
    const publicHttp = normalizeModelEndpointBaseUrl("http://api.example.com/v1");
    expect(publicHttp.ok).toBe(false);
    if (!publicHttp.ok) expect(publicHttp.reason).toContain("https");
  });

  it("refuses what would fail later: bad scheme, credentials, query", () => {
    expect(normalizeModelEndpointBaseUrl("").ok).toBe(false);
    expect(normalizeModelEndpointBaseUrl("api.example.com").ok).toBe(false);
    expect(normalizeModelEndpointBaseUrl("ftp://api.example.com").ok).toBe(false);
    expect(normalizeModelEndpointBaseUrl("https://user:pass@api.example.com").ok).toBe(false);
    expect(normalizeModelEndpointBaseUrl("https://api.example.com/v1?key=1").ok).toBe(false);
    expect(normalizeModelEndpointBaseUrl("https://api.example.com/v1#top").ok).toBe(false);
  });

  it("joins OpenAI paths onto a valid base URL", () => {
    expect(modelEndpointUrl("https://api.example.com/v1/", "models")).toBe(
      "https://api.example.com/v1/models",
    );
    expect(modelEndpointUrl("https://api.example.com/v1", "/chat/completions")).toBe(
      "https://api.example.com/v1/chat/completions",
    );
    expect(modelEndpointUrl("not a url", "models")).toBeNull();
  });

  it("reads model ids from the shapes gateways actually return", () => {
    expect(parseModelEndpointModelIds('{"data":[{"id":"a"},{"id":"b"}]}')).toEqual(["a", "b"]);
    expect(parseModelEndpointModelIds('["a","b"]')).toEqual(["a", "b"]);
    expect(parseModelEndpointModelIds('{"models":[{"name":"a"},{"model":"b"}]}')).toEqual([
      "a",
      "b",
    ]);
    expect(parseModelEndpointModelIds('{"data":[{"id":"a"},{"id":"a"},{"id":""}]}')).toEqual(["a"]);
    expect(parseModelEndpointModelIds("not json")).toEqual([]);
    expect(parseModelEndpointModelIds('{"data":{}}')).toEqual([]);
    expect(parseModelEndpointModelIds("null")).toEqual([]);
  });

  it("caps an aggregator's model list", () => {
    const body = JSON.stringify({
      data: Array.from({ length: MODEL_ENDPOINT_MODEL_LIMIT + 50 }, (_, index) => ({
        id: `model-${index}`,
      })),
    });
    expect(parseModelEndpointModelIds(body)).toHaveLength(MODEL_ENDPOINT_MODEL_LIMIT);
  });

  it("names a row by its label, else by the host it points at", () => {
    expect(modelEndpointDisplayLabel(endpoint({ label: "Work gateway" }))).toBe("Work gateway");
    expect(
      modelEndpointDisplayLabel(endpoint({ label: "  ", baseUrl: "https://gw.example.com/v1" })),
    ).toBe("gw.example.com");
    expect(modelEndpointDisplayLabel(endpoint({ label: "", baseUrl: "nonsense" }))).toBe(
      "Untitled endpoint",
    );
  });

  it("slugs a label so re-adding replaces the same endpoint", () => {
    expect(modelEndpointSlug("My  Gateway / EU")).toBe("my-gateway-eu");
    expect(modelEndpointSlug("!!!")).toBe("endpoint");
    expect(modelEndpointSlug("")).toBe("endpoint");
  });
});

describe("model visibility", () => {
  // Which models a picker hides lives in providerModelPreferences, so the only
  // rule left here is how a row is keyed: two providers may serve the same slug.
  it("keys a model by instance so two providers can share a slug", () => {
    expect(modelVisibilityKey("claude", "claude-opus-5")).toBe("claude::claude-opus-5");
    expect(modelVisibilityKey(" codex ", " gpt-5 ")).toBe("codex::gpt-5");
  });
});

describe("masking promise", () => {
  it("never claims masking while the firewall is off", () => {
    expect(modelMaskingBadge({ maskPrompts: true, firewallEnabled: true })).toBe("masked");
    expect(modelMaskingBadge({ maskPrompts: false, firewallEnabled: true })).toBe("raw");
    expect(modelMaskingBadge({ maskPrompts: true, firewallEnabled: false })).toBe("off");
  });
});
