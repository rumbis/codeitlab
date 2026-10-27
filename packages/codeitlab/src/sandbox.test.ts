import { describe, expect, it } from "vitest";

import {
  SANDBOX_COMMAND_MAX_LENGTH,
  SANDBOX_COMMAND_TIMEOUT_MAX_MS,
  SANDBOX_MACHINE_NAME,
  SANDBOX_READINESS_CHECKS,
  SANDBOX_SYNC_MAX_BYTES,
  SANDBOX_SYNC_MAX_FILES,
  WSL_NO_DISTRO_DETAIL,
  decodeWslDistroList,
  normalizeSandboxPlatform,
  sandboxFirstFailure,
  sandboxHealthBackendMessage,
  sandboxHealthMessage,
  sandboxInstallCommand,
  sandboxMachineBackend,
  sandboxMachineImage,
  sandboxReadinessResult,
  sandboxReady,
  sandboxRecommendedBackend,
  sandboxRowReason,
  sandboxRowsForPlatform,
  sandboxRowState,
  sandboxRunProblem,
  sandboxSyncProblem,
  sandboxUnsupportedReason,
} from "./sandbox.ts";
import type { SandboxCheck, SandboxHealthBackend } from "./sandbox.ts";

describe("sandbox platform matrix", () => {
  it("only offers Tart on macOS and says why everywhere else", () => {
    const mac = sandboxRowsForPlatform("darwin");
    const tart = mac.find((row) => row.backend.id === "tart");
    expect(tart?.supported).toBe(true);
    expect(tart?.installCommand).toBe("brew install cirruslabs/cli/tart");
    expect(tart?.recommended).toBe(true);
    expect(tart?.autoInstall).toBe(true);

    for (const platform of ["linux", "win32"] as const) {
      const row = sandboxRowsForPlatform(platform).find(
        (candidate) => candidate.backend.id === "tart",
      );
      expect(row?.supported).toBe(false);
      expect(row?.installCommand).toBeNull();
      expect(row?.autoInstall).toBe(false);
      expect(row?.unsupportedReason).toBe("Tart is macOS-only.");
      expect(sandboxInstallCommand(row!.backend, platform)).toBeNull();
      expect(sandboxUnsupportedReason(row!.backend, platform)).toBe("Tart is macOS-only.");
    }
  });

  it("recommends the backend the platform actually uses", () => {
    expect(sandboxRecommendedBackend("darwin")).toBe("tart");
    expect(sandboxRecommendedBackend("linux")).toBe("docker");
    expect(sandboxRecommendedBackend("win32")).toBe("wsl2");
    expect(sandboxRecommendedBackend("other")).toBeNull();
  });

  it("keeps Docker and Podman available on every desktop platform", () => {
    for (const platform of ["darwin", "linux", "win32"] as const) {
      const ids = sandboxRowsForPlatform(platform)
        .filter((row) => row.supported)
        .map((row) => row.backend.id);
      expect(ids).toContain("docker");
      expect(ids).toContain("podman");
    }
  });

  it("never lets the app run an install that needs root, a reboot or a GUI", () => {
    for (const platform of ["darwin", "linux", "win32"] as const) {
      for (const row of sandboxRowsForPlatform(platform)) {
        if (row.backend.installMode === "manual") expect(row.autoInstall).toBe(false);
      }
    }
    const linuxDocker = sandboxRowsForPlatform("linux").find((row) => row.backend.id === "docker");
    expect(linuxDocker?.installCommand).toBe("curl -fsSL https://get.docker.com | sh");
    expect(linuxDocker?.autoInstall).toBe(false);
  });

  it("treats an unknown platform as unsupported without guessing", () => {
    expect(normalizeSandboxPlatform("freebsd")).toBe("other");
    const rows = sandboxRowsForPlatform("other");
    expect(rows.every((row) => row.supported === false)).toBe(true);
    expect(rows[0]?.unsupportedReason).toBe("Tart is not available on this platform.");
  });
});

describe("sandbox row state", () => {
  it("distinguishes consent from a manual command", () => {
    expect(
      sandboxRowState({ supported: true, installed: false, probeFailed: false, autoInstall: true }),
    ).toBe("needs-consent");
    expect(
      sandboxRowState({
        supported: true,
        installed: false,
        probeFailed: false,
        autoInstall: false,
      }),
    ).toBe("not-installed");
    expect(
      sandboxRowState({ supported: true, installed: true, probeFailed: false, autoInstall: true }),
    ).toBe("available");
    expect(
      sandboxRowState({
        supported: false,
        installed: false,
        probeFailed: false,
        autoInstall: false,
      }),
    ).toBe("unsupported");
  });

  it("never reports not-installed when the probe itself failed", () => {
    expect(
      sandboxRowState({ supported: true, installed: false, probeFailed: true, autoInstall: true }),
    ).toBe("unknown");
  });

  it("is ready only when the recommended backend answered", () => {
    expect(sandboxReady("darwin", { tart: "available" })).toBe(true);
    expect(sandboxReady("darwin", { tart: "needs-consent", docker: "available" })).toBe(false);
    expect(sandboxReady("linux", { docker: "not-installed" })).toBe(false);
    expect(sandboxReady("other", { docker: "available" })).toBe(false);
  });
});

describe("sandbox disabled reasons", () => {
  const macTart = sandboxRowsForPlatform("darwin").find((row) => row.backend.id === "tart")!;

  it("names the command the user is consenting to", () => {
    const reason = sandboxRowReason("needs-consent", macTart, null);
    expect(reason).toContain("brew install cirruslabs/cli/tart");
    expect(reason).toContain("waits for your consent");
  });

  it("says the app does not run a manual install", () => {
    const linuxDocker = sandboxRowsForPlatform("linux").find((row) => row.backend.id === "docker")!;
    const reason = sandboxRowReason("not-installed", linuxDocker, null);
    expect(reason).toContain("Run curl -fsSL https://get.docker.com | sh yourself");
    expect(reason).toContain("does not run this one");
  });

  it("carries the probe detail into an unknown row", () => {
    expect(sandboxRowReason("unknown", macTart, "ENOENT")).toContain("ENOENT");
    expect(sandboxRowReason("unknown", macTart, null)).not.toContain(":");
  });
});

const check = (
  id: string,
  label: string,
  ok: boolean,
  detail: string | null = null,
): SandboxCheck => ({
  id,
  label,
  ok,
  detail,
});

const backend = (input: Partial<SandboxHealthBackend> = {}): SandboxHealthBackend => ({
  id: "tart",
  label: "Tart",
  state: "available",
  recommended: true,
  healthy: true,
  checks: [
    check("version", "Version check", true),
    check("vm-list", "Tart answers its VM list", true),
  ],
  message: "Tart answered every check.",
  ...input,
});

describe("sandbox health", () => {
  it("reports the first failing check and nothing after it", () => {
    const checks = [
      check("version", "Version check", true),
      check(
        "vm-list",
        "Tart answers its VM list",
        false,
        "Error: could not connect to the VM daemon",
      ),
    ];
    expect(sandboxFirstFailure(checks)?.id).toBe("vm-list");
    expect(sandboxFirstFailure([check("version", "Version check", true)])).toBeNull();
  });

  it("says which check failed and keeps the output line in the sentence", () => {
    const message = sandboxHealthBackendMessage({
      label: "Tart",
      state: "available",
      checks: [
        check("version", "Version check", true),
        check("vm-list", "Tart answers its VM list", false, "Error: no VM daemon"),
      ],
    });
    expect(message).toContain("answered its version check");
    expect(message).toContain("tart answers its vm list failed");
    expect(message).toContain("Error: no VM daemon");
  });

  it("does not claim a backend is ready when it never installed", () => {
    expect(
      sandboxHealthBackendMessage({ label: "Docker", state: "needs-consent", checks: [] }),
    ).toBe("Docker is not installed.");
    expect(sandboxHealthBackendMessage({ label: "Tart", state: "unsupported", checks: [] })).toBe(
      "Tart cannot run on this platform.",
    );
    expect(sandboxHealthBackendMessage({ label: "Tart", state: "unknown", checks: [] })).toBe(
      "Tart did not answer its version check.",
    );
  });

  it("leads with the recommended ready backend and names it", () => {
    expect(sandboxHealthMessage([backend()])).toBe("Sandbox ready: Tart answered every check.");
  });

  it("prefers a recommended healthy backend over another healthy one", () => {
    const docker = backend({ id: "docker", label: "Docker", recommended: false });
    const tart = backend({ recommended: true });
    expect(sandboxHealthMessage([docker, tart])).toContain("Tart");
  });

  it("falls back to the recommended backend's reason when nothing is ready", () => {
    expect(
      sandboxHealthMessage([
        backend({
          healthy: false,
          checks: [check("version", "Version check", false, "ENOENT")],
          message: "Tart did not answer its version check.",
        }),
      ]),
    ).toBe("Sandbox not ready: Tart did not answer its version check.");
  });

  it("says plainly when no backend can run here", () => {
    expect(sandboxHealthMessage([])).toBe("No sandbox backend can run on this platform.");
  });
});

describe("sandbox machines", () => {
  it("names one machine per backend and knows which backends cannot own one", () => {
    expect(SANDBOX_MACHINE_NAME).toBe("codeitlab-sandbox");
    expect(sandboxMachineImage("tart")).toContain("ghcr.io/cirruslabs");
    expect(sandboxMachineImage("docker")).toBe("node:22-bookworm-slim");
    expect(sandboxMachineImage("wsl2")).toBeNull();
    expect(sandboxMachineBackend("wsl2")).toBe(false);
    expect(sandboxMachineBackend("docker")).toBe(true);
  });

  it("refuses an empty or oversized command before the machine sees it", () => {
    expect(sandboxRunProblem({ command: "   " })).toContain("Write a command");
    expect(sandboxRunProblem({ command: "x".repeat(SANDBOX_COMMAND_MAX_LENGTH + 1) })).toContain(
      "longer than",
    );
    expect(sandboxRunProblem({ command: "uname -a" })).toBeNull();
  });

  it("bounds the timeout to a whole number between one and two minutes", () => {
    expect(sandboxRunProblem({ command: "ls", timeoutMs: 500 })).toContain("at least 1000 ms");
    expect(sandboxRunProblem({ command: "ls", timeoutMs: 1.5 })).toContain("whole number");
    expect(
      sandboxRunProblem({ command: "ls", timeoutMs: SANDBOX_COMMAND_TIMEOUT_MAX_MS + 1 }),
    ).toContain("cannot be more than");
    expect(
      sandboxRunProblem({ command: "ls", timeoutMs: SANDBOX_COMMAND_TIMEOUT_MAX_MS }),
    ).toBeNull();
  });
});

describe("sandbox readiness verdicts", () => {
  it("reads a UTF-16LE distribution list Windows prints byte-wise", () => {
    const utf16 = Array.from("Ubuntu\r\nDebian\r\n")
      .map((char) => char + "\u0000")
      .join("");
    expect(decodeWslDistroList(utf16)).toEqual(["Ubuntu", "Debian"]);
  });

  it("reads a UTF-8 list and drops the BOM and blank lines", () => {
    expect(decodeWslDistroList("\uFEFFUbuntu\n\n  Debian  \n")).toEqual(["Ubuntu", "Debian"]);
    expect(decodeWslDistroList("")).toEqual([]);
  });

  it("does not mistake the no-distributions sentence for a distribution", () => {
    expect(decodeWslDistroList("No installed distributions.\r\n")).toEqual([]);
    expect(decodeWslDistroList("No distributions.\r\n")).toEqual([]);
  });

  it("keeps exit code 0 as the verdict for a daemon that answers", () => {
    const docker = SANDBOX_READINESS_CHECKS.docker;
    expect(docker).toBeDefined();
    if (docker === undefined) return;
    expect(sandboxReadinessResult(docker, { exitCode: 0, stdout: "26.0.0", stderr: "" })).toEqual({
      ok: true,
      detail: null,
    });
    const failed = sandboxReadinessResult(docker, {
      exitCode: 1,
      stdout: "",
      stderr: "Cannot connect to the Docker daemon",
    });
    expect(failed.ok).toBe(false);
    expect(failed.detail).toContain("Cannot connect to the Docker daemon");
  });

  it("calls WSL unhealthy when the CLI answers but no distribution exists", () => {
    const wsl = SANDBOX_READINESS_CHECKS.wsl2;
    expect(wsl).toBeDefined();
    if (wsl === undefined) return;
    const empty = sandboxReadinessResult(wsl, {
      exitCode: 0,
      stdout: "No installed distributions.\r\n",
      stderr: "",
    });
    expect(empty.ok).toBe(false);
    expect(empty.detail).toBe(WSL_NO_DISTRO_DETAIL);
    expect(sandboxReadinessResult(wsl, { exitCode: 0, stdout: "Ubuntu\r\n", stderr: "" }).ok).toBe(
      true,
    );
    expect(
      sandboxReadinessResult(wsl, { exitCode: 1, stdout: "", stderr: "WSL is not installed" })
        .detail,
    ).toContain("WSL is not installed");
  });
});

describe("sandbox sync caps", () => {
  it("allows a project that fits the file and size caps", () => {
    expect(sandboxSyncProblem({ files: 1, bytes: 1_024 })).toBeNull();
    expect(
      sandboxSyncProblem({ files: SANDBOX_SYNC_MAX_FILES, bytes: SANDBOX_SYNC_MAX_BYTES }),
    ).toBeNull();
  });

  it("names the file count and the cap instead of copying a monorepo", () => {
    const problem = sandboxSyncProblem({ files: SANDBOX_SYNC_MAX_FILES + 1, bytes: 10 });
    expect(problem).toContain(String(SANDBOX_SYNC_MAX_FILES + 1));
    expect(problem).toContain("at most " + String(SANDBOX_SYNC_MAX_FILES));
    expect(problem).toContain("subdirectory");
  });

  it("names the size in whole megabytes", () => {
    const problem = sandboxSyncProblem({
      files: 2,
      bytes: SANDBOX_SYNC_MAX_BYTES + 1,
    });
    expect(problem).toContain("9 MB");
    expect(problem).toContain("8 MB");
  });
});
