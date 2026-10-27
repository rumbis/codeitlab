import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  MAX_TEAM_RUNS,
  MAX_TEAM_WORKERS,
  CodeItLabTeamPreset,
  CodeItLabTeamRun,
  CodeItLabTeamSettings,
  appendTeamRun,
} from "./team.ts";

const decodeSettings = Schema.decodeSync(CodeItLabTeamSettings);
const decodeRun = Schema.decodeSync(CodeItLabTeamRun);
const decodePreset = Schema.decodeSync(CodeItLabTeamPreset);

describe("team settings", () => {
  it("decodes from an empty object with no presets", () => {
    const settings = decodeSettings({});
    expect(settings.presets).toEqual([]);
  });

  it("fills a preset from partial data so older saves keep working", () => {
    const preset = decodePreset({ name: "Review pair" });
    expect(preset.name).toBe("Review pair");
    expect(preset.workers).toEqual([]);
    expect(preset.architectInstanceId).toBe("");
  });

  it("decodes a worker without an explicit model", () => {
    const preset = decodePreset({
      id: "team-2",
      name: "Ship it",
      workers: [{ id: "w1", name: "Tests", role: "tests" }],
    });
    expect(preset.workers[0]?.model).toBe("");
    expect(preset.workers[0]?.instanceId).toBe("");
  });

  it("keeps the documented worker cap", () => {
    expect(MAX_TEAM_WORKERS).toBe(3);
  });
});

describe("team runs", () => {
  it("decodes an empty settings block with no runs", () => {
    expect(decodeSettings({}).runs).toEqual([]);
  });

  it("keeps the newest runs and caps the list", () => {
    const run = (id: string) => decodeRun({ id, threadId: `thread-${id}` });
    const runs = Array.from({ length: MAX_TEAM_RUNS }, (_, index) => run(`run-${index}`));
    const next = appendTeamRun(runs, run("run-new"));
    expect(next).toHaveLength(MAX_TEAM_RUNS);
    expect(next[0]?.id).toBe("run-new");
    expect(next.some((entry) => entry.id === `run-${MAX_TEAM_RUNS - 1}`)).toBe(false);
  });

  it("replaces a run with the same id instead of duplicating it", () => {
    const run = decodeRun({ id: "run-1", task: "old" });
    const updated = decodeRun({ id: "run-1", task: "new" });
    const runs = appendTeamRun([run], updated);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.task).toBe("new");
  });
});
