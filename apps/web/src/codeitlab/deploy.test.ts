import { describe, expect, it } from "vite-plus/test";

import { DEPLOY_STARTERS, createDeployTarget, starterDeployTarget } from "./deploy.ts";

const now = new Date("2026-10-24T12:00:00.000Z");

describe("deploy targets", () => {
  it("creates an empty, enabled target with a unique id", () => {
    const first = createDeployTarget(now);
    const second = createDeployTarget(now);
    expect(first.enabled).toBe(true);
    expect(first.command).toBe("");
    expect(first.id).not.toBe(second.id);
  });

  it("copies a starter's command and notes", () => {
    const vercel = DEPLOY_STARTERS[0]!;
    const target = starterDeployTarget(now, vercel);
    expect(target.name).toBe("Vercel");
    expect(target.command).toBe("vercel deploy --prod");
    expect(target.notes).toContain("CLI");
  });

  it("keeps the custom starter empty so it cannot run by accident", () => {
    const custom = DEPLOY_STARTERS.find((starter) => starter.name === "Custom")!;
    expect(custom.command).toBe("");
  });
});
