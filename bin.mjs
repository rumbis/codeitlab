#!/usr/bin/env node

import * as e from "node:fs";
import * as t from "node:url";
if (
  ((n) => {
    if (n.runtimeMain !== void 0) return n.runtimeMain;
    if (n.entryPath === void 0 || n.entryPath === ``) return !1;
    if (n.moduleUrl === t.pathToFileURL(n.entryPath).href) return !0;
    try {
      return n.moduleUrl === t.pathToFileURL(e.realpathSync(n.entryPath)).href;
    } catch {
      return !1;
    }
  })({ moduleUrl: import.meta.url, entryPath: process.argv[1], runtimeMain: import.meta.main })
) {
  let e = process.argv[2],
    { ignoreMacosTypeOfServiceEinval: t } = await import(`./outboundHttp-GD11zm2S.mjs`);
  if ((t(), e === `acp-mcp-bridge` || e === `acp-mcp-call`)) {
    let { runAcpMcpCliFastPath: t } = await import(`./AcpMcpStdioBridge-CaEH65F-.mjs`);
    await t(e, process.argv.slice(3));
  } else {
    let { attachConsoleStdin: e } = await import(`./consoleStdin-BfaXehAX.mjs`);
    e();
    let { runCli: t } = await import(`./binCli-MGFY2zUJ.mjs`);
    t();
  }
}
export {};
