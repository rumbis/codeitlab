import { CodeItLabCredentialsStatus } from "@codeitlab/core/credentials";
import { CodeItLabEcosystemStatus } from "@codeitlab/core/ecosystem";
import { CodeItLabIntegrationList } from "@codeitlab/core/integrations";
import { CodeItLabRemoteStatus } from "@codeitlab/core/remote";
import { RoutingCatalog } from "@codeitlab/core/routing";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { questFactsFrom } from "./QuestsService.ts";

const decodeEcosystemStatus = Schema.decodeUnknownSync(CodeItLabEcosystemStatus);
const decodeIntegrationList = Schema.decodeUnknownSync(CodeItLabIntegrationList);
const decodeCredentialsStatus = Schema.decodeUnknownSync(CodeItLabCredentialsStatus);
const decodeRoutingCatalog = Schema.decodeUnknownSync(RoutingCatalog);
const decodeRemoteStatus = Schema.decodeUnknownSync(CodeItLabRemoteStatus);

const decodeRemote = (loopbackOnly: boolean, tunnelRunning = false) =>
  decodeRemoteStatus({
    tailnet: { available: false, running: false },
    server: { host: "127.0.0.1", port: 4310, loopbackOnly, urls: [] },
    tunnel: { available: tunnelRunning, running: tunnelRunning },
    pairingAvailable: true,
  });

describe("questFactsFrom", () => {
  it("degrades every failed probe to zero instead of throwing", () => {
    expect(questFactsFrom({})).toEqual({
      agentsInstalled: 0,
      modelsConfigured: 0,
      memoryEntries: 0,
      reaInstalled: false,
      studioProjects: 0,
      studioVideos: 0,
      integrationsConfigured: 0,
      remoteReachable: false,
      credentialsActive: false,
      boardTasks: 0,
      boardCompleted: 0,
    });
  });

  it("counts only enabled and available agents, and configured integrations", () => {
    const ecosystemStatus = decodeEcosystemStatus({
      generatedAt: "2026-01-01T00:00:00.000Z",
      warnings: [],
      integrations: [
        {
          id: "graft",
          name: "Graft",
          kind: "policy-pack",
          enabled: true,
          mode: "auto",
          available: true,
          detail: "",
          warnings: [],
        },
        {
          id: "ponytail",
          name: "Ponytail",
          kind: "policy-pack",
          enabled: true,
          mode: "off",
          available: false,
          detail: "",
          warnings: [],
        },
      ],
    });
    const integrationList = decodeIntegrationList({
      wired: { mcpServers: [], skills: [] },
      integrations: [
        {
          id: "shorts",
          name: "Shorts",
          tagline: "",
          engine: "OpenShorts",
          enabled: true,
          configured: true,
          state: "ready",
          reachable: true,
          wired: [],
          actions: [],
        },
        {
          id: "crew",
          name: "Crew",
          tagline: "",
          engine: "Crew",
          enabled: true,
          configured: false,
          state: "not-configured",
          reachable: false,
          wired: [],
          actions: [],
        },
      ],
    });
    const facts = questFactsFrom({ ecosystemStatus, integrationList });
    expect(facts.agentsInstalled).toBe(1);
    expect(facts.integrationsConfigured).toBe(1);
  });

  it("counts video projects and treats a reachable server as remote-ready", () => {
    const base = {
      id: "p1",
      name: "Deck",
      kind: "deck" as const,
      theme: "matrix" as const,
      aspect: "16:9" as const,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      slides: [],
    };
    const credentialsStatus = decodeCredentialsStatus({
      enabled: true,
      running: true,
      gatewayUrl: "http://127.0.0.1:5284/v1",
      model: {
        id: "tiny",
        label: "Tiny",
        version: "1.0.0",
        sizeBytes: 1,
        state: "ready",
      },
    });
    const facts = questFactsFrom({
      projects: [base, { ...base, id: "p2", kind: "video" }],
      remoteStatus: decodeRemote(false),
      credentialsStatus,
    });
    expect(facts.studioProjects).toBe(2);
    expect(facts.studioVideos).toBe(1);
    expect(facts.remoteReachable).toBe(true);
    expect(facts.credentialsActive).toBe(true);

    const loopback = questFactsFrom({ remoteStatus: decodeRemote(true) });
    expect(loopback.remoteReachable).toBe(false);
  });

  it("sums routing models across providers", () => {
    const routingCatalog = decodeRoutingCatalog({
      mode: "auto",
      providers: [
        {
          providerInstanceId: "a",
          providerKind: "claude",
          name: "A",
          models: ["m1", "m2"],
          available: true,
          quota: 1,
          speed: 1,
          smartness: 1,
        },
        {
          providerInstanceId: "b",
          providerKind: "codex",
          name: "B",
          models: ["m3"],
          available: false,
          quota: 0,
          speed: 0,
          smartness: 0,
        },
      ],
    });
    const facts = questFactsFrom({ routingCatalog });
    expect(facts.modelsConfigured).toBe(3);
  });
});
