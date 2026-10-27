import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import {
  DEFAULT_CODEITLAB_SETTINGS,
  NexusService,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@codeitlab/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { describe, expect } from "vite-plus/test";

import { ServerConfig } from "../../config.ts";
import { ProviderInstanceRegistry } from "../../provider/ProviderInstanceRegistry.ts";
import { ProviderRegistry } from "../../provider/ProviderRegistry.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { layer } from "./NexusService.ts";

const hermesProvider = {
  instanceId: ProviderInstanceId.make("hermes"),
  driver: ProviderDriverKind.make("hermes"),
  displayName: "Hermes",
  enabled: true,
  installed: true,
  version: "0.22.4",
  status: "ready",
  checkedAt: "2026-10-22T10:00:00.000Z",
  skills: [],
  models: [],
  auth: { status: "authenticated" },
} as unknown as ServerProvider;

const fakeRegistryLayer = Layer.succeed(ProviderRegistry, {
  getProviders: Effect.succeed([hermesProvider]),
} as unknown as ProviderRegistry["Service"]);

const fakeInstancesLayer = Layer.succeed(ProviderInstanceRegistry, {
  listInstances: Effect.succeed([]),
} as unknown as ProviderInstanceRegistry["Service"]);

const settingsLayer = ServerSettingsService.layerTest({
  codeitlab: {
    ...DEFAULT_CODEITLAB_SETTINGS,
    nexus: {
      ...DEFAULT_CODEITLAB_SETTINGS.nexus,
      // Ingestion readers are covered by nexus.test.ts; this test only proves
      // the service layer, persistence path and cache.
      includeSkills: false,
      includeSessions: false,
      includeMcp: false,
      customAcpAgents: [],
    },
  },
});

const configLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "nexus-service-test-",
}).pipe(Layer.provide(NodeServices.layer));

const testLayer = layer.pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      fakeRegistryLayer,
      fakeInstancesLayer,
      settingsLayer,
      configLayer,
      NodeServices.layer,
    ),
  ),
);

describe("NexusService layer", () => {
  it.effect("builds, persists and then serves the catalog from cache", () =>
    Effect.gen(function* () {
      const service = yield* NexusService;
      const config = yield* ServerConfig;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      const first = yield* service.catalog;
      expect(first.providers).toEqual([
        expect.objectContaining({
          instanceId: "hermes",
          driverKind: "hermes",
          name: "Hermes",
          available: true,
          transport: "local",
        }),
      ]);

      const catalogPath = path.join(config.stateDir, "codeitlab", "nexus", "catalog.json");
      const persisted = yield* fs.readFileString(catalogPath);
      expect(JSON.parse(persisted)).toMatchObject({ generatedAt: first.generatedAt });

      // The second read is served from memory: no new generatedAt timestamp.
      const second = yield* service.catalog;
      expect(second.generatedAt).toBe(first.generatedAt);

      const refreshed = yield* service.refresh;
      expect(refreshed.providers.map((provider) => provider.instanceId)).toEqual(["hermes"]);
      const afterRefresh = yield* fs.readFileString(catalogPath);
      expect(JSON.parse(afterRefresh)).toMatchObject({ generatedAt: refreshed.generatedAt });
    }).pipe(Effect.provide(testLayer)),
  );

  it.live("keeps a persisted catalog across service restarts", () =>
    Effect.gen(function* () {
      // Build a fresh service instance so the in-memory cache starts empty.
      const context = yield* Layer.build(testLayer);
      const service = Context.get(context, NexusService);
      const config = Context.get(context, ServerConfig);
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      const generatedAt = DateTime.formatIso(yield* DateTime.now);
      yield* fs.makeDirectory(path.join(config.stateDir, "codeitlab", "nexus"), {
        recursive: true,
      });
      yield* fs.writeFileString(
        path.join(config.stateDir, "codeitlab", "nexus", "catalog.json"),
        JSON.stringify({
          generatedAt,
          providers: [],
          skills: [
            {
              id: "hermes:persisted",
              name: "persisted",
              description: "Loaded from disk.",
              source: "hermes",
              alsoAvailableIn: [],
            },
          ],
          mcpServers: [],
          sessions: [],
          warnings: ["cached"],
        }),
      );

      const catalog = yield* service.catalog;
      expect(catalog.skills.map((skill) => skill.id)).toEqual(["hermes:persisted"]);
      expect(catalog.warnings).toEqual(["cached"]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
