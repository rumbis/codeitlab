// Tooling that exports ELECTRON_RUN_AS_NODE for its own Node processes (some
// harnesses and Electron build tools do) is inherited by anything launched from
// that environment, including this app from Finder or `open`. Electron then runs
// the binary as plain Node: no window, no log, exit 0. Say what happened.
if (
  process.versions["electron"] === undefined &&
  process.env["ELECTRON_RUN_AS_NODE"] !== undefined
) {
  process.stderr.write(
    "CodeItLab: ELECTRON_RUN_AS_NODE is set in this environment, so the app was started as plain Node and cannot open a window. Unset it and launch the app again.\n",
  );
  process.exit(78);
}

// Enables the compile cache before the main bundle loads, so the cache also
// covers main.cjs itself.
require("./compileCache.cjs");
require("./main.cjs");
