import {
  graftAppliesToProject,
  graftInstructionLine,
  renderEcosystemInstructions,
  renderEcosystemPacks,
  resolvePackModes,
} from "@codeitlab/core/ecosystem";
import type { CodeitlabEcosystemSettings } from "@codeitlab/core/ecosystem";
import { DEFAULT_CODEITLAB_SETTINGS } from "@codeitlab/core/settings";
import { assert, it } from "@effect/vitest";

const settings = (overrides: {
  readonly ponytail?: Partial<CodeitlabEcosystemSettings["ponytail"]>;
  readonly terse?: Partial<CodeitlabEcosystemSettings["terse"]>;
  readonly graft?: Partial<CodeitlabEcosystemSettings["graft"]>;
}): CodeitlabEcosystemSettings => ({
  graft: { ...DEFAULT_CODEITLAB_SETTINGS.ecosystem.graft, ...overrides.graft },
  ponytail: { ...DEFAULT_CODEITLAB_SETTINGS.ecosystem.ponytail, ...overrides.ponytail },
  terse: { ...DEFAULT_CODEITLAB_SETTINGS.ecosystem.terse, ...overrides.terse },
});

it("ships both packs on by default (always-on, user never asks)", () => {
  const modes = resolvePackModes({ settings: settings({}) });
  assert.strictEqual(modes.ponytail, "full");
  assert.strictEqual(modes.terse, "lite");
});

it("renders the Ponytail pack with the closing risk line", () => {
  const text = renderEcosystemInstructions({ settings: settings({}) });
  assert.include(text, "## CodeItLab ecosystem policy");
  assert.include(text, "mode: full");
  assert.include(text, "what you skipped and the risk");
});

it("orders Ponytail before the terse pack and keeps both", () => {
  const packs = renderEcosystemPacks({
    settings: settings({ terse: { mode: "full" } }),
  });
  assert.deepEqual(
    packs.map((pack) => pack.id),
    ["ponytail", "terse"],
  );
  const text = renderEcosystemInstructions({
    settings: settings({ terse: { mode: "full" } }),
  });
  assert.isBelow(text.indexOf("Ponytail policy"), text.indexOf("Terse communication"));
  // The terse pack may compress but never removes Ponytail's risk line.
  assert.include(text, "what you skipped and the risk");
});

it("thread override turns every pack off", () => {
  const modes = resolvePackModes({
    settings: settings({ terse: { mode: "full" } }),
    threadOverride: "off",
  });
  assert.strictEqual(modes.ponytail, "off");
  assert.strictEqual(modes.terse, "off");
  assert.strictEqual(
    renderEcosystemInstructions({
      settings: settings({}),
      threadOverride: "off",
    }),
    "",
  );
});

it("honours per-pack disable and mode", () => {
  const modes = resolvePackModes({
    settings: settings({ ponytail: { enabled: false }, terse: { mode: "lite" } }),
  });
  assert.strictEqual(modes.ponytail, "off");
  assert.strictEqual(modes.terse, "lite");
});

it("gates Graft on git repos and the file threshold", () => {
  const graft = settings({}).graft;
  assert.isFalse(graftAppliesToProject({ settings: graft, isGitRepo: false, fileCount: 5000 }));
  assert.isFalse(graftAppliesToProject({ settings: graft, isGitRepo: true, fileCount: 50 }));
  assert.isTrue(graftAppliesToProject({ settings: graft, isGitRepo: true, fileCount: 500 }));
  assert.isTrue(
    graftAppliesToProject({
      settings: { ...graft, mode: "always" },
      isGitRepo: true,
      fileCount: 1,
    }),
  );
  assert.isFalse(
    graftAppliesToProject({
      settings: { ...graft, mode: "off" },
      isGitRepo: true,
      fileCount: 5000,
    }),
  );
});

it("tells the agent how to use the graph", () => {
  const line = graftInstructionLine();
  assert.include(line, "graft_repo_map");
  assert.include(line, "graft_check_freshness");
});
