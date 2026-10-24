#!/usr/bin/env node
/**
 * Package an unsigned, launchable CodeitLab macOS app from the repo's build
 * artifacts.
 *
 * The upstream release pipeline (`scripts/build-desktop-artifact.ts`) needs
 * Rust (the native resource monitor) and stages a full `pnpm install --prod`
 * before handing off to electron-builder. This fork only needs a local,
 * unsigned macOS app, so this script assembles the same payload directly from
 * `apps/desktop/dist-electron`, `apps/server/dist`, and the few runtime
 * externals those bundles `require()` at runtime, then wraps it in a copy of
 * the Electron.app from node_modules.
 *
 * Run `pnpm run build:desktop` first. Usage:
 *   node apps/desktop/scripts/package-codeitlab-app.mjs [--output <path>] [--no-sign]
 *
 * Pass `--release` (or export CODEITLAB_RELEASE=1) for the shipped, hardened
 * build: it rebuilds with sourcemaps/minification disabled, packs the app into
 * `Contents/Resources/app.asar` with dev files excluded, flips the Electron
 * fuses, and adds the asar integrity hash to Info.plist. Plain (no flag) builds
 * keep the readable `Resources/app` directory so debugging stays easy.
 */

import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const __dirname = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const desktopDir = NodePath.resolve(__dirname, "..");
const repoRoot = NodePath.resolve(desktopDir, "..", "..");
const serverDir = NodePath.join(repoRoot, "apps", "server");
const require = NodeModule.createRequire(import.meta.url);

const APP_NAME = "CodeitLab";
const APP_BUNDLE_ID = "com.codeitlab.app";
const APP_PROTOCOL = "codeitlab";
const OUTPUT_PATH = NodePath.join(repoRoot, "release", `${APP_NAME}.app`);
const STAGE_ROOT = NodePath.join(repoRoot, "release", ".codeitlab-stage");

// Packages the desktop main bundle and the bundled server keep external at
// runtime. Keep in sync with scripts/lib/desktop-external-packages.ts,
// scripts/lib/cli-external-packages.ts, and the `require()` calls in
// apps/desktop/dist-electron/main.cjs.
const DESKTOP_RUNTIME_PACKAGES = [
  "@napi-rs/keyring",
  "@crowecawcaw/xa11y",
  "@clerk/electron-passkeys",
  "electron-webauthn",
  "ffi-rs",
  "playwright-core",
  // Required at module load by the bundled desktop main process / ajv codegen.
  "node-pty",
  "ajv",
  "ajv-formats",
];

// Packages the bundled server keeps external. Mirrors
// scripts/lib/cli-external-packages.ts; the server runs from the same app
// node_modules as the desktop main process.
const SERVER_RUNTIME_PACKAGES = [
  "@cursor/sdk",
  "@ff-labs/fff-node",
  "bufferutil",
  "utf-8-validate",
  "@connectrpc/connect",
  "@connectrpc/connect-web",
  "@connectrpc/connect-node",
  "@bufbuild/protobuf",
  "@statsig/js-client",
  "@statsig/client-core",
  "zod",
  "undici",
  "@fastify/busboy",
  "node-gyp-build",
  "node-addon-api",
];

// Optional/transitive packages that may legitimately be absent for a platform.
const OPTIONAL_RUNTIME_PACKAGES = new Set([
  "bufferutil",
  "utf-8-validate",
  "@connectrpc/connect-node",
  "@fastify/busboy",
]);

// Native packages that only load on Linux; keep them out of a macOS bundle.
const PLATFORM_SKIPPED_PACKAGES = new Set(["x11"]);

const PLATFORM_PACKAGE_PATTERN = /-(darwin|linux|win32)-(arm64|x64)(?:-(?:gnu|musl|msvc))?$/;

function isForeignPlatformPackage(packageName) {
  const match = PLATFORM_PACKAGE_PATTERN.exec(packageName);
  if (match === null) return false;
  return !(match[1] === "darwin" && match[2] === process.arch);
}

function fail(message) {
  throw new Error(message);
}

function run(command, args, options = {}) {
  const result = NodeChildProcess.spawnSync(command, args, {
    encoding: "utf8",
    ...options,
  });
  if (result.status !== 0) {
    fail(
      `${command} ${args.join(" ")} failed with exit code ${String(result.status)}\n${[
        result.stdout,
        result.stderr,
      ]
        .filter(Boolean)
        .join("\n")}`,
    );
  }
  return result;
}

function readJson(filePath) {
  return JSON.parse(NodeFS.readFileSync(filePath, "utf8"));
}

function parseArgs(argv) {
  const options = {
    output: OUTPUT_PATH,
    sign: true,
    release: process.env.CODEITLAB_RELEASE === "1",
    build: true,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--output") {
      options.output = NodePath.resolve(process.cwd(), argv[index + 1] ?? "");
      index += 1;
    } else if (arg === "--no-sign") {
      options.sign = false;
    } else if (arg === "--release") {
      options.release = true;
    } else if (arg === "--no-build") {
      options.build = false;
    } else {
      fail(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

// Release builds must be rebuilt with CODEITLAB_RELEASE=1 so the web/server/
// desktop bundles drop sourcemaps and minify; packaging alone cannot strip
// maps out of already-built artifacts.
function runReleaseBuild() {
  console.log("[codeitlab-package] Building release artifacts (CODEITLAB_RELEASE=1)...");
  run("pnpm", ["run", "build:desktop"], {
    cwd: repoRoot,
    env: { ...process.env, CODEITLAB_RELEASE: "1" },
    stdio: "inherit",
  });
  assertNoSourcemaps();
}

function assertNoSourcemaps() {
  const roots = ["apps/desktop/dist-electron", "apps/server/dist"];
  const leftovers = [];
  for (const relativeRoot of roots) {
    const root = NodePath.join(repoRoot, relativeRoot);
    if (!NodeFS.existsSync(root)) continue;
    const walk = (dir) => {
      for (const entry of NodeFS.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = NodePath.join(dir, entry.name);
        if (entry.isDirectory()) walk(fullPath);
        else if (entry.name.endsWith(".map")) leftovers.push(fullPath);
      }
    };
    walk(root);
  }
  if (leftovers.length > 0) {
    fail(
      `Release build still produced ${String(leftovers.length)} sourcemap(s), e.g. ${leftovers[0]}. ` +
        "Check that CODEITLAB_RELEASE=1 reaches every vite/vp task.",
    );
  }
}

function assertBuildArtifacts() {
  const required = [
    "apps/desktop/dist-electron/boot.cjs",
    "apps/desktop/dist-electron/main.cjs",
    "apps/server/dist/bin.mjs",
    "apps/server/dist/client/index.html",
    "apps/desktop/resources",
  ];
  for (const relativePath of required) {
    if (!NodeFS.existsSync(NodePath.join(repoRoot, relativePath))) {
      fail(`Missing build artifact ${relativePath}. Run \`pnpm run build:desktop\` first.`);
    }
  }
}

function resolveElectronAppPath() {
  const electronPackageJson = require.resolve("electron/package.json", {
    paths: [desktopDir, repoRoot],
  });
  const electronAppPath = NodePath.join(
    NodePath.dirname(electronPackageJson),
    "dist",
    "Electron.app",
  );
  if (!NodeFS.existsSync(electronAppPath)) {
    fail(
      `Electron.app not found at ${electronAppPath}. Run \`node apps/desktop/scripts/ensure-electron-runtime.mjs\` first.`,
    );
  }
  return electronAppPath;
}

function copyTree(from, to, { filter } = {}) {
  NodeFS.cpSync(from, to, {
    recursive: true,
    dereference: true,
    filter: (source) => (filter ? filter(source) : true),
  });
}

/**
 * Copy one package and its declared dependency closure into a flat
 * node_modules. pnpm's store layout keeps each package in `.pnpm/<id>/
 * node_modules/<name>`; dereferencing copies the real files and we resolve
 * nested deps explicitly instead of following nested node_modules symlinks.
 */
function findPackageRoot(entryPath, packageName) {
  let current = NodePath.dirname(entryPath);
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = NodePath.join(current, "package.json");
    if (NodeFS.existsSync(candidate)) {
      try {
        if (readJson(candidate).name === packageName) return current;
      } catch {
        // Keep walking up.
      }
    }
    const parent = NodePath.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

function resolveFromStore(packageName) {
  // pnpm's isolated store layout, used for packages that are not direct
  // dependencies of any anchor (for example ajv, which the bundled main
  // process only requires through generated validation code).
  const storeDir = NodePath.join(repoRoot, "node_modules", ".pnpm");
  if (!NodeFS.existsSync(storeDir)) return null;
  const prefix = `${packageName.replace("/", "+")}@`;
  const candidates = NodeFS.readdirSync(storeDir)
    .filter((entry) => entry.startsWith(prefix))
    .sort()
    .reverse();
  for (const entry of candidates) {
    const candidate = NodePath.join(storeDir, entry, "node_modules", packageName);
    if (NodeFS.existsSync(candidate)) return candidate;
  }
  return null;
}

function resolvePackageDir(packageName, fromDirectories = [desktopDir, serverDir, repoRoot]) {
  for (const fromDirectory of fromDirectories) {
    const anchor = NodeModule.createRequire(NodePath.join(fromDirectory, "package.json"));
    try {
      const packageJsonPath = anchor.resolve(`${packageName}/package.json`);
      return NodePath.dirname(packageJsonPath);
    } catch {
      // Package exports may hide package.json; fall back to the main entry.
    }
    try {
      const root = findPackageRoot(anchor.resolve(packageName), packageName);
      if (root !== null) return root;
    } catch {
      // Try the next anchor directory.
    }
  }
  return resolveFromStore(packageName);
}

function copyPackageClosure(packageNames, destinationNodeModules, { release = false } = {}) {
  const visited = new Set();
  const copied = [];

  const visit = (packageName, fromDirectories, optional) => {
    if (PLATFORM_SKIPPED_PACKAGES.has(packageName)) return;
    // Cursor's platform packages are staged beside the app instead of inside
    // app.asar/node_modules (see copyCursorPlatformPackage).
    if (packageName.startsWith("@cursor/sdk-")) return;
    if (isForeignPlatformPackage(packageName)) return;
    const packageDir = resolvePackageDir(packageName, fromDirectories);
    if (packageDir === null) {
      if (!optional) fail(`Could not resolve runtime dependency ${packageName}`);
      return;
    }
    if (visited.has(packageDir)) return;
    visited.add(packageDir);

    const destination = NodePath.join(destinationNodeModules, packageName);
    if (!NodeFS.existsSync(destination)) {
      NodeFS.mkdirSync(NodePath.dirname(destination), { recursive: true });
      copyTree(packageDir, destination, {
        filter: (source) => {
          const relative = NodePath.relative(packageDir, source);
          if (relative === "") return true;
          const parts = relative.split(NodePath.sep);
          // Nested dependency trees are re-resolved below; copying them would
          // duplicate the whole store and can follow symlink cycles.
          if (parts.includes("node_modules")) return false;
          if (relative.endsWith(".map") || relative.endsWith(".d.ts")) return false;
          if (release) {
            if (relative.endsWith(".ts") || relative.endsWith(".tsx")) return false;
            if (/\.(?:test|spec)\.[^/\\]+$/.test(relative)) return false;
            if (
              parts.includes("__tests__") ||
              parts.includes("fixtures") ||
              parts.includes("test")
            ) {
              return false;
            }
            if (relative.endsWith(".md") || relative.endsWith(".markdown")) return false;
          }
          return true;
        },
      });
      copied.push(packageName);
    }

    const packageJson = readJson(NodePath.join(packageDir, "package.json"));
    for (const [dependencyName, version] of Object.entries(packageJson.dependencies ?? {})) {
      visit(dependencyName, [packageDir], false);
      void version;
    }
    for (const dependencyName of Object.keys(packageJson.optionalDependencies ?? {})) {
      visit(dependencyName, [packageDir], true);
    }
  };

  for (const packageName of packageNames) {
    visit(
      packageName,
      [desktopDir, serverDir, repoRoot],
      OPTIONAL_RUNTIME_PACKAGES.has(packageName),
    );
  }
  return copied;
}

function writeStageApp(stageAppDir, { release = false } = {}) {
  const serverPackageJson = readJson(NodePath.join(repoRoot, "apps", "server", "package.json"));
  const version = serverPackageJson.version ?? "0.1.0";
  const commitHash = (() => {
    try {
      return NodeChildProcess.execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: repoRoot,
        encoding: "utf8",
      }).trim();
    } catch {
      return undefined;
    }
  })();

  const appPackageJson = {
    name: "codeitlab",
    productName: `${APP_NAME} (Beta)`,
    version,
    description:
      "CodeitLab is an original-branded fork of T3 Code: a desktop control surface for coding agents.",
    license: "MIT",
    homepage: "https://github.com/pingdotgg/t3code",
    main: "apps/desktop/dist-electron/boot.cjs",
    private: true,
    ...(commitHash ? { t3codeCommitHash: commitHash } : {}),
    ...(release ? { codeitlabRelease: true } : {}),
  };
  NodeFS.writeFileSync(
    NodePath.join(stageAppDir, "package.json"),
    `${JSON.stringify(appPackageJson, null, 2)}\n`,
  );

  const copyArtifact = (relativeSource, relativeDestination) => {
    const source = NodePath.join(repoRoot, relativeSource);
    const destination = NodePath.join(stageAppDir, relativeDestination);
    NodeFS.mkdirSync(NodePath.dirname(destination), { recursive: true });
    copyTree(source, destination, {
      filter: (filePath) => {
        if (filePath.endsWith(".map")) return false;
        if (!release) return true;
        if (filePath.endsWith(".ts") || filePath.endsWith(".tsx")) return false;
        if (/\.(?:test|spec)\.[^/\\]+$/.test(filePath)) return false;
        if (filePath.endsWith(".md") || filePath.endsWith(".markdown")) return false;
        return true;
      },
    });
  };

  copyArtifact("apps/desktop/dist-electron", "apps/desktop/dist-electron");
  copyArtifact("apps/server/dist", "apps/server/dist");
  copyArtifact("apps/desktop/resources", "apps/desktop/resources");

  // Production web brand assets (normally applied by
  // scripts/apply-web-brand-assets.ts during the electron-builder stage).
  const webIcons = {
    "codeitlab-black-web-favicon.ico": "favicon.ico",
    "codeitlab-black-web-favicon-16x16.png": "favicon-16x16.png",
    "codeitlab-black-web-favicon-32x32.png": "favicon-32x32.png",
    "codeitlab-black-web-apple-touch-180.png": "apple-touch-icon.png",
  };
  for (const [sourceName, targetName] of Object.entries(webIcons)) {
    NodeFS.copyFileSync(
      NodePath.join(repoRoot, "assets", "prod", sourceName),
      NodePath.join(stageAppDir, "apps", "server", "dist", "client", targetName),
    );
  }

  const copiedPackages = copyPackageClosure(
    [...DESKTOP_RUNTIME_PACKAGES, ...SERVER_RUNTIME_PACKAGES],
    NodePath.join(stageAppDir, "node_modules"),
    { release },
  );
  console.log(
    `[codeitlab-package] Copied ${String(copiedPackages.length)} runtime packages: ${copiedPackages.join(", ")}`,
  );

  return { version };
}

function patchPlistString(infoPlistPath, key, value) {
  for (const operation of ["-replace", "-insert"]) {
    const result = NodeChildProcess.spawnSync(
      "plutil",
      [operation, key, "-string", value, infoPlistPath],
      { encoding: "utf8" },
    );
    if (result.status === 0) return;
  }
  fail(`Could not set ${key} in ${infoPlistPath}`);
}

function patchPlistJson(infoPlistPath, key, value) {
  for (const operation of ["-replace", "-insert"]) {
    const result = NodeChildProcess.spawnSync(
      "plutil",
      [operation, key, "-json", JSON.stringify(value), infoPlistPath],
      { encoding: "utf8" },
    );
    if (result.status === 0) return;
  }
  fail(`Could not set ${key} in ${infoPlistPath}`);
}

function patchMainInfoPlist(appBundlePath, version, asarIntegrity) {
  const infoPlistPath = NodePath.join(appBundlePath, "Contents", "Info.plist");
  const values = {
    CFBundleDisplayName: APP_NAME,
    CFBundleName: APP_NAME,
    CFBundleIdentifier: APP_BUNDLE_ID,
    CFBundleExecutable: APP_NAME,
    CFBundleIconFile: "icon.icns",
    CFBundleShortVersionString: version,
    CFBundleVersion: version,
    LSApplicationCategoryType: "public.app-category.developer-tools",
    LSMinimumSystemVersion: "12.0",
    NSHumanReadableCopyright:
      "CodeitLab is MIT licensed. Based on T3 Code, Copyright (c) T3 Tools.",
    NSAutoFillRequiresTextContentTypeForOneTimeCodeOnMac: true,
    NSLocalNetworkUsageDescription:
      "CodeitLab connects to devices on your local network for remote environments and commands run by terminals and coding agents.",
    NSScreenCaptureUsageDescription:
      "CodeitLab captures the active window when you use the window capture shortcut.",
    NSDocumentsFolderUsageDescription: "CodeitLab reads project files you open in the desktop app.",
    NSCameraUsageDescription:
      "CodeitLab lets commands run by terminals and coding agents use the camera.",
    NSMicrophoneUsageDescription:
      "CodeitLab lets commands run by terminals and coding agents use the microphone.",
  };
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === "boolean") {
      patchPlistJson(infoPlistPath, key, value);
    } else {
      patchPlistString(infoPlistPath, key, value);
    }
  }
  if (asarIntegrity !== null) {
    patchPlistJson(infoPlistPath, "ElectronAsarIntegrity", {
      "Resources/app.asar": { algorithm: "SHA256", hash: asarIntegrity.hash },
    });
  }
  patchPlistJson(infoPlistPath, "CFBundleURLTypes", [
    {
      CFBundleURLName: APP_BUNDLE_ID,
      CFBundleURLSchemes: [APP_PROTOCOL],
    },
  ]);
}

function patchHelperInfoPlists(appBundlePath) {
  const helpers = [
    ["Electron Helper.app", "helper", `${APP_NAME} Helper`],
    ["Electron Helper (GPU).app", "helper.gpu", `${APP_NAME} Helper (GPU)`],
    ["Electron Helper (Plugin).app", "helper.plugin", `${APP_NAME} Helper (Plugin)`],
    ["Electron Helper (Renderer).app", "helper.renderer", `${APP_NAME} Helper (Renderer)`],
  ];
  for (const [bundleName, identifierSuffix, displayName] of helpers) {
    const infoPlistPath = NodePath.join(
      appBundlePath,
      "Contents",
      "Frameworks",
      bundleName,
      "Contents",
      "Info.plist",
    );
    if (!NodeFS.existsSync(infoPlistPath)) continue;
    patchPlistString(infoPlistPath, "CFBundleDisplayName", displayName);
    patchPlistString(infoPlistPath, "CFBundleName", displayName);
    patchPlistString(infoPlistPath, "CFBundleIdentifier", `${APP_BUNDLE_ID}.${identifierSuffix}`);
  }
}

function copyCursorPlatformPackage(appBundlePath) {
  const platformPackageName = `@cursor/sdk-darwin-${process.arch}`;
  const sourceDir = resolvePackageDir(platformPackageName);
  if (sourceDir === null) {
    console.warn(
      `[codeitlab-package] ${platformPackageName} is not installed; the Cursor provider will be unavailable in this bundle.`,
    );
    return;
  }
  // @cursor/sdk walks up from the server entrypoint and expects its platform
  // package beside the app payload, not inside app's node_modules.
  const destination = NodePath.join(
    appBundlePath,
    "Contents",
    "Resources",
    "node_modules",
    "@cursor",
    platformPackageName.split("/")[1],
  );
  copyTree(sourceDir, destination, {
    filter: (filePath) => !filePath.endsWith(".map"),
  });
  console.log(`[codeitlab-package] Staged ${platformPackageName}`);
}

function installIcon(appBundlePath) {
  const resourcesDir = NodePath.join(appBundlePath, "Contents", "Resources");
  const preGeneratedIcns = NodePath.join(repoRoot, "assets", "prod", "codeitlab.icns");
  if (NodeFS.existsSync(preGeneratedIcns)) {
    NodeFS.copyFileSync(preGeneratedIcns, NodePath.join(resourcesDir, "icon.icns"));
    NodeFS.copyFileSync(preGeneratedIcns, NodePath.join(resourcesDir, "electron.icns"));
    return;
  }
  // Fall back to generating the icns from the canonical 1024px macOS PNG.
  const sourcePng = NodePath.join(repoRoot, "assets", "prod", "black-macos-1024.png");
  const iconsetRoot = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "codeitlab-iconset-"));
  const iconsetDir = NodePath.join(iconsetRoot, "icon.iconset");
  NodeFS.mkdirSync(iconsetDir, { recursive: true });
  try {
    for (const size of [16, 32, 128, 256, 512]) {
      run("sips", [
        "-z",
        String(size),
        String(size),
        sourcePng,
        "--out",
        NodePath.join(iconsetDir, `icon_${size}x${size}.png`),
      ]);
      run("sips", [
        "-z",
        String(size * 2),
        String(size * 2),
        sourcePng,
        "--out",
        NodePath.join(iconsetDir, `icon_${size}x${size}@2x.png`),
      ]);
    }
    run("iconutil", ["-c", "icns", iconsetDir, "-o", NodePath.join(resourcesDir, "icon.icns")]);
    NodeFS.copyFileSync(
      NodePath.join(resourcesDir, "icon.icns"),
      NodePath.join(resourcesDir, "electron.icns"),
    );
  } finally {
    NodeFS.rmSync(iconsetRoot, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Release hardening: asar packing, asar integrity, and Electron fuses.
// ---------------------------------------------------------------------------

// The tooling lives in node_modules as a transitive dependency of
// electron-builder; resolve it from there instead of adding a new dependency.
async function loadAsarTool() {
  const packageDir = resolvePackageDir("@electron/asar");
  if (packageDir === null) {
    fail(
      "Could not resolve @electron/asar. It normally ships as a dependency of electron-builder; run `pnpm install`.",
    );
  }
  const packageJson = readJson(NodePath.join(packageDir, "package.json"));
  const entry = NodePath.resolve(packageDir, packageJson.exports ?? packageJson.main);
  return import(NodeURL.pathToFileURL(entry).href);
}

function loadFusesTool() {
  const packageDir = resolvePackageDir("@electron/fuses");
  if (packageDir === null) {
    fail(
      "Could not resolve @electron/fuses. It normally ships as a dependency of electron-builder; run `pnpm install`.",
    );
  }
  return require(packageDir);
}

const FORBIDDEN_ASAR_ENTRY =
  /(?:\.map|\.ts|\.tsx|\.md)$|\.(?:test|spec)\.[^/\\]+$|(?:^|\/)(?:__tests__|fixtures?)(?:\/|$)/;

async function packAppAsar(stageAppDir, resourcesDir) {
  const asar = await loadAsarTool();
  const asarPath = NodePath.join(resourcesDir, "app.asar");
  NodeFS.rmSync(asarPath, { force: true });
  NodeFS.rmSync(`${asarPath}.unpacked`, { recursive: true, force: true });

  // Native addons cannot be dlopen()'d from inside an asar archive, and the
  // @ff-labs package spawns a real binary. Everything else (our compiled
  // bundles and pure-JS deps) stays inside the archive.
  await asar.createPackageWithOptions(stageAppDir, asarPath, {
    unpack: "**/*.node",
    unpackDir: "node_modules/{node-pty,playwright-core,@ff-labs}",
  });

  const entries = asar.listPackage(asarPath);
  const forbidden = entries.filter((entry) => FORBIDDEN_ASAR_ENTRY.test(entry));
  if (forbidden.length > 0) {
    fail(
      `app.asar contains ${String(forbidden.length)} dev/source file(s), e.g. ${forbidden.slice(0, 5).join(", ")}`,
    );
  }

  // Electron validates this hash against the asar header at startup
  // (EnableEmbeddedAsarIntegrityValidation). It is the SHA-256 of the raw
  // header JSON, matching electron-builder's implementation.
  const rawHeader = asar.getRawHeader(asarPath);
  const hash = NodeCrypto.createHash("sha256").update(rawHeader.headerString).digest("hex");

  const unpacked = NodeFS.existsSync(`${asarPath}.unpacked`)
    ? NodeFS.readdirSync(`${asarPath}.unpacked`)
    : [];
  console.log(
    `[codeitlab-package] app.asar: ${String(entries.length)} entries, ${String(unpacked.length)} unpacked top-level dir(s)`,
  );
  return { asarPath, hash, entries };
}

async function flipReleaseFuses(executablePath) {
  const fuses = loadFusesTool();
  await fuses.flipFuses(executablePath, {
    version: fuses.FuseVersion.V1,
    resetAdHocDarwinSignature: true,
    [fuses.FuseV1Options.EnableCookieEncryption]: true,
    [fuses.FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [fuses.FuseV1Options.EnableNodeCliInspectArguments]: false,
    [fuses.FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [fuses.FuseV1Options.OnlyLoadAppFromAsar]: true,
    // RunAsNode intentionally stays enabled: the desktop app spawns the bundled
    // server and its snapshot workers as `process.execPath` with
    // ELECTRON_RUN_AS_NODE=1. Flipping it off breaks the app. See
    // release/verification/hardening.md.
  });
}

async function readFuseStates(executablePath) {
  const fuses = loadFusesTool();
  const wire = await fuses.getCurrentFuseWire(executablePath);
  const names = Object.fromEntries(
    Object.entries(fuses.FuseV1Options).map(([name, index]) => [String(index), name]),
  );
  const stateNames = { 48: "disabled", 49: "enabled", 114: "removed", 144: "inherit" };
  const result = {};
  for (const [index, state] of Object.entries(wire)) {
    if (index === "version" || index === "resetAdHocDarwinSignature") continue;
    const name = names[index] ?? `Fuse${index}`;
    result[name] = stateNames[state] ?? String(state);
  }
  return result;
}

async function assembleApp(appBundlePath, stageAppDir, version, { release }) {
  const electronAppPath = resolveElectronAppPath();
  NodeFS.rmSync(appBundlePath, { recursive: true, force: true });
  NodeFS.mkdirSync(NodePath.dirname(appBundlePath), { recursive: true });
  // ditto preserves the framework's relative symlinks and extended attributes.
  run("ditto", [electronAppPath, appBundlePath]);

  const resourcesDir = NodePath.join(appBundlePath, "Contents", "Resources");
  NodeFS.rmSync(NodePath.join(resourcesDir, "default_app.asar"), { force: true });
  let asarIntegrity = null;
  if (release) {
    asarIntegrity = await packAppAsar(stageAppDir, resourcesDir);
  } else {
    copyTree(stageAppDir, NodePath.join(resourcesDir, "app"));
  }
  copyTree(
    NodePath.join(repoRoot, "apps", "desktop", "resources"),
    NodePath.join(resourcesDir, "resources"),
  );
  copyCursorPlatformPackage(appBundlePath);
  NodeFS.writeFileSync(
    NodePath.join(resourcesDir, "app-update.yml"),
    "provider: generic\nurl: https://codeitlab.invalid/updates\nupdaterCacheDirName: codeitlab-updater\n",
  );
  installIcon(appBundlePath);

  const executablePath = NodePath.join(appBundlePath, "Contents", "MacOS", "Electron");
  const renamedExecutablePath = NodePath.join(appBundlePath, "Contents", "MacOS", APP_NAME);
  if (NodeFS.existsSync(executablePath)) {
    NodeFS.renameSync(executablePath, renamedExecutablePath);
  }
  patchMainInfoPlist(appBundlePath, version, asarIntegrity);
  patchHelperInfoPlists(appBundlePath);
  if (release) {
    await flipReleaseFuses(renamedExecutablePath);
    console.log("[codeitlab-package] Flipped Electron fuses for the release build");
  }
}

function signApp(appBundlePath) {
  run("codesign", ["--force", "--deep", "--sign", "-", "--timestamp=none", appBundlePath]);
  run("codesign", ["--verify", "--deep", "--strict", appBundlePath]);
}

async function verifyApp(appBundlePath, { release }) {
  const infoPlistPath = NodePath.join(appBundlePath, "Contents", "Info.plist");
  const bundleId = NodeChildProcess.execFileSync(
    "plutil",
    ["-extract", "CFBundleIdentifier", "raw", infoPlistPath],
    { encoding: "utf8" },
  ).trim();
  const displayName = NodeChildProcess.execFileSync(
    "plutil",
    ["-extract", "CFBundleDisplayName", "raw", infoPlistPath],
    { encoding: "utf8" },
  ).trim();
  const executableName = NodeChildProcess.execFileSync(
    "plutil",
    ["-extract", "CFBundleExecutable", "raw", infoPlistPath],
    { encoding: "utf8" },
  ).trim();
  if (bundleId !== APP_BUNDLE_ID) fail(`Unexpected bundle id: ${bundleId}`);
  if (displayName !== APP_NAME) fail(`Unexpected display name: ${displayName}`);
  if (executableName !== APP_NAME) fail(`Unexpected executable name: ${executableName}`);
  const required = release
    ? ["Contents/MacOS/CodeitLab", "Contents/Resources/icon.icns", "Contents/Resources/app.asar"]
    : [
        "Contents/MacOS/CodeitLab",
        "Contents/Resources/icon.icns",
        "Contents/Resources/app/package.json",
        "Contents/Resources/app/apps/server/dist/bin.mjs",
        "Contents/Resources/app/apps/server/dist/client/index.html",
        "Contents/Resources/app/apps/desktop/dist-electron/boot.cjs",
      ];
  for (const requiredPath of required) {
    if (!NodeFS.existsSync(NodePath.join(appBundlePath, requiredPath))) {
      fail(`Packaged app is missing ${requiredPath}`);
    }
  }
  if (!release) {
    console.log(`[codeitlab-package] Verified ${appBundlePath} (${displayName}, ${bundleId})`);
    return;
  }

  if (NodeFS.existsSync(NodePath.join(appBundlePath, "Contents", "Resources", "app"))) {
    fail("Release app still contains a readable Contents/Resources/app directory");
  }
  const asar = await loadAsarTool();
  const asarPath = NodePath.join(appBundlePath, "Contents", "Resources", "app.asar");
  const entries = asar.listPackage(asarPath);
  const forbidden = entries.filter((entry) => FORBIDDEN_ASAR_ENTRY.test(entry));
  if (forbidden.length > 0) {
    fail(
      `app.asar contains ${String(forbidden.length)} dev/source file(s), e.g. ${forbidden.slice(0, 5).join(", ")}`,
    );
  }
  const rawHeader = asar.getRawHeader(asarPath);
  const expectedHash = NodeCrypto.createHash("sha256").update(rawHeader.headerString).digest("hex");
  // plutil key paths cannot address the "Resources/app.asar" key (dots are
  // separators), so read the whole plist as JSON and pick the hash out.
  const plist = JSON.parse(
    NodeChildProcess.execFileSync("plutil", ["-convert", "json", "-o", "-", infoPlistPath], {
      encoding: "utf8",
    }),
  );
  const plistHash = plist.ElectronAsarIntegrity?.["Resources/app.asar"]?.hash;
  if (plistHash !== expectedHash) {
    fail(`ElectronAsarIntegrity hash mismatch: plist ${String(plistHash)}, asar ${expectedHash}`);
  }

  const fuseStates = await readFuseStates(
    NodePath.join(appBundlePath, "Contents", "MacOS", APP_NAME),
  );
  const expectedFuses = {
    EnableCookieEncryption: "enabled",
    EnableNodeOptionsEnvironmentVariable: "disabled",
    EnableNodeCliInspectArguments: "disabled",
    EnableEmbeddedAsarIntegrityValidation: "enabled",
    OnlyLoadAppFromAsar: "enabled",
    // Documented exception: the bundled server + snapshot workers run as
    // Electron-as-Node children, so RunAsNode must stay enabled.
    RunAsNode: "enabled",
  };
  for (const [name, expected] of Object.entries(expectedFuses)) {
    if (fuseStates[name] !== expected) {
      fail(`Unexpected fuse ${name}: ${String(fuseStates[name])}, expected ${expected}`);
    }
  }
  console.log(`[codeitlab-package] Fuses: ${JSON.stringify(fuseStates)}`);
  console.log(
    `[codeitlab-package] Verified hardened ${appBundlePath} (${displayName}, ${bundleId}, ${String(entries.length)} asar entries)`,
  );
}

async function main() {
  if (NodeOS.platform() !== "darwin") {
    fail("CodeitLab packaging is macOS-only (it wraps Electron.app).");
  }
  const options = parseArgs(process.argv.slice(2));
  if (options.release && options.build) {
    runReleaseBuild();
  } else if (options.release) {
    assertNoSourcemaps();
  }
  assertBuildArtifacts();

  NodeFS.rmSync(STAGE_ROOT, { recursive: true, force: true });
  const stageAppDir = NodePath.join(STAGE_ROOT, "app");
  NodeFS.mkdirSync(stageAppDir, { recursive: true });
  try {
    const { version } = writeStageApp(stageAppDir, { release: options.release });
    await assembleApp(options.output, stageAppDir, version, { release: options.release });
    if (options.sign) {
      signApp(options.output);
    }
    await verifyApp(options.output, { release: options.release });
    console.log(
      `[codeitlab-package] Wrote ${options.output}${options.release ? " (release/hardened)" : ""}`,
    );
  } finally {
    NodeFS.rmSync(STAGE_ROOT, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (error) {
  console.error(`[codeitlab-package] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
