#!/usr/bin/env node
// The `codeitlab` npm package behind `npx codeitlab` / `npm i -g codeitlab`.
// It runs the CodeitLab CLI. Resolution order:
//   1. CODEITLAB_CLI_PATH (an explicit CLI entry point or executable),
//   2. a cached CLI runtime under <CodeitLab home>/runtime/versions/<version>,
//   3. a download from CODEITLAB_RELEASE_BASE_URL (verified against SHA256SUMS),
//   4. the checkout this package is installed from (apps/server/dist/bin.mjs).
// `dist/bin.mjs` re-enters here for background services installed by the
// desktop app, which start the npm package with Node and talk to it over IPC.
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { version } = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, "../package.json"), "utf8"),
);

const SUPPORTED = ["darwin-arm64", "linux-arm64", "linux-x64", "win32-arm64", "win32-x64"];

function codeitlabHome() {
  const raw = (process.env.T3CODE_HOME || "").trim();
  if (raw === "") return path.join(os.homedir(), ".t3");
  if (raw === "~") return os.homedir();
  if (raw.startsWith("~/") || raw.startsWith("~\\")) return path.join(os.homedir(), raw.slice(2));
  return path.resolve(raw);
}

function fail(error) {
  process.stderr.write(`codeitlab: ${error.message}\n`);
  process.exit(1);
}

async function get(url) {
  const response = await fetch(url);
  if (response.status === 404) {
    throw new Error(
      `${url} does not exist yet. If ${version} was just released, try again in a few minutes.`,
    );
  }
  if (!response.ok) throw new Error(`GET ${url} returned HTTP ${response.status}`);
  return response;
}

/** Downloads `url` to `file` and returns its sha256, showing progress on a terminal. */
async function download(url, file) {
  const response = await get(url);
  const total = Number(response.headers.get("content-length")) || 0;
  const hash = crypto.createHash("sha256");
  const out = fs.openSync(file, "w");
  const tty = process.stderr.isTTY;
  let received = 0;
  let shown = -1;
  try {
    for await (const chunk of response.body) {
      hash.update(chunk);
      fs.writeSync(out, chunk);
      received += chunk.byteLength;
      const step = total ? Math.floor((received * 100) / total) : Math.floor(received / 1048576);
      if (tty && step !== shown) {
        shown = step;
        const percent = total ? ` ${step}%` : "";
        process.stderr.write(
          `\r\x1b[2Kcodeitlab: downloading CodeitLab CLI ${version}${percent} (${(received / 1048576).toFixed(1)} MB)`,
        );
      }
    }
  } finally {
    fs.closeSync(out);
    if (tty) process.stderr.write("\r\x1b[2K");
  }
  return hash.digest("hex");
}

function publish(staging, dir) {
  try {
    fs.renameSync(staging, dir);
  } catch (error) {
    if (isComplete(dir)) return;
    if (!fs.existsSync(dir)) throw error;
    fs.rmSync(dir, { recursive: true, force: true });
    fs.renameSync(staging, dir);
  }
}

const isComplete = (dir) => {
  try {
    return fs.readFileSync(path.join(dir, ".install-complete"), "utf8").trim() === version;
  } catch {
    return false;
  }
};

async function install(dir, key) {
  const archive = `t3-${version}-${key}.${process.platform === "win32" ? "zip" : "tar.gz"}`;
  const base = (
    process.env.CODEITLAB_RELEASE_BASE_URL ||
    "https://github.com/rumbis/codeitlab/releases/download"
  ).replace(/\/+$/, "");
  const sums = await (await get(`${base}/v${version}/SHA256SUMS`)).text();
  const expected = /^([0-9a-f]{64})\s+\*?(.+)$/im;
  const line = sums
    .split(/\r?\n/)
    .map((l) => expected.exec(l.trim()))
    .find((m) => m && m[2] === archive);
  if (!line) throw new Error(`${archive} is not listed in the release's SHA256SUMS`);

  fs.mkdirSync(path.dirname(dir), { recursive: true });
  const staging = fs.mkdtempSync(`${dir}.staging-`);
  try {
    const file = path.join(staging, archive);
    if ((await download(`${base}/v${version}/${archive}`, file)) !== line[1].toLowerCase()) {
      throw new Error(`checksum mismatch for ${archive}`);
    }
    const tar =
      process.platform === "win32" ? `${process.env.SystemRoot}\\System32\\tar.exe` : "tar";
    const extract = spawnSync(tar, ["-xf", file, "-C", staging, "--strip-components=1"], {
      stdio: "inherit",
    });
    if (extract.status !== 0) throw new Error(`could not extract ${archive}`);
    fs.rmSync(file);
    fs.writeFileSync(path.join(staging, ".install-complete"), `${version}\n`);
    publish(staging, dir);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

/** A CLI checkout next to the package: `apps/server/dist/bin.mjs` in the repo. */
function findCheckoutCli() {
  const explicit = (process.env.CODEITLAB_CLI_PATH || "").trim();
  if (explicit) {
    if (!fs.existsSync(explicit)) throw new Error(`CODEITLAB_CLI_PATH does not exist: ${explicit}`);
    return explicit;
  }
  const repoRoot = (process.env.CODEITLAB_REPO_ROOT || "").trim();
  const starts = repoRoot
    ? [repoRoot]
    : [process.cwd(), path.resolve(import.meta.dirname, "../../..")];
  for (const start of starts) {
    let dir = start;
    for (;;) {
      const candidate = path.join(dir, "apps/server/dist/bin.mjs");
      if (fs.existsSync(candidate)) return candidate;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}

function run(cliPath) {
  const isScript = /\.[cm]?js$/.test(cliPath);
  const command = isScript ? process.execPath : cliPath;
  const args = isScript ? [cliPath, ...process.argv.slice(2)] : process.argv.slice(2);
  const ipc = process.send !== undefined;
  const child = spawn(command, args, {
    stdio: ipc ? ["inherit", "inherit", "inherit", "ipc"] : "inherit",
    env: { ...process.env, T3CODE_NPM_LAUNCHER_PATH: import.meta.filename },
  });
  if (ipc) {
    process.on("message", (message) => child.connected && child.send(message));
    child.on("message", (message) => process.connected && process.send(message));
    process.on("disconnect", () => child.connected && child.disconnect());
  }
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => (ipc || signal !== "SIGINT") && child.kill(signal));
  }
  child.on("error", (error) => fail(error));
  child.on("exit", (code, signal) =>
    process.exit(code ?? 128 + (os.constants.signals[signal] || 1)),
  );
}

async function main() {
  const checkout = findCheckoutCli();
  if (checkout) return run(checkout);

  const key = `${process.platform}-${process.arch}`;
  if (!SUPPORTED.includes(key)) {
    throw new Error(
      `no CodeitLab CLI build is available for ${key} (supported: ${SUPPORTED.join(", ")}).\n` +
        "Install the CodeitLab desktop app instead, or set CODEITLAB_CLI_PATH.",
    );
  }
  const dir = path.join(codeitlabHome(), "runtime", "versions", version);
  if (!isComplete(dir)) {
    try {
      await install(dir, key);
    } catch (error) {
      throw new Error(
        `${error.message}\n` +
          "The CodeitLab CLI is not installed locally. Install the CodeitLab desktop app, run this from a CodeitLab checkout, or set CODEITLAB_CLI_PATH to the CLI entry point.",
      );
    }
  }
  run(path.join(dir, process.platform === "win32" ? "codeitlab.exe" : "codeitlab"));
}

await main().catch(fail);
