import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  CodeitlabDeploySettings,
  buildDeployBrief,
  deployTargetIssue,
  type CodeitlabDeployTarget,
} from "./deploy.ts";

const decodeSettings = Schema.decodeSync(CodeitlabDeploySettings);

const target = (patch: Partial<CodeitlabDeployTarget>): CodeitlabDeployTarget => ({
  ...decodeSettings({}).targets[0]!,
  id: "deploy-1",
  name: "Vercel",
  command: "vercel deploy --prod",
  notes: "",
  enabled: true,
  ...patch,
});

describe("deploy settings", () => {
  it("decodes an empty block", () => {
    expect(decodeSettings({}).targets).toEqual([]);
  });

  it("reports what a target is missing", () => {
    expect(deployTargetIssue(target({}))).toBeNull();
    expect(deployTargetIssue(target({ name: "  " }))).toContain("name");
    expect(deployTargetIssue(target({ command: "" }))).toContain("command");
    expect(deployTargetIssue(target({ command: "vercel\ndeploy" }))).toContain("one line");
  });

  it("writes a brief that forbids inventing a URL or logging in silently", () => {
    const brief = buildDeployBrief(target({ notes: "production only" }));
    expect(brief).toContain("vercel deploy --prod");
    expect(brief).toContain("Do not invent a deployment URL");
    expect(brief).toContain("ask before installing or logging in");
    expect(brief).toContain("production only");
  });
});
