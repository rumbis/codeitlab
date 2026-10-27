import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, expect, it } from "@effect/vitest";
import * as HostProcess from "@codeitlab/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import packageJson from "../../package.json" with { type: "json" };
import {
  formatCliCommand,
  resolveHostCliCommand,
  resolveRootCliCommand,
  resolveServerInstallation,
} from "./invocation.ts";

it("formats package runner commands from their cache entry paths", () => {
  for (const [entryPath, expected] of [
    ["/home/theo/.npm/_npx/abc123/node_modules/codeitlab/dist/bin.mjs", "npx codeitlab serve"],
    [
      "C:\\Users\\theo\\AppData\\Local\\npm-cache\\_npx\\abc\\node_modules\\codeitlab\\dist\\bin.mjs",
      "npx codeitlab serve",
    ],
    [
      "/home/theo/.cache/pnpm/dlx/abc/node_modules/codeitlab/dist/bin.mjs",
      "pnpm dlx codeitlab serve",
    ],
    [
      "/home/theo/.local/share/pnpm/.pnpm/dlx/abc/node_modules/codeitlab/dist/bin.mjs",
      "pnpm dlx codeitlab serve",
    ],
    [
      "C:\\Users\\theo\\AppData\\Local\\pnpm-cache\\dlx\\abc\\node_modules\\codeitlab\\dist\\bin.mjs",
      "pnpm dlx codeitlab serve",
    ],
    ["/home/theo/.bun/install/cache/codeitlab@0.0.31/dist/bin.mjs", "bunx codeitlab serve"],
    ["/tmp/bunx-1000-codeitlab@latest/node_modules/codeitlab/dist/bin.mjs", "bunx codeitlab serve"],
    [
      "C:\\Users\\theo\\AppData\\Local\\Temp\\bunx-0-codeitlab@latest\\node_modules\\codeitlab\\dist\\bin.mjs",
      "bunx codeitlab serve",
    ],
  ] as const) {
    assert.equal(formatCliCommand({ subcommand: "serve", entryPath, version: "0.0.31" }), expected);
  }
});

it("treats stable installs as direct invocations", () => {
  for (const entryPath of [
    "/usr/local/lib/node_modules/codeitlab/dist/bin.mjs",
    "/home/theo/Code/work/codeitlab/apps/server/dist/bin.mjs",
    "/home/theo/.cil/runtime/0.0.31/node_modules/codeitlab/dist/bin.mjs",
    "",
  ]) {
    assert.equal(
      formatCliCommand({ subcommand: "serve", entryPath, version: "0.0.31" }),
      "codeitlab serve",
    );
  }
});

it("re-suggests the prerelease channel only for prerelease builds", () => {
  for (const [version, expected] of [
    ["0.0.31-nightly.20260729", "npx codeitlab@nightly serve"],
    ["0.0.31-preview.20260729.1", "npx codeitlab@preview serve"],
    ["0.0.31-foo-preview.20260729.1", "npx codeitlab serve"],
    ["0.0.31", "npx codeitlab serve"],
  ] as const) {
    assert.equal(
      formatCliCommand({
        subcommand: "serve",
        entryPath: "/home/theo/.npm/_npx/abc123/node_modules/codeitlab/dist/bin.mjs",
        version,
      }),
      expected,
    );
  }
});

it("formats serve suggestions to match the launching command", () => {
  assert.equal(
    formatCliCommand({
      subcommand: "serve",
      entryPath: "/home/theo/.npm/_npx/abc/node_modules/codeitlab/dist/bin.mjs",
      version: "0.0.31-nightly.20260729",
    }),
    "npx codeitlab@nightly serve",
  );
  assert.equal(
    formatCliCommand({
      subcommand: "serve",
      entryPath: "/tmp/bunx-1000-codeitlab@latest/node_modules/codeitlab/dist/bin.mjs",
      version: "0.0.31",
    }),
    "bunx codeitlab serve",
  );
  assert.equal(
    formatCliCommand({
      subcommand: "serve",
      entryPath: "/usr/local/lib/node_modules/codeitlab/dist/bin.mjs",
      version: "0.0.31-nightly.20260729",
    }),
    "codeitlab serve",
  );
});

it.layer(NodeServices.layer)("root CLI commands", (it) => {
  const rootCommand = (input: {
    readonly node: string;
    readonly entry: string;
    readonly path?: string;
    readonly env?: Record<string, string>;
    readonly executable?: boolean;
  }) =>
    resolveRootCliCommand("browser setup").pipe(
      Effect.provideService(HostProcess.ExecutablePath, input.node),
      Effect.provideService(HostProcess.Arguments, [input.node, input.entry]),
      Effect.provideService(HostProcess.IsExecutable, input.executable ?? false),
      Effect.provideService(HostProcess.Platform, "linux"),
      Effect.provideService(HostProcess.Environment, { PATH: input.path ?? "", ...input.env }),
    );

  const pathWithCil = Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const bin = yield* fs.makeTempDirectoryScoped();
    yield* fs.writeFileString(path.join(bin, "codeitlab"), "#!/bin/sh\n", { mode: 0o755 });
    return bin;
  });

  it.effect("keeps a user-installed Node reachable when the command runs under sudo", () =>
    Effect.gen(function* () {
      const npx = "/home/theo/.npm/_npx/abc/node_modules/codeitlab/dist/bin.mjs";
      // sudo's secure_path already has a system Node.
      expect(yield* rootCommand({ node: "/usr/bin/node", entry: npx })).toBe(
        "sudo npx codeitlab browser setup",
      );
      // nvm, fnm, and tarball installs are dropped by sudo's PATH reset.
      expect(
        yield* rootCommand({ node: "/home/theo/.nvm/versions/node/v24/bin/node", entry: npx }),
      ).toBe('sudo env "PATH=$PATH" npx codeitlab browser setup');
      expect(
        yield* rootCommand({
          node: "/home/theo/.local/node/bin/node",
          entry: "/home/theo/.local/lib/node_modules/codeitlab/dist/bin.mjs",
          path: yield* pathWithCil,
        }),
      ).toBe('sudo env "PATH=$PATH" codeitlab browser setup');
    }).pipe(Effect.scoped),
  );

  it.effect("names this install's launcher when codeitlab is not on PATH", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fs.makeTempDirectoryScoped();
      const shim = path.join(home, ".local bin", "codeitlab");
      yield* fs.makeDirectory(path.dirname(shim), { recursive: true });
      yield* fs.writeFileString(shim, "#!/bin/sh\n", { mode: 0o755 });
      const desktop = {
        node: "/tmp/.mount_CILabc/codeitlab",
        entry: "/tmp/.mount_CILabc/resources/app.asar/apps/server/dist/bin.mjs",
        env: { CIL_CLI_PATH: shim },
      };

      expect(yield* rootCommand(desktop)).toBe(`sudo '${shim}' browser setup`);

      expect(yield* rootCommand({ ...desktop, path: yield* pathWithCil })).toBe(
        'sudo env "PATH=$PATH" codeitlab browser setup',
      );

      expect(
        yield* rootCommand({
          node: "/opt/rumbis/codeitlab",
          entry: "/opt/rumbis/codeitlab",
          executable: true,
        }),
      ).toBe("sudo /opt/rumbis/codeitlab browser setup");

      expect(
        yield* rootCommand({ ...desktop, env: { CIL_CLI_PATH: path.join(home, "gone") } }),
      ).toBe('sudo env "PATH=$PATH" codeitlab browser setup');
    }).pipe(Effect.scoped),
  );
});

it.layer(NodeServices.layer)("host CLI commands", (it) => {
  it.effect("renders a PowerShell command line on Windows", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fs.makeTempDirectoryScoped();
      const shim = path.join(home, "cil.cmd");
      yield* fs.writeFileString(shim, "@echo off\r\n");
      const hostCommand = (platform: NodeJS.Platform, env: Record<string, string>) =>
        resolveHostCliCommand("doctor", ["--base-dir", "C:\\Users\\Jane Doe\\.cil"]).pipe(
          Effect.provideService(
            HostProcess.ExecutablePath,
            "C:\\Program Files\\CodeItLab\\codeitlab.exe",
          ),
          Effect.provideService(HostProcess.Arguments, [
            "C:\\Program Files\\CodeItLab\\codeitlab.exe",
            "C:\\Program Files\\CodeItLab\\resources\\app.asar\\apps\\server\\dist\\bin.mjs",
          ]),
          Effect.provideService(HostProcess.IsExecutable, false),
          Effect.provideService(HostProcess.Platform, platform),
          Effect.provideService(HostProcess.Environment, { PATH: "", ...env }),
        );
      // The desktop shim is called through `&`, and each argument is quoted
      // the PowerShell way: no POSIX single quotes anywhere.
      expect((yield* hostCommand("win32", { CIL_CLI_PATH: shim })).command).toBe(
        `& "${shim}" doctor "--base-dir" "C:\\Users\\Jane Doe\\.cil"`,
      );
      // Without a launcher, plain `codeitlab` with PowerShell-quoted arguments.
      expect((yield* hostCommand("win32", {})).command).toBe(
        'codeitlab doctor "--base-dir" "C:\\Users\\Jane Doe\\.cil"',
      );
      // Typographic quotes also delimit PowerShell strings; doubling keeps them.
      expect(
        (yield* resolveHostCliCommand("doctor", [
          "--base-dir",
          "C:\\CodeItLab\\\u201CArchive\u201D",
        ]).pipe(
          Effect.provideService(HostProcess.Platform, "win32"),
          Effect.provideService(HostProcess.Environment, { PATH: "" }),
          Effect.provideService(HostProcess.ExecutablePath, "C:\\codeitlab.exe"),
          Effect.provideService(HostProcess.Arguments, ["C:\\codeitlab.exe", "C:\\bin.mjs"]),
          Effect.provideService(HostProcess.IsExecutable, false),
        )).command,
      ).toBe('codeitlab doctor "--base-dir" "C:\\CodeItLab\\\u201C\u201CArchive\u201D\u201D"');
      // POSIX hosts keep single quotes for the same input. The shim prefix is
      // a host path, so only the arguments are asserted.
      expect((yield* hostCommand("linux", { CIL_CLI_PATH: shim })).command).toMatch(
        / doctor --base-dir 'C:\\Users\\Jane Doe\\\.cil'$/,
      );
    }).pipe(Effect.scoped),
  );
});

it.layer(NodeServices.layer)("manual server installation ownership", (it) => {
  it.effect("recognizes runner caches for script packages and the npm launcher", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped();
      const executable = path.join(root, ".cil/runtime/versions/1.0.0/codeitlab");
      yield* fs.makeDirectory(path.dirname(executable), { recursive: true });
      yield* fs.writeFileString(executable, "");
      for (const [relative, kind] of [
        ["npm/_npx/hash/node_modules/codeitlab/dist/bin.mjs", "npx"],
        ["npm/_npx/hash/node_modules/codeitlab/bin/cil.mjs", "npx"],
        ["pnpm/dlx/hash/node_modules/codeitlab/dist/bin.mjs", "pnpm-dlx"],
        [".bun/install/cache/codeitlab/dist/bin.mjs", "bunx"],
      ] as const) {
        const entry = path.join(root, relative);
        yield* fs.makeDirectory(path.dirname(entry), { recursive: true });
        yield* fs.writeFileString(entry, "");
        yield* fs.writeFileString(
          path.join(path.dirname(entry), "../package.json"),
          `{"name":"codeitlab","version":"${packageJson.version}","bin":{"codeitlab":"./bin/cil.mjs"}}`,
        );
        const launchedBy = entry.endsWith("codeitlab.mjs");
        const installation = yield* resolveServerInstallation.pipe(
          Effect.provideService(HostProcess.Arguments, [launchedBy ? executable : "node", entry]),
          Effect.provideService(HostProcess.ExecutablePath, executable),
          Effect.provideService(HostProcess.IsExecutable, launchedBy),
          Effect.provideService(
            HostProcess.Environment,
            launchedBy ? { CIL_NPM_LAUNCHER_PATH: entry } : {},
          ),
        );
        expect(installation).toEqual({ kind });
      }
    }),
  );

  it.effect("requires the npm prefix's bin to point to the running package", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped();
      const prefix = path.join(root, "bunx-tools");
      const packageRoot = path.join(prefix, "lib/node_modules/codeitlab");
      const entry = path.join(packageRoot, "dist/bin.mjs");
      const globalBin = path.join(prefix, "bin/codeitlab");
      yield* fs.makeDirectory(path.dirname(entry), { recursive: true });
      yield* fs.makeDirectory(path.dirname(globalBin), { recursive: true });
      yield* fs.writeFileString(entry, "");
      yield* fs.writeFileString(
        path.join(packageRoot, "package.json"),
        '{"name":"codeitlab","version":"0.0.45","bin":{"codeitlab":"./dist/bin.mjs"}}',
      );
      const resolve = resolveServerInstallation.pipe(
        Effect.provideService(HostProcess.Arguments, ["node", entry]),
        Effect.provideService(HostProcess.IsExecutable, false),
        Effect.provideService(HostProcess.Platform, "linux"),
      );
      expect(yield* resolve).toBeNull();
      yield* fs.symlink(entry, globalBin);
      expect(yield* resolve).toEqual({ kind: "npm-global", prefix });
      yield* fs.remove(globalBin);
      yield* fs.writeFileString(globalBin, "an unrelated codeitlab command");
      expect(yield* resolve).toBeNull();
      expect(yield* resolve.pipe(Effect.provideService(HostProcess.Platform, "win32"))).toBeNull();
    }),
  );

  it.effect("proves the downloaded executable was started by a global npm launcher", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped();
      const prefix = path.join(root, "bunx-tools");
      const packageRoot = path.join(prefix, "lib/node_modules/codeitlab");
      const launcher = path.join(packageRoot, "bin/cil.mjs");
      const executable = path.join(root, ".cil/runtime/versions/1.0.0/codeitlab");
      yield* fs.makeDirectory(path.dirname(launcher), { recursive: true });
      yield* fs.makeDirectory(path.dirname(executable), { recursive: true });
      yield* fs.makeDirectory(path.join(prefix, "bin"));
      yield* fs.writeFileString(launcher, "");
      yield* fs.writeFileString(executable, "");
      yield* fs.symlink(launcher, path.join(prefix, "bin/codeitlab"));
      const resolve = resolveServerInstallation.pipe(
        Effect.provideService(HostProcess.ExecutablePath, executable),
        Effect.provideService(HostProcess.Arguments, [executable, executable]),
        Effect.provideService(HostProcess.IsExecutable, true),
        Effect.provideService(HostProcess.Platform, "linux"),
        Effect.provideService(HostProcess.Environment, { CIL_NPM_LAUNCHER_PATH: launcher }),
      );
      // A launcher for another version is some other `codeitlab` the server spawned
      // (the variable is inherited), not the install this executable runs from.
      for (const [version, expected] of [
        ["0.0.1", null],
        [packageJson.version, { kind: "npm-global", prefix }],
      ] as const) {
        yield* fs.writeFileString(
          path.join(packageRoot, "package.json"),
          `{"name":"codeitlab","version":"${version}","bin":{"codeitlab":"./bin/cil.mjs"}}`,
        );
        expect(yield* resolve).toEqual(expected);
      }
    }),
  );

  it.effect("leaves local, standalone, missing and unreadable installs unknown", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped();
      for (const relative of [
        "project/node_modules/codeitlab/dist/bin.mjs",
        "project/apps/server/dist/bin.mjs",
        ".cil/runtime/0.0.45/codeitlab",
        "missing/dist/bin.mjs",
      ]) {
        const entry = path.join(root, relative);
        if (!relative.startsWith("missing")) {
          yield* fs.makeDirectory(path.dirname(entry), { recursive: true });
          yield* fs.writeFileString(entry, "");
        }
        expect(
          yield* resolveServerInstallation.pipe(
            Effect.provideService(HostProcess.Arguments, ["node", entry]),
            Effect.provideService(HostProcess.IsExecutable, false),
          ),
        ).toBeNull();
      }
    }),
  );
});
