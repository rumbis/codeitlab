import { describe, expect, it } from "vite-plus/test";

import { CIL_HOME_DIRECTORY, cilHomePath } from "./homeDirectory.ts";

const joinPath = (...segments: string[]) => segments.join("/");

describe("CodeItLab home directory", () => {
  it("resolves ~/.cil", () => {
    expect(cilHomePath({ homeDirectory: "/home/ada", joinPath })).toBe(
      `/home/ada/${CIL_HOME_DIRECTORY}`,
    );
  });

  it("keeps the directory name stable", () => {
    expect(CIL_HOME_DIRECTORY).toBe(".cil");
  });
});
