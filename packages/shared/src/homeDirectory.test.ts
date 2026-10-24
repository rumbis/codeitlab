import { describe, expect, it } from "vite-plus/test";

import {
  CODEITLAB_HOME_DIRECTORY,
  LEGACY_HOME_DIRECTORY,
  decideHomeDirectory,
} from "./homeDirectory.ts";

const joinPath = (...segments: string[]) => segments.join("/");
const decide = (currentExists: boolean, legacyExists: boolean) =>
  decideHomeDirectory({ homeDirectory: "/home/ada", joinPath, currentExists, legacyExists });

describe("CodeItLab home directory", () => {
  it("uses ~/.cil for a fresh install", () => {
    expect(decide(false, false)).toEqual({
      kind: "use",
      path: `/home/ada/${CODEITLAB_HOME_DIRECTORY}`,
    });
  });

  it("uses ~/.cil when it already exists", () => {
    const current = `/home/ada/${CODEITLAB_HOME_DIRECTORY}`;
    expect(decide(true, true)).toEqual({ kind: "use", path: current });
  });

  it("migrates ~/.t3 to ~/.cil when only the legacy directory exists", () => {
    const legacy = `/home/ada/${LEGACY_HOME_DIRECTORY}`;
    expect(decide(false, true)).toEqual({
      kind: "migrate",
      from: legacy,
      to: `/home/ada/${CODEITLAB_HOME_DIRECTORY}`,
    });
  });
});
