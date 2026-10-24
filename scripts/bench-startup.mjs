#!/usr/bin/env node
/**
 * Repeatable cold-start + idle-memory baseline for CodeItLab.
 *
 * Measures the pieces we can measure without a GUI session:
 *   1. the WebSocket/HTTP server from process spawn to a healthy /health answer,
 *      and its resident memory once it has settled;
 *   2. the built web bundle (raw and gzip) the renderer has to download.
 *
 * The Electron shell is measured by `--desktop`, which launches the built
 * desktop entry the same way scripts/smoke-test.mjs does and reads the app's
 * own "app ready" log line. That mode needs the app to be closed first: Electron
 * hands focus to an already-running instance instead of starting a second one.
 *
 * Usage: node scripts/bench-startup.mjs [--runs 3] [--json] [--desktop]
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeHttp from "node:http";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeZlib from "node:zlib";

const repoRoot = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const json = args.includes("--json");
const withDesktop = args.includes("--desktop");
const runsIndex = args.indexOf("--runs");
const runs = runsIndex === -1 ? 3 : Math.max(1, Number.parseInt(args[runsIndex + 1] ?? "3", 10));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const server = NodeNet.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function health(port, timeoutMs = 500) {
  return new Promise((resolve) => {
    const request = NodeHttp.get(
      { host: "127.0.0.1", port, path: "/health", timeout: timeoutMs },
      (response) => {
        response.resume();
        resolve(response.statusCode === 200);
      },
    );
    request.on("timeout", () => request.destroy());
    request.on("error", () => resolve(false));
  });
}

function rssMb(pid) {
  try {
    const output = NodeChildProcess.execFileSync("ps", ["-o", "rss=", "-p", String(pid)], {
      encoding: "utf8",
    });
    const kb = Number.parseInt(output.trim(), 10);
    return Number.isFinite(kb) ? kb / 1024 : null;
  } catch {
    return null;
  }
}

async function measureServerOnce() {
  const baseDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "codeitlab-bench-"));
  const port = await freePort();
  const startedAt = process.hrtime.bigint();
  const child = NodeChildProcess.spawn(
    process.execPath,
    [
      NodePath.join(repoRoot, "apps/server/dist/bin.mjs"),
      "--mode",
      "desktop",
      "--port",
      String(port),
      "--no-browser",
      "--base-dir",
      baseDir,
    ],
    { cwd: repoRoot, stdio: ["ignore", "ignore", "ignore"] },
  );

  let readyMs = null;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline && child.exitCode === null) {
    if (await health(port)) {
      readyMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      break;
    }
    await sleep(10);
  }

  let idleRss = null;
  if (readyMs !== null) {
    await sleep(1_500);
    idleRss = rssMb(child.pid);
  }

  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 5_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  NodeFS.rmSync(baseDir, { recursive: true, force: true });
  return { readyMs, idleRss };
}

function median(values) {
  const sorted = values.filter((value) => value !== null).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  return sorted[Math.floor(sorted.length / 2)];
}

function webBundle() {
  const assetsDir = NodePath.join(repoRoot, "apps/web/dist/assets");
  if (!NodeFS.existsSync(assetsDir)) return null;
  let raw = 0;
  let gzip = 0;
  for (const name of NodeFS.readdirSync(assetsDir)) {
    if (!name.endsWith(".js") && !name.endsWith(".css")) continue;
    const contents = NodeFS.readFileSync(NodePath.join(assetsDir, name));
    raw += contents.byteLength;
    gzip += NodeZlib.gzipSync(contents, { level: 9 }).byteLength;
  }
  return { rawBytes: raw, gzipBytes: gzip };
}

async function measureDesktopOnce() {
  const desktopDir = NodePath.join(repoRoot, "apps/desktop");
  const entry = NodePath.join(desktopDir, "dist-electron/boot.cjs");
  if (!NodeFS.existsSync(entry)) return null;
  const electronBinary = NodePath.join(
    desktopDir,
    "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
  );
  const binary = NodeFS.existsSync(electronBinary)
    ? electronBinary
    : NodePath.join(desktopDir, "node_modules/electron/dist/electron");
  if (!NodeFS.existsSync(binary)) return null;

  const startedAt = process.hrtime.bigint();
  const child = NodeChildProcess.spawn(binary, [entry], {
    cwd: desktopDir,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: "1", VITE_DEV_SERVER_URL: "" },
  });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk.toString()));
  child.stderr.on("data", (chunk) => (output += chunk.toString()));

  let readyMs = null;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline && child.exitCode === null) {
    if (output.includes("app ready")) {
      readyMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      break;
    }
    await sleep(25);
  }

  let idleRss = null;
  if (readyMs !== null) {
    await sleep(2_000);
    idleRss = rssMb(child.pid);
  }
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 5_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  return { readyMs, idleRss };
}

const serverRuns = [];
for (let index = 0; index < runs; index += 1) {
  process.stderr.write(`server run ${index + 1}/${runs}...\n`);
  serverRuns.push(await measureServerOnce());
}

const result = {
  measuredAt: new Date().toISOString(),
  // oxlint-disable-next-line t3code/no-global-process-runtime -- standalone benchmark script has no Effect runtime.
  platform: `${NodeOS.platform()} ${NodeOS.release()} ${NodeOS.arch()}`,
  node: process.version,
  runs,
  server: {
    readyMs: serverRuns.map((run) => run.readyMs),
    readyMedianMs: median(serverRuns.map((run) => run.readyMs)),
    idleRssMb: serverRuns.map((run) => run.idleRss),
    idleRssMedianMb: median(serverRuns.map((run) => run.idleRss)),
  },
  webBundle: webBundle(),
  desktop: withDesktop ? await measureDesktopOnce() : null,
};

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`CodeItLab startup baseline — ${result.platform}, node ${result.node}`);
  console.log(
    `server: ready ${result.server.readyMedianMs?.toFixed(0) ?? "?"} ms (median of ${runs}), idle RSS ${result.server.idleRssMedianMb?.toFixed(0) ?? "?"} MB`,
  );
  if (result.webBundle !== null) {
    console.log(
      `web bundle: ${(result.webBundle.rawBytes / 1024).toFixed(0)} KiB raw, ${(result.webBundle.gzipBytes / 1024).toFixed(0)} KiB gzip`,
    );
  }
  if (result.desktop !== null) {
    console.log(
      `desktop: ready ${result.desktop.readyMs?.toFixed(0) ?? "?"} ms, idle RSS ${result.desktop.idleRss?.toFixed(0) ?? "?"} MB`,
    );
  } else if (withDesktop) {
    console.log("desktop: skipped (built app or Electron runtime missing)");
  }
}
