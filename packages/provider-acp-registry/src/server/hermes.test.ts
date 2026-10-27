import { ProviderDriverKind, type ServerProvider } from "@codeitlab/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import { DEFAULT_HERMES_SETTINGS, HermesSettings, hermesAcpSettings } from "../settings.ts";
import {
  HERMES_DRIVER_KIND,
  HERMES_DRIVER_METADATA,
  HermesAdapterV2Driver,
  HermesDriver,
  restampHermesProvider,
} from "./hermes.ts";

const decodeHermes = Schema.decodeSync(HermesSettings);

describe("hermesAcpSettings", () => {
  it("launches the default install as `hermes acp`", () => {
    const mapped = hermesAcpSettings(DEFAULT_HERMES_SETTINGS);

    expect(mapped.source).toBe("local");
    expect(mapped.commandPath).toBe("hermes");
    expect(mapped.commandArgs).toEqual(["acp"]);
    expect(mapped.agentId).toBe("hermes");
    expect(mapped.enabled).toBe(false);
  });

  it("supports a standalone hermes-acp binary without the acp subcommand", () => {
    const mapped = hermesAcpSettings(
      decodeHermes({ binaryPath: "/Users/example/.local/bin/hermes-acp", acpSubcommand: false }),
    );

    expect(mapped.commandPath).toBe("/Users/example/.local/bin/hermes-acp");
    expect(mapped.commandArgs).toEqual([]);
  });

  it("passes --accept-hooks when the user opts in", () => {
    const mapped = hermesAcpSettings(decodeHermes({ acceptHooks: true }));

    expect(mapped.commandArgs).toEqual(["acp", "--accept-hooks"]);
  });

  it("keeps custom models and the auth method id across the translation", () => {
    const mapped = hermesAcpSettings(
      decodeHermes({
        authMethodId: "hermes-login",
        customModels: [{ slug: "hermes-custom", name: "Hermes Custom" }],
      }),
    );

    expect(mapped.authMethodId).toBe("hermes-login");
    expect(mapped.customModels).toEqual(["hermes-custom"]);
  });
});

describe("Hermes driver registration", () => {
  it("registers under its own driver kind as a built-in default instance", () => {
    expect(HermesDriver.driverKind).toBe(ProviderDriverKind.make("hermes"));
    expect(HERMES_DRIVER_KIND).toBe("hermes");
    expect(HermesDriver.metadata).toEqual(HERMES_DRIVER_METADATA);
    expect(HermesDriver.metadata.displayName).toBe("Hermes");
    expect(HermesDriver.metadata.hasDefaultInstance).toBe(true);
    expect(HermesDriver.metadata.supportsMultipleInstances).toBe(true);
    expect(HermesAdapterV2Driver.driverKind).toBe(HERMES_DRIVER_KIND);
  });

  it("decodes an empty instance config into the default settings", () => {
    expect(HermesDriver.defaultConfig()).toEqual(DEFAULT_HERMES_SETTINGS);
    expect(Schema.decodeSync(HermesDriver.configSchema)({})).toEqual(DEFAULT_HERMES_SETTINGS);
  });

  it("re-stamps inherited snapshots to the Hermes driver kind", () => {
    // ProviderRegistry dies when a driver emits a snapshot for another driver.
    const snapshot = { driver: "acpRegistry", instanceId: "hermes" } as ServerProvider;
    expect(restampHermesProvider(snapshot).driver).toBe("hermes");
    const alreadyHermes = { ...snapshot, driver: "hermes" } as ServerProvider;
    expect(restampHermesProvider(alreadyHermes)).toBe(alreadyHermes);
  });
});
