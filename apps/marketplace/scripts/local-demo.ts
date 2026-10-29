#!/usr/bin/env node
/**
 * Starts everything the local website needs and then prints where to look.
 *
 * Three servers have to agree on ports and origins: the marketplace prints
 * login codes to its own stdout, the Astro site reads the marketplace, and the
 * app talks to it with an API token. Run separately, the port and origin
 * settings drift apart and the CORS allowlist silently stops matching, so the
 * demo breaks in a way that looks like a bug in the site. One command keeps
 * them in step.
 *
 * Usage: node scripts/local-demo.ts [--seed]
 */
import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const here = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const marketplaceDir = NodePath.join(here, "..");
const marketingDir = NodePath.join(here, "..", "..", "marketing");

const MARKETPLACE_PORT = 4180;
const MARKETING_PORT = 4173;
const DB_PATH = process.env.MARKETPLACE_DB ?? "/tmp/mkt-local.sqlite";
const ORIGIN = "http://127.0.0.1:" + MARKETING_PORT;

const children: NodeChildProcess.ChildProcess[] = [];
const start = (
  label: string,
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
) => {
  const child = NodeChildProcess.spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const prefix = "[" + label + "] ";
  const pipe = (stream: NodeJS.ReadableStream, out: NodeJS.WriteStream) => {
    stream.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString().split("\n")) {
        if (line.trim() !== "") out.write(prefix + line + "\n");
      }
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on("exit", (code) => {
    if (code !== 0 && code !== null) console.error(prefix + "exited with code " + code);
  });
  children.push(child);
  return child;
};

const stopAll = (signal: NodeJS.Signals) => {
  for (const child of children) child.kill(signal);
};
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopAll(signal);
    process.exit(0);
  });
}

const seed = process.argv.includes("--seed");

// The marketplace owns the schema, so seeding only works once it has migrated.
const marketplace = start("marketplace", process.execPath, ["src/server/main.ts"], marketplaceDir, {
  PORT: String(MARKETPLACE_PORT),
  MARKETPLACE_DB: DB_PATH,
  MARKETPLACE_BASE_PATH: "/market",
  MARKETPLACE_TRUSTED_ORIGINS: ORIGIN,
});

const waitForMarketplace = async () => {
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      const response = await fetch("http://127.0.0.1:" + MARKETPLACE_PORT + "/market/api/health");
      if (response.ok) return true;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
};

/** A stale server on the port produces a confusing EADDRINUSE further down, so check first. */
const portIsFree = async (port: number) => {
  try {
    await fetch("http://127.0.0.1:" + port + "/", { signal: AbortSignal.timeout(1_500) });
    return false;
  } catch {
    return true;
  }
};

const main = async () => {
  for (const port of [MARKETPLACE_PORT, MARKETING_PORT]) {
    if (!(await portIsFree(port))) {
      console.error(
        "[local-demo] port " +
          port +
          " is already in use. Stop whatever owns it and run this again.",
      );
      process.exit(1);
    }
  }
  if (!(await waitForMarketplace())) {
    console.error("[local-demo] the marketplace did not answer on port " + MARKETPLACE_PORT);
    stopAll("SIGTERM");
    process.exit(1);
  }
  if (seed) {
    await new Promise<void>((resolve, reject) => {
      const seeding = NodeChildProcess.spawn(
        process.execPath,
        ["scripts/seed-local.ts", "--force"],
        { cwd: marketplaceDir, env: { ...process.env, MARKETPLACE_DB: DB_PATH }, stdio: "inherit" },
      );
      seeding.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("seed failed"))));
    });
  }
  start(
    "site",
    "npx",
    ["astro", "dev", "--host", "127.0.0.1", "--port", String(MARKETING_PORT)],
    marketingDir,
    {
      LOCAL_MARKETPLACE_URL: "http://127.0.0.1:" + MARKETPLACE_PORT + "/market",
    },
  );
  console.log("");
  console.log("  Local website  " + ORIGIN + "/local");
  console.log("  Marketplace    http://127.0.0.1:" + MARKETPLACE_PORT + "/market");
  console.log("  Database       " + DB_PATH);
  console.log("");
  console.log("  Login codes appear here as [marketplace] login code for ...");
  console.log("  Stop everything with Ctrl-C.");
  console.log("");
};

void main();
marketplace.on("exit", (code) => {
  if (code !== null && code !== 0) {
    console.error("[local-demo] the marketplace stopped; shutting the rest down.");
    stopAll("SIGTERM");
    process.exit(code);
  }
});
