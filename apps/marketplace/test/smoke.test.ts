import { describe, expect, it } from "vite-plus/test";

import { runSmoke } from "../src/server/smoke.ts";

describe("end-to-end smoke", () => {
  it("walks the whole money path against a throwaway database", async () => {
    const steps = await runSmoke();
    expect(steps.map((step) => step.name)).toEqual([
      "sign in",
      "profile",
      "job",
      "application",
      "escrow",
      "delivery",
      "receipt",
      "ledger",
      "health",
    ]);
    expect(steps.find((step) => step.name === "ledger")?.detail).toContain("held 0");
  }, 20_000);
});
