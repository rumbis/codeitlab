import { defaultInstanceIdForDriver, ProviderDriverKind } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import { BUILT_IN_PROVIDER_ADAPTER_DRIVER_KINDS_V2 } from "../orchestration-v2/builtInProviderAdapterDrivers.ts";
import { BUILT_IN_DRIVERS } from "./builtInDrivers.ts";
import { BUNDLED_MODEL_MANIFEST } from "./ModelManifest.ts";
import { resolveProviderCompatibility } from "./providerCompatibility.ts";

const HERMES = ProviderDriverKind.make("hermes");

describe("Hermes provider registration", () => {
  it("ships as a built-in driver with a default instance", () => {
    const hermes = BUILT_IN_DRIVERS.find((driver) => driver.driverKind === HERMES);

    expect(hermes).toBeDefined();
    expect(hermes?.metadata.displayName).toBe("Hermes");
    expect(hermes?.metadata.hasDefaultInstance).not.toBe(false);
    expect(defaultInstanceIdForDriver(HERMES)).toBe("hermes");
  });

  it("registers an orchestration adapter driver for the Hermes driver kind", () => {
    expect(BUILT_IN_PROVIDER_ADAPTER_DRIVER_KINDS_V2.has(HERMES)).toBe(true);
  });

  it("bundles a compatibility policy so provider refreshes stay honest", () => {
    const advisory = resolveProviderCompatibility(
      BUNDLED_MODEL_MANIFEST.compatibility,
      HERMES,
      null,
      "0.0.46",
    );

    expect(advisory).toBeDefined();
    expect(advisory?.status).toBe("unknown");
  });
});
