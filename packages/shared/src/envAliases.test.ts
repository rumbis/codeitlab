import { describe, expect, it } from "vite-plus/test";

import { applyCilEnvAliases } from "./envAliases.ts";

describe("CIL_ environment aliases", () => {
  it("copies CIL_HOME to T3CODE_HOME", () => {
    const env: NodeJS.ProcessEnv = { CIL_HOME: "/home/ada/.cil" };
    expect(applyCilEnvAliases(env)).toEqual(["T3CODE_HOME"]);
    expect(env.T3CODE_HOME).toBe("/home/ada/.cil");
  });

  it("never overrides an explicitly set legacy name", () => {
    const env: NodeJS.ProcessEnv = { CIL_HOME: "/new", T3CODE_HOME: "/pinned" };
    expect(applyCilEnvAliases(env)).toEqual([]);
    expect(env.T3CODE_HOME).toBe("/pinned");
  });

  it("treats a blank legacy value as unset and leaves other names alone", () => {
    const env: NodeJS.ProcessEnv = { CIL_HOME: "/new", T3CODE_HOME: "  ", PATH: "/bin" };
    expect(applyCilEnvAliases(env)).toEqual(["T3CODE_HOME"]);
    expect(env.T3CODE_HOME).toBe("/new");
    expect(env.PATH).toBe("/bin");
  });
});
