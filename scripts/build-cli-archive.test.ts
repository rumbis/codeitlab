// @effect-diagnostics nodeBuiltinImport:off - the guard reads the build config from disk.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { cliArchiveBuiltExecutableName } from "./build-cli-archive.ts";

const SERVER_DIR = NodePath.resolve(new URL("../apps/server/", import.meta.url).pathname);

/**
 * The archiver copies the executable the build wrote into the archive under the
 * name the installers ask for. When the two drifted, every Windows build failed
 * with "missing dist-exe/cil.exe" while the executable sat there under its real
 * name, so read the build config instead of trusting the literal.
 */
describe("cli archive input", () => {
  it("names the executable the way the server build writes it", () => {
    const config = NodeFS.readFileSync(NodePath.join(SERVER_DIR, "vite.config.ts"), "utf8");
    const fileName = /exe:\s*\{[^}]*?fileName:\s*"([^"]+)"/s.exec(config)?.[1];
    expect(fileName).toBeTruthy();

    for (const platform of ["mac", "linux", "win"] as const) {
      const built = cliArchiveBuiltExecutableName(platform);
      expect(built.startsWith(fileName ?? "\u0000")).toBe(true);
      expect(built).toBe(platform === "win" ? `${fileName}.exe` : fileName);
    }
  });
});
