#!/usr/bin/env node
// Checks every external link in README.md and docs/ against the network.
//
// Not part of the test suite: it needs the internet, and some vendors answer 403
// to non-browser clients. Run it before a release:
//
//   node scripts/check-doc-links.mjs
//
// Exit code 1 when a link is dead (404/410) or unreachable, 0 otherwise.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";

const run = NodeUtil.promisify(NodeChildProcess.execFile);

const root = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");
const allowBlocked = new Set([
  // Bot-protected but fine in a browser; checked by hand.
  "chatgpt.com",
  "x.ai",
]);

const files = [NodePath.join(root, "README.md")];
const walk = async (dir) => {
  for (const entry of await NodeFSP.readdir(dir, { withFileTypes: true })) {
    const path = NodePath.join(dir, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (entry.name.endsWith(".md")) files.push(path);
  }
};
await walk(NodePath.join(root, "docs"));

const urls = new Set();
for (const file of files) {
  const source = await NodeFSP.readFile(file, "utf8");
  for (const match of source.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)) {
    urls.add(match[1].replace(/[.,;]+$/, ""));
  }
}

// curl, not fetch: some hosts answer Node's TLS stack with a reset but serve curl
// fine, and the point is to know whether a browser can reach the page.
const checkOnce = async (url) => {
  try {
    const { stdout } = await run(
      "curl",
      [
        "-s",
        "-o",
        "/dev/null",
        "-L",
        "-m",
        "20",
        "-w",
        "%{http_code}",
        "-A",
        "Mozilla/5.0 (CodeItLab doc link check)",
        url,
      ],
      { timeout: 25_000 },
    );
    return Number.parseInt(stdout.trim(), 10) || 0;
  } catch {
    return 0;
  }
};

// One retry: hosts rate-limit bursts, and a transient reset is not a dead link.
const check = async (url) => {
  const first = await checkOnce(url);
  return first === 0 ? checkOnce(url) : first;
};

const all = [...urls];
const results = [];
for (let index = 0; index < urls.size; index += 3) {
  const batch = all.slice(index, index + 3);
  results.push(...(await Promise.all(batch.map(async (url) => [url, await check(url)]))));
}
const problems = results.filter(([url, status]) => {
  if (status === 200) return false;
  const host = new URL(url).hostname.replace(/^www\./, "");
  return !(status === 403 && allowBlocked.has(host));
});

const problemUrls = new Set(problems.map(([url]) => url));
for (const [url, status] of results) {
  if (problemUrls.has(url)) console.log(`${status || "unreachable"} ${url}`);
}
console.log(`${results.length} links checked, ${problems.length} problem(s)`);
process.exit(problems.length === 0 ? 0 : 1);
