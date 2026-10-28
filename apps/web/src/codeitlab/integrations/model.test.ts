import { describe, expect, it } from "vite-plus/test";

import type { CodeItLabIntegrationStatus } from "@codeitlab/contracts";

import {
  findIntegration,
  findIntegrationAction,
  findSetupCommand,
  formatIntegrationLatency,
  integrationStateLabel,
  integrationStateVariant,
  integrationWiredCount,
  normalizeBaseUrlInput,
  wiredChipVariant,
} from "./model";

const status: CodeItLabIntegrationStatus = {
  id: "shorts",
  name: "Shorts",
  tagline: "Clips.",
  engine: "OpenShorts",
  enabled: true,
  configured: true,
  state: "ready",
  baseUrl: "http://127.0.0.1:8000",
  reachable: true,
  latencyMs: 42,
  wired: ["mcp · openshorts"],
  actions: [
    { id: "repo", label: "OpenShorts on GitHub", kind: "link", value: "https://example.com/repo" },
    {
      id: "install",
      label: "Install",
      kind: "install",
      value: "uv sync",
      hint: "Run in the engine repo.",
    },
    { id: "docs", label: "Docs", kind: "link", value: "https://example.com/docs" },
  ],
};

describe("integration display model", () => {
  it("maps every state to a label and badge variant", () => {
    expect(integrationStateLabel("ready")).toBe("Ready");
    expect(integrationStateLabel("unreachable")).toBe("Unreachable");
    expect(integrationStateLabel("not-configured")).toBe("Not configured");
    expect(integrationStateLabel("disabled")).toBe("Disabled");

    expect(integrationStateVariant("ready")).toBe("success");
    expect(integrationStateVariant("unreachable")).toBe("error");
    expect(integrationStateVariant("not-configured")).toBe("warning");
    expect(integrationStateVariant("disabled")).toBe("secondary");
  });

  it("normalises typed base URLs without inventing a path", () => {
    expect(normalizeBaseUrlInput("  localhost:8000/  ")).toBe("http://localhost:8000");
    expect(normalizeBaseUrlInput("https://clips.example.com/")).toBe("https://clips.example.com");
    expect(normalizeBaseUrlInput("http://10.0.0.5:8000/api/")).toBe("http://10.0.0.5:8000/api");
    expect(normalizeBaseUrlInput("   ")).toBe("");
    expect(normalizeBaseUrlInput("tailscale-host:5173")).toBe("http://tailscale-host:5173");
  });

  it("formats latency only when it is a usable number", () => {
    expect(formatIntegrationLatency(42)).toBe("42 ms");
    expect(formatIntegrationLatency(0)).toBe("0 ms");
    expect(formatIntegrationLatency(undefined)).toBeNull();
    expect(formatIntegrationLatency(Number.NaN)).toBeNull();
    expect(formatIntegrationLatency(-5)).toBeNull();
  });

  it("finds integrations, actions, and the first setup command", () => {
    expect(findIntegration([status], "shorts")).toBe(status);
    expect(findIntegration([status], "crew")).toBeNull();
    expect(findIntegrationAction(status.actions, "repo")?.value).toBe("https://example.com/repo");
    expect(findIntegrationAction(status.actions, "missing")).toBeNull();
    expect(findSetupCommand(status.actions)?.id).toBe("install");
    expect(
      findSetupCommand([
        { id: "repo", label: "Repo", kind: "link", value: "https://example.com" },
        { id: "copy", label: "Command", kind: "copy", value: "npx modsearch" },
      ])?.id,
    ).toBe("copy");
    expect(findSetupCommand([{ id: "repo", label: "Repo", kind: "link", value: "x" }])).toBeNull();
  });

  it("classifies per-surface wired chips", () => {
    expect(wiredChipVariant("mcp · openshorts")).toBe("info");
    expect(wiredChipVariant("skill · crew")).toBe("secondary");
  });

  it("counts wired agent surfaces", () => {
    expect(integrationWiredCount({ mcpServers: ["shorts"], skills: ["search"] })).toBe(2);
    expect(integrationWiredCount({ mcpServers: [], skills: [] })).toBe(0);
  });
});
