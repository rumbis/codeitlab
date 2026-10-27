import { CodeItLabServiceError, SANDBOX_SYNC_DIR } from "@codeitlab/core";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { describe, expect } from "vite-plus/test";

import {
  makeSandboxService,
  SandboxCommandRunner,
  type SandboxCommandInput,
  type SandboxCommandOutput,
} from "./SandboxService.ts";

const missing = (command: string): SandboxCommandOutput => ({
  exitCode: -1,
  stdout: "",
  stderr: `ENOENT: ${command} was not found on PATH.`,
});

const available = (stdout: string): SandboxCommandOutput => ({
  exitCode: 0,
  stdout,
  stderr: "",
});

interface ServiceHarness {
  readonly calls: ReadonlyArray<SandboxCommandInput>;
  readonly service: ReturnType<typeof makeSandboxService>;
}

const makeHarness = (options: {
  readonly platform: string;
  readonly respond: (input: SandboxCommandInput) => SandboxCommandOutput;
}): ServiceHarness => {
  const calls: SandboxCommandInput[] = [];
  const runner = SandboxCommandRunner.of({
    run: (input) =>
      Effect.sync(() => {
        calls.push(input);
        return options.respond(input);
      }),
  });
  return {
    calls,
    service: makeSandboxService({ runner, platform: options.platform, arch: "arm64" }),
  };
};

const commandsRun = (calls: ReadonlyArray<SandboxCommandInput>): ReadonlyArray<string> =>
  calls.map((call) => call.command).sort();

describe("SandboxService status", () => {
  it.effect("marks Tart available when the CLI answers its version check", () => {
    const { service, calls } = makeHarness({
      platform: "darwin",
      respond: (input) =>
        input.command === "tart" ? available("tart 2.20.0\n") : missing(input.command),
    });
    return Effect.gen(function* () {
      const status = yield* service.status;
      const tart = status.backends.find((entry) => entry.id === "tart");

      expect(status.platform).toBe("darwin");
      expect(status.arch).toBe("arm64");
      expect(status.recommendedId).toBe("tart");
      expect(status.ready).toBe(true);
      expect(status.installAvailable).toBe(true);
      expect(tart?.state).toBe("available");
      expect(tart?.version).toBe("tart 2.20.0");
      expect(tart?.recommended).toBe(true);
      // Nothing needs installing, so Homebrew is not probed.
      expect(commandsRun(calls)).toEqual(["docker", "podman", "tart"]);
    });
  });

  it.effect("reports a missing CLI as not installed, never as unknown", () => {
    const { service } = makeHarness({
      platform: "darwin",
      respond: (input) => missing(input.command),
    });
    return Effect.gen(function* () {
      const status = yield* service.status;
      const byId = (id: string) => status.backends.find((entry) => entry.id === id);

      // Tart is installable here, so its missing row asks for consent rather
      // than telling the user to run the command themselves.
      expect(byId("tart")?.state).toBe("needs-consent");
      expect(byId("docker")?.state).toBe("not-installed");
      expect(byId("podman")?.state).toBe("not-installed");
      expect(status.backends.some((entry) => entry.state === "unknown")).toBe(false);
      expect(status.ready).toBe(false);
      expect(status.notes).toEqual([
        "Homebrew is not installed, so Tart cannot be installed from here.",
      ]);
    });
  });

  it.effect("does not guess when the version check fails for another reason", () => {
    const { service } = makeHarness({
      platform: "darwin",
      respond: (input) =>
        input.command === "tart"
          ? { exitCode: 1, stdout: "", stderr: "Permission denied" }
          : input.command === "brew"
            ? available("Homebrew 4.5.0\n")
            : missing(input.command),
    });
    return Effect.gen(function* () {
      const status = yield* service.status;
      const tart = status.backends.find((entry) => entry.id === "tart");

      expect(tart?.state).toBe("unknown");
      expect(tart?.version).toBeNull();
      expect(tart?.reason).toContain("did not answer its version check");
      expect(tart?.reason).toContain("Permission denied");
      expect(status.notes).toEqual([]);
      expect(status.ready).toBe(false);
    });
  });

  it.effect("runs nothing for backends this platform cannot use", () => {
    const { service, calls } = makeHarness({
      platform: "linux",
      respond: (input) => missing(input.command),
    });
    return Effect.gen(function* () {
      const status = yield* service.status;
      const tart = status.backends.find((entry) => entry.id === "tart");

      expect(tart?.state).toBe("unsupported");
      expect(tart?.reason).toBe("Tart is macOS-only.");
      expect(commandsRun(calls)).toEqual(["docker", "podman"]);
      expect(status.recommendedId).toBe("docker");
    });
  });
});

describe("SandboxService install", () => {
  it.effect("refuses a manual install without running anything and names the command", () => {
    const { service, calls } = makeHarness({
      platform: "linux",
      respond: (input) => missing(input.command),
    });
    return Effect.gen(function* () {
      const error = yield* service.install({ backend: "docker", consent: true }).pipe(Effect.flip);

      expect(error).toBeInstanceOf(CodeItLabServiceError);
      expect(error.operation).toBe("sandbox.install");
      expect(error.message).toContain("curl -fsSL https://get.docker.com | sh");
      expect(error.message).toContain("yourself");
      expect(calls).toHaveLength(0);
    });
  });

  it.effect("installs Tart through Homebrew after consent and re-probes", () => {
    let installed = false;
    const { service, calls } = makeHarness({
      platform: "darwin",
      respond: (input) => {
        if (input.command === "brew" && input.args[0] === "install") {
          installed = true;
          return available("==> Installing tart\n");
        }
        if (input.command === "brew") return available("Homebrew 4.5.0\n");
        if (input.command === "tart") {
          return installed ? available("tart 2.20.0\n") : missing("tart");
        }
        return missing(input.command);
      },
    });
    return Effect.gen(function* () {
      const result = yield* service.install({ backend: "tart", consent: true });

      expect(calls[0]).toEqual({
        command: "brew",
        args: ["install", "cirruslabs/cli/tart"],
        timeoutMs: 600_000,
      });
      expect(result.backend).toBe("tart");
      expect(result.ok).toBe(true);
      expect(result.message).toBe("Tart is installed.");
      expect(result.status.ready).toBe(true);
      expect(result.status.backends.find((entry) => entry.id === "tart")?.state).toBe("available");
      // The install is followed by a fresh probe rather than a remembered state.
      expect(calls.some((call) => call.command === "tart" && call.args[0] === "--version")).toBe(
        true,
      );
    });
  });

  it.effect("does not run an install without consent", () => {
    const { service, calls } = makeHarness({
      platform: "darwin",
      respond: (input) => missing(input.command),
    });
    return Effect.gen(function* () {
      const error = yield* service
        .install({ backend: "tart", consent: false as unknown as true })
        .pipe(Effect.flip);

      expect(error.operation).toBe("sandbox.install");
      expect(error.message).toContain("explicit consent");
      expect(calls).toHaveLength(0);
    });
  });

  it.effect("sanitizes the output tail and never echoes secrets", () => {
    const { service } = makeHarness({
      platform: "darwin",
      respond: (input) => {
        if (input.command === "brew" && input.args[0] === "install") {
          return {
            exitCode: 1,
            stdout: `\u001B[31m${"x".repeat(4_200)}\u001B[0m\nAPI_KEY=sk-live-123\nGITHUB_TOKEN=ghp_abcdef\n`,
            stderr: "\u001B[33mwarning\u001B[0m",
          };
        }
        if (input.command === "brew") return available("Homebrew 4.5.0\n");
        return missing(input.command);
      },
    });
    return Effect.gen(function* () {
      const result = yield* service.install({ backend: "tart", consent: true });

      expect(result.ok).toBe(false);
      expect(result.message).toContain("exited with code 1");
      expect(result.outputTail).not.toContain("\u001B[");
      expect(result.outputTail.length).toBeLessThanOrEqual(4_000);
      expect(result.outputTail).toContain("warning");
      expect(result.outputTail).not.toContain("sk-live-123");
      expect(result.outputTail).not.toContain("ghp_abcdef");
      expect(result.outputTail).toContain("API_KEY=[redacted]");
      expect(JSON.stringify(result)).not.toContain("sk-live-123");
    });
  });
});

describe("SandboxService health", () => {
  const readinessCommand = (input: SandboxCommandInput): boolean =>
    (input.command === "tart" && input.args[0] === "list") ||
    (input.command === "docker" && input.args[0] === "info") ||
    (input.command === "podman" && input.args[0] === "info") ||
    (input.command === "wsl" && input.args[0] === "--list");

  it.effect("asks the VM list after the version check and only then says ready", () => {
    const { service, calls } = makeHarness({
      platform: "darwin",
      respond: (input) => {
        if (input.command === "tart" && input.args[0] === "list") {
          return available('[{"name":"codeitlab-base"}]\n');
        }
        if (input.command === "tart") return available("tart 2.20.0\n");
        return missing(input.command);
      },
    });
    return Effect.gen(function* () {
      const health = yield* service.health;
      const tart = health.backends.find((entry) => entry.id === "tart");

      expect(health.platform).toBe("darwin");
      expect(health.ready).toBe(true);
      expect(health.readyId).toBe("tart");
      expect(health.message).toBe("Sandbox ready: Tart answered every check.");
      expect(tart?.healthy).toBe(true);
      expect(tart?.checks.map((check) => check.id)).toEqual(["version", "vm-list"]);
      expect(tart?.checks.every((check) => check.ok)).toBe(true);
      // The readiness check runs the backend's own binary with the matrix argv.
      const listCall = calls.find((call) => call.command === "tart" && call.args[0] === "list");
      expect(listCall?.args).toEqual(["list", "--format", "json"]);
      expect(listCall?.timeoutMs).toBeGreaterThan(0);
    });
  });

  it.effect("keeps the daemon's failure line instead of calling Docker ready", () => {
    const { service } = makeHarness({
      platform: "linux",
      respond: (input) => {
        if (input.command === "docker" && input.args[0] === "info") {
          return {
            exitCode: 1,
            stdout: "",
            stderr: "Cannot connect to the Docker daemon at unix:///var/run/docker.sock.\n",
          };
        }
        if (input.command === "docker") return available("Docker version 27.0.3\n");
        return missing(input.command);
      },
    });
    return Effect.gen(function* () {
      const health = yield* service.health;
      const docker = health.backends.find((entry) => entry.id === "docker");

      expect(health.ready).toBe(false);
      expect(docker?.healthy).toBe(false);
      expect(docker?.state).toBe("available");
      const daemon = docker?.checks.find((check) => check.id === "daemon");
      expect(daemon?.ok).toBe(false);
      expect(daemon?.detail).toContain("Cannot connect to the Docker daemon");
      expect(docker?.message).toContain("the docker daemon answers failed");
      expect(health.message.startsWith("Sandbox not ready:")).toBe(true);
    });
  });

  it.effect("does not run a readiness check for a backend that is not installed", () => {
    const { service, calls } = makeHarness({
      platform: "darwin",
      respond: (input) => missing(input.command),
    });
    return Effect.gen(function* () {
      const health = yield* service.health;
      const tart = health.backends.find((entry) => entry.id === "tart");

      expect(tart?.healthy).toBe(false);
      expect(tart?.checks).toHaveLength(1);
      expect(tart?.checks[0]?.id).toBe("version");
      expect(tart?.checks[0]?.ok).toBe(false);
      expect(calls.some(readinessCommand)).toBe(false);
      expect(health.ready).toBe(false);
    });
  });

  it.effect("reports a backend the platform cannot run without spawning it", () => {
    const { service, calls } = makeHarness({
      platform: "linux",
      respond: (input) =>
        input.command === "docker" && input.args[0] === "info"
          ? available("27.0.3\n")
          : input.command === "docker"
            ? available("Docker version 27.0.3\n")
            : missing(input.command),
    });
    return Effect.gen(function* () {
      const health = yield* service.health;
      const tart = health.backends.find((entry) => entry.id === "tart");

      expect(tart?.state).toBe("unsupported");
      expect(tart?.healthy).toBe(false);
      expect(tart?.checks).toEqual([]);
      expect(tart?.message).toBe("Tart cannot run on this platform.");
      expect(calls.some((call) => call.command === "tart")).toBe(false);
      expect(health.readyId).toBe("docker");
    });
  });

  it.effect("sanitizes the failing check line and keeps it short", () => {
    const { service } = makeHarness({
      platform: "darwin",
      respond: (input) => {
        if (input.command === "tart" && input.args[0] === "list") {
          return {
            exitCode: 1,
            stdout: "",
            stderr: "\u001B[31mError: VM daemon not running\u001B[0m\nAPI_KEY=sk-live-999\n",
          };
        }
        if (input.command === "tart") return available("tart 2.20.0\n");
        return missing(input.command);
      },
    });
    return Effect.gen(function* () {
      const health = yield* service.health;
      const tart = health.backends.find((entry) => entry.id === "tart");
      const list = tart?.checks.find((check) => check.id === "vm-list");

      expect(list?.ok).toBe(false);
      expect(list?.detail).not.toContain("\u001B[");
      expect(list?.detail).not.toContain("sk-live-999");
      expect(list?.detail).toContain("VM daemon not running");
      expect((list?.detail ?? "").length).toBeLessThanOrEqual(200);
      expect(JSON.stringify(health)).not.toContain("sk-live-999");
    });
  });

  it.effect("uses the distribution check on Windows", () => {
    const { service, calls } = makeHarness({
      platform: "win32",
      respond: (input) => {
        if (input.command === "wsl" && input.args[0] === "--list") {
          return available("Ubuntu\n");
        }
        if (input.command === "wsl") return available("WSL version: 2.2.4.0\n");
        return missing(input.command);
      },
    });
    return Effect.gen(function* () {
      const health = yield* service.health;
      const wsl = health.backends.find((entry) => entry.id === "wsl2");

      expect(wsl?.healthy).toBe(true);
      expect(wsl?.checks.map((check) => check.id)).toEqual(["version", "distros"]);
      const listCall = calls.find((call) => call.command === "wsl" && call.args[0] === "--list");
      expect(listCall?.args).toEqual(["--list", "--quiet"]);
      expect(health.readyId).toBe("wsl2");
    });
  });

  it.effect("refuses to call WSL ready when it has no distribution to run work in", () => {
    const { service } = makeHarness({
      platform: "win32",
      respond: (input) => {
        if (input.command === "wsl" && input.args[0] === "--list") {
          return available("No installed distributions.\r\n");
        }
        if (input.command === "wsl") return available("WSL version: 2.2.4.0\n");
        return missing(input.command);
      },
    });
    return Effect.gen(function* () {
      const health = yield* service.health;
      const wsl = health.backends.find((entry) => entry.id === "wsl2");
      const distros = wsl?.checks.find((check) => check.id === "distros");

      expect(wsl?.healthy).toBe(false);
      expect(distros?.ok).toBe(false);
      expect(distros?.detail).toContain("No distribution is installed");
      expect(wsl?.message).toContain("No distribution is installed");
      expect(health.ready).toBe(false);
      expect(health.readyId).toBeNull();
    });
  });

  it.effect("reads a UTF-16LE distribution list instead of calling it a failure", () => {
    const utf16 = (text: string): string =>
      Array.from(text)
        .map((char) => char + "\u0000")
        .join("");
    const { service } = makeHarness({
      platform: "win32",
      respond: (input) => {
        if (input.command === "wsl" && input.args[0] === "--list") {
          return available(utf16("Ubuntu\r\nDebian\r\n"));
        }
        if (input.command === "wsl") return available("WSL version: 2.2.4.0\n");
        return missing(input.command);
      },
    });
    return Effect.gen(function* () {
      const health = yield* service.health;
      const wsl = health.backends.find((entry) => entry.id === "wsl2");

      expect(wsl?.healthy).toBe(true);
      expect(wsl?.message).toBe("WSL2 answered every check.");
      expect(health.readyId).toBe("wsl2");
    });
  });
});

describe("SandboxService machines", () => {
  const tartList = (entries: ReadonlyArray<{ Name: string; State: string }>): string =>
    JSON.stringify(entries);

  it.effect("refuses to create a machine without consent", () => {
    const { service, calls } = makeHarness({
      platform: "darwin",
      respond: (input) =>
        input.command === "tart" ? available("tart 2.20.0\n") : missing(input.command),
    });
    return Effect.gen(function* () {
      const error = yield* Effect.flip(
        service.machineCreate({ backend: "tart", consent: false } as never),
      );
      expect(error.operation).toBe("sandbox.machine");
      expect(error.message).toContain("explicit consent");
      expect(calls).toHaveLength(0);
    });
  });

  it.effect("refuses to create a machine on a backend that is not installed", () => {
    const { service } = makeHarness({
      platform: "darwin",
      respond: (input) => missing(input.command),
    });
    return Effect.gen(function* () {
      const error = yield* Effect.flip(service.machineCreate({ backend: "tart", consent: true }));
      expect(error.message).toContain("not installed");
    });
  });

  it.effect("clones a Tart VM and reports the start command instead of claiming it runs", () => {
    let cloned = false;
    const { service, calls } = makeHarness({
      platform: "darwin",
      respond: (input) => {
        if (input.command === "tart" && input.args[0] === "clone") {
          cloned = true;
          return available("");
        }
        if (input.command === "tart" && input.args[0] === "list") {
          return available(
            cloned ? tartList([{ Name: "codeitlab-sandbox", State: "stopped" }]) : tartList([]),
          );
        }
        if (input.command === "tart") return available("tart 2.20.0\n");
        return missing(input.command);
      },
    });
    return Effect.gen(function* () {
      const result = yield* service.machineCreate({ backend: "tart", consent: true });

      expect(result.ok).toBe(true);
      expect(result.machine.state).toBe("stopped");
      expect(result.machine.name).toBe("codeitlab-sandbox");
      expect(result.message).toContain("Start it from Setup");
      const clone = calls.find((call) => call.command === "tart" && call.args[0] === "clone");
      expect(clone?.args).toEqual([
        "clone",
        "ghcr.io/cirruslabs/macos-sonoma-base:latest",
        "codeitlab-sandbox",
      ]);
    });
  });

  it.effect("says the image is missing instead of pretending a clone failed for no reason", () => {
    const { service } = makeHarness({
      platform: "darwin",
      respond: (input) => {
        if (input.command === "tart" && input.args[0] === "clone") {
          return {
            exitCode: 1,
            stdout: "",
            stderr:
              'Error: the image "ghcr.io/cirruslabs/macos-sonoma-base:latest" was not found locally\n',
          };
        }
        if (input.command === "tart" && input.args[0] === "list") {
          return available(tartList([]));
        }
        if (input.command === "tart") return available("tart 2.20.0\n");
        return missing(input.command);
      },
    });
    return Effect.gen(function* () {
      const result = yield* service.machineCreate({ backend: "tart", consent: true });

      expect(result.ok).toBe(false);
      expect(result.machine.state).toBe("missing");
      expect(result.message).toContain("tart pull ghcr.io/cirruslabs/macos-sonoma-base:latest");
      expect(result.message).toContain("does not download VM images");
    });
  });

  it.effect("creates a detached container and reports it running", () => {
    let started = false;
    const { service, calls } = makeHarness({
      platform: "linux",
      respond: (input) => {
        if (input.command === "docker" && input.args[0] === "run") {
          started = true;
          return available("abc123\n");
        }
        if (input.command === "docker" && input.args[0] === "inspect") {
          return started
            ? available("running\n")
            : { exitCode: 1, stdout: "", stderr: "Error: No such object: codeitlab-sandbox\n" };
        }
        if (input.command === "docker") return available("Docker version 27.0.3\n");
        return missing(input.command);
      },
    });
    return Effect.gen(function* () {
      const result = yield* service.machineCreate({ backend: "docker", consent: true });

      expect(result.ok).toBe(true);
      expect(result.machine.state).toBe("running");
      expect(result.message).toContain("Created and started the container codeitlab-sandbox");
      const run = calls.find((call) => call.command === "docker" && call.args[0] === "run");
      expect(run?.args).toEqual([
        "run",
        "-d",
        "--name",
        "codeitlab-sandbox",
        "node:22-bookworm-slim",
        "sleep",
        "infinity",
      ]);
    });
  });

  it.effect("does not create a second machine when one already exists", () => {
    const { service, calls } = makeHarness({
      platform: "linux",
      respond: (input) => {
        if (input.command === "docker" && input.args[0] === "inspect") {
          return available("running\n");
        }
        if (input.command === "docker") return available("Docker version 27.0.3\n");
        return missing(input.command);
      },
    });
    return Effect.gen(function* () {
      const result = yield* service.machineCreate({ backend: "docker", consent: true });

      expect(result.ok).toBe(true);
      expect(result.message).toContain("already running");
      expect(calls.some((call) => call.command === "docker" && call.args[0] === "run")).toBe(false);
    });
  });

  it.effect("removes the machine it finds and says so", () => {
    const { service, calls } = makeHarness({
      platform: "linux",
      respond: (input) => {
        if (input.command === "docker" && input.args[0] === "inspect")
          return available("running\n");
        if (input.command === "docker" && input.args[0] === "rm")
          return available("codeitlab-sandbox\n");
        if (input.command === "docker") return available("Docker version 27.0.3\n");
        return missing(input.command);
      },
    });
    return Effect.gen(function* () {
      const result = yield* service.machineRemove({ consent: true });

      expect(result.ok).toBe(true);
      expect(result.removed).toBe(true);
      expect(result.message).toBe("Removed the Docker machine.");
      expect(calls.some((call) => call.command === "docker" && call.args[0] === "rm")).toBe(true);
    });
  });

  it.effect("removes nothing without complaining when there is no machine", () => {
    const { service } = makeHarness({
      platform: "linux",
      respond: (input) => {
        if (input.command === "docker" && input.args[0] === "inspect") {
          return { exitCode: 1, stdout: "", stderr: "Error: No such object: codeitlab-sandbox\n" };
        }
        if (input.command === "docker") return available("Docker version 27.0.3\n");
        return missing(input.command);
      },
    });
    return Effect.gen(function* () {
      const result = yield* service.machineRemove({ consent: true });

      expect(result.ok).toBe(true);
      expect(result.removed).toBe(false);
      expect(result.message).toBe("There is no sandbox machine to remove.");
    });
  });

  it.effect("runs a command inside the running container and returns its output", () => {
    const { service, calls } = makeHarness({
      platform: "linux",
      respond: (input) => {
        if (input.command === "docker" && input.args[0] === "inspect")
          return available("running\n");
        if (input.command === "docker" && input.args[0] === "exec") {
          return { exitCode: 0, stdout: "Linux 6.8.0 aarch64\n", stderr: "" };
        }
        if (input.command === "docker") return available("Docker version 27.0.3\n");
        return missing(input.command);
      },
    });
    return Effect.gen(function* () {
      const result = yield* service.run({ command: "uname -a" });

      expect(result.ok).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Linux 6.8.0");
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      const exec = calls.find((call) => call.command === "docker" && call.args[0] === "exec");
      expect(exec?.args).toEqual(["exec", "codeitlab-sandbox", "/bin/sh", "-lc", "uname -a"]);
    });
  });

  it.effect("refuses to run a command when there is no machine", () => {
    const { service } = makeHarness({
      platform: "linux",
      respond: (input) => {
        if (input.command === "docker" && input.args[0] === "inspect") {
          return { exitCode: 1, stdout: "", stderr: "Error: No such object: codeitlab-sandbox\n" };
        }
        if (input.command === "docker") return available("Docker version 27.0.3\n");
        return missing(input.command);
      },
    });
    return Effect.gen(function* () {
      const error = yield* Effect.flip(service.run({ command: "ls" }));
      expect(error.operation).toBe("sandbox.run");
      expect(error.message).toContain("no sandbox machine yet");
    });
  });

  it.effect("names the start command when the Tart machine is stopped", () => {
    const { service } = makeHarness({
      platform: "darwin",
      respond: (input) => {
        if (input.command === "tart" && input.args[0] === "list") {
          return available(tartList([{ Name: "codeitlab-sandbox", State: "stopped" }]));
        }
        if (input.command === "tart") return available("tart 2.20.0\n");
        return missing(input.command);
      },
    });
    return Effect.gen(function* () {
      const error = yield* Effect.flip(service.run({ command: "ls" }));
      expect(error.message).toContain("tart run codeitlab-sandbox --no-graphics");
      expect(error.message).toContain("Start it in Setup");
      expect(error.message).toContain("tart run codeitlab-sandbox --no-graphics");
    });
  });

  it.effect("refuses an empty command before touching the machine", () => {
    const { service, calls } = makeHarness({
      platform: "linux",
      respond: (input) =>
        input.command === "docker" ? available("Docker version 27.0.3\n") : missing(input.command),
    });
    return Effect.gen(function* () {
      const error = yield* Effect.flip(service.run({ command: "   " }));
      expect(error.message).toContain("Write a command");
      expect(calls).toHaveLength(0);
    });
  });

  it.effect("caps command output and keeps secrets out of it", () => {
    const { service } = makeHarness({
      platform: "linux",
      respond: (input) => {
        if (input.command === "docker" && input.args[0] === "inspect")
          return available("running\n");
        if (input.command === "docker" && input.args[0] === "exec") {
          return {
            exitCode: 1,
            stdout: "x".repeat(9_000) + "\nAPI_KEY=sk-live-777\n",
            stderr: "\u001B[31mboom\u001B[0m\n",
          };
        }
        if (input.command === "docker") return available("Docker version 27.0.3\n");
        return missing(input.command);
      },
    });
    return Effect.gen(function* () {
      const result = yield* service.run({ command: "make" });

      expect(result.ok).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(result.stdout.length).toBeLessThanOrEqual(8_000);
      expect(result.stdout).not.toContain("sk-live-777");
      expect(result.stderr).not.toContain("\u001B[");
      expect(result.stderr).toContain("boom");
      expect(JSON.stringify(result)).not.toContain("sk-live-777");
    });
  });

  it.effect("health reports the machine on the ready backend", () => {
    const { service } = makeHarness({
      platform: "darwin",
      respond: (input) => {
        if (input.command === "tart" && input.args[0] === "list") {
          return available(tartList([{ Name: "codeitlab-sandbox", State: "running" }]));
        }
        if (input.command === "tart") return available("tart 2.20.0\n");
        return missing(input.command);
      },
    });
    return Effect.gen(function* () {
      const health = yield* service.health;

      expect(health.ready).toBe(true);
      expect(health.machine?.backend).toBe("tart");
      expect(health.machine?.state).toBe("running");
    });
  });

  it.effect("health says the machine is missing when nothing was created", () => {
    const { service } = makeHarness({
      platform: "darwin",
      respond: (input) => {
        if (input.command === "tart" && input.args[0] === "list") return available(tartList([]));
        if (input.command === "tart") return available("tart 2.20.0\n");
        return missing(input.command);
      },
    });
    return Effect.gen(function* () {
      const health = yield* service.health;
      expect(health.machine?.state).toBe("missing");
    });
  });
});

describe("SandboxService machine start and stop", () => {
  const tartList = (entries: ReadonlyArray<{ Name: string; State: string }>): string =>
    JSON.stringify(entries);

  it.effect("refuses to start a machine without consent", () => {
    const { service, calls } = makeHarness({
      platform: "darwin",
      respond: (input) =>
        input.command === "tart" ? available("tart 2.20.0\n") : missing(input.command),
    });
    return Effect.gen(function* () {
      const error = yield* Effect.flip(
        service.machineStart({ backend: "tart", consent: false } as never),
      );
      expect(error.message).toContain("explicit consent");
      expect(calls).toHaveLength(0);
    });
  });

  it.effect("says to create the machine first when there is nothing to start", () => {
    const { service } = makeHarness({
      platform: "darwin",
      respond: (input) => {
        if (input.command === "tart" && input.args[0] === "list") return available(tartList([]));
        if (input.command === "tart") return available("tart 2.20.0\n");
        return missing(input.command);
      },
    });
    return Effect.gen(function* () {
      const error = yield* Effect.flip(service.machineStart({ backend: "tart", consent: true }));
      expect(error.message).toContain("Create it in Setup first");
    });
  });

  it.effect("backgrounds tart run and believes tart list, not the spawn", () => {
    let running = false;
    const { service, calls } = makeHarness({
      platform: "darwin",
      respond: (input) => {
        if (input.command === "sh") {
          running = true;
          return available("4242\n");
        }
        if (input.command === "tart" && input.args[0] === "list") {
          return available(
            tartList([{ Name: "codeitlab-sandbox", State: running ? "running" : "stopped" }]),
          );
        }
        if (input.command === "tart") return available("tart 2.20.0\n");
        return missing(input.command);
      },
    });
    return Effect.gen(function* () {
      const result = yield* service.machineStart({ backend: "tart", consent: true });

      expect(result.ok).toBe(true);
      expect(result.machine.state).toBe("running");
      expect(result.message).toContain("Started the Tart machine");
      const spawn = calls.find((call) => call.command === "sh");
      expect(spawn?.args[1]).toContain("nohup tart run codeitlab-sandbox --no-graphics");
      expect(spawn?.args[1]).toContain("&");
    });
  });

  it.effect("does not spawn a second tart run when the VM is already running", () => {
    const { service, calls } = makeHarness({
      platform: "darwin",
      respond: (input) => {
        if (input.command === "tart" && input.args[0] === "list") {
          return available(tartList([{ Name: "codeitlab-sandbox", State: "running" }]));
        }
        if (input.command === "tart") return available("tart 2.20.0\n");
        return missing(input.command);
      },
    });
    return Effect.gen(function* () {
      const result = yield* service.machineStart({ backend: "tart", consent: true });

      expect(result.ok).toBe(true);
      expect(result.message).toContain("already running");
      expect(calls.some((call) => call.command === "sh")).toBe(false);
    });
  });

  it.effect("reports a Tart VM that did not come up instead of claiming success", () => {
    const { service } = makeHarness({
      platform: "darwin",
      respond: (input) => {
        if (input.command === "sh") return available("4242\n");
        if (input.command === "tart" && input.args[0] === "list") {
          return available(tartList([{ Name: "codeitlab-sandbox", State: "stopped" }]));
        }
        if (input.command === "tart") return available("tart 2.20.0\n");
        return missing(input.command);
      },
    });
    return Effect.gen(function* () {
      const result = yield* service.machineStart({ backend: "tart", consent: true });

      expect(result.ok).toBe(false);
      expect(result.machine.state).toBe("stopped");
      expect(result.message).toContain("is stopped after starting");
    });
  });

  it.effect("starts a stopped container with the backend's own start", () => {
    let running = false;
    const { service, calls } = makeHarness({
      platform: "linux",
      respond: (input) => {
        if (input.command === "docker" && input.args[0] === "start") {
          running = true;
          return available("");
        }
        if (input.command === "docker" && input.args[0] === "inspect") {
          return available(running ? "running\n" : "exited\n");
        }
        if (input.command === "docker") return available("Docker version 27.0.0\n");
        return missing(input.command);
      },
    });
    return Effect.gen(function* () {
      const result = yield* service.machineStart({ backend: "docker", consent: true });

      expect(result.ok).toBe(true);
      expect(result.machine.state).toBe("running");
      expect(calls.some((call) => call.command === "docker" && call.args[0] === "start")).toBe(
        true,
      );
    });
  });

  it.effect("stops a running machine and re-reads its state", () => {
    let running = true;
    const { service, calls } = makeHarness({
      platform: "darwin",
      respond: (input) => {
        if (input.command === "tart" && input.args[0] === "stop") {
          running = false;
          return available("");
        }
        if (input.command === "tart" && input.args[0] === "list") {
          return available(
            tartList([{ Name: "codeitlab-sandbox", State: running ? "running" : "stopped" }]),
          );
        }
        if (input.command === "tart") return available("tart 2.20.0\n");
        return missing(input.command);
      },
    });
    return Effect.gen(function* () {
      const result = yield* service.machineStop({ consent: true });

      expect(result.ok).toBe(true);
      expect(result.stopped).toBe(true);
      expect(result.message).toContain("Stopped the Tart machine");
      expect(calls.some((call) => call.command === "tart" && call.args[0] === "stop")).toBe(true);
    });
  });

  it.effect("says nothing is running when stop finds no machine", () => {
    const { service, calls } = makeHarness({
      platform: "darwin",
      respond: (input) => {
        if (input.command === "tart" && input.args[0] === "list") return available(tartList([]));
        if (input.command === "tart") return available("tart 2.20.0\n");
        return missing(input.command);
      },
    });
    return Effect.gen(function* () {
      const result = yield* service.machineStop({ consent: true });

      expect(result.ok).toBe(true);
      expect(result.stopped).toBe(false);
      expect(result.message).toContain("No sandbox machine is running");
      expect(calls.some((call) => call.args[0] === "stop")).toBe(false);
    });
  });
});

describe("SandboxService machineSync", () => {
  const tartList = (entries: ReadonlyArray<{ Name: string; State: string }>): string =>
    JSON.stringify(entries);
  const syncScript = `mkdir -p ${SANDBOX_SYNC_DIR} && cd ${SANDBOX_SYNC_DIR} && base64 -d | tar -xf -`;
  // "foobar" in base64; 9 characters, so the tar is 6 bytes.
  const archiveBase64 = "Zm9vYmFy\n";

  const runningDocker = (input: SandboxCommandInput): SandboxCommandOutput | null => {
    if (input.command === "docker" && input.args[0] === "inspect") return available("running\n");
    if (input.command === "docker" && input.args[0] === "exec") return available("");
    if (input.command === "docker") return available("Docker version 27.0.3\n");
    return null;
  };

  it.effect("refuses to copy when the only machine is stopped", () => {
    const { service, calls } = makeHarness({
      platform: "darwin",
      respond: (input) => {
        if (input.command === "tart" && input.args[0] === "list") {
          return available(tartList([{ Name: "codeitlab-sandbox", State: "stopped" }]));
        }
        if (input.command === "tart") return available("tart 2.20.0\n");
        return missing(input.command);
      },
    });
    return Effect.gen(function* () {
      const error = yield* Effect.flip(service.machineSync({ cwd: "/repo" }));

      expect(error.operation).toBe("sandbox.machineSync");
      expect(error.message).toContain("tart run codeitlab-sandbox --no-graphics");
      expect(error.message).toContain("Start it in Setup");
      // The host archive commands never ran, and nothing was exec'd.
      expect(calls.some((call) => call.command === "sh")).toBe(false);
      expect(calls.some((call) => call.args[0] === "exec")).toBe(false);
    });
  });

  it.effect("refuses an over-cap project without running a machine command", () => {
    const { service, calls } = makeHarness({
      platform: "linux",
      respond: (input) => {
        const docker = runningDocker(input);
        if (docker !== null) return docker;
        if (input.command === "sh" && input.args[1]?.includes("ls-files"))
          return available("600\n");
        if (input.command === "sh" && input.args[1]?.includes("archive"))
          return available(archiveBase64);
        return missing(input.command);
      },
    });
    return Effect.gen(function* () {
      const result = yield* service.machineSync({ cwd: "/repo" });

      expect(result.ok).toBe(false);
      expect(result.files).toBe(600);
      expect(result.bytes).toBe(6);
      expect(result.message).toContain("600 tracked files");
      expect(result.outputTail).toBe("");
      expect(calls.some((call) => call.args[0] === "exec")).toBe(false);
    });
  });

  it.effect("returns an honest result when the project cannot be archived", () => {
    const { service } = makeHarness({
      platform: "linux",
      respond: (input) => {
        const docker = runningDocker(input);
        if (docker !== null) return docker;
        if (input.command === "sh" && input.args[1]?.includes("ls-files")) {
          return { exitCode: 1, stdout: "0\n", stderr: "fatal: not a git repository\n" };
        }
        if (input.command === "sh" && input.args[1]?.includes("archive")) {
          return {
            exitCode: 128,
            stdout: "",
            stderr: "\u001B[31mfatal: not a git repository (or any parent)\u001B[0m\n",
          };
        }
        return missing(input.command);
      },
    });
    return Effect.gen(function* () {
      const result = yield* service.machineSync({ cwd: "/not-a-repo" });

      expect(result.ok).toBe(false);
      expect(result.files).toBe(0);
      expect(result.bytes).toBe(0);
      expect(result.message).toContain("Could not archive that project:");
      expect(result.message).toContain("not a git repository");
      expect(result.outputTail).toContain("fatal");
      expect(result.outputTail).not.toContain("\u001B[");
    });
  });

  it.effect("sends the archive on stdin to docker with exec -i", () => {
    const { service, calls } = makeHarness({
      platform: "linux",
      respond: (input) => {
        const docker = runningDocker(input);
        if (docker !== null) return docker;
        if (input.command === "sh" && input.args[1]?.includes("ls-files")) return available("3\n");
        if (input.command === "sh" && input.args[1]?.includes("archive"))
          return available(archiveBase64);
        return missing(input.command);
      },
    });
    return Effect.gen(function* () {
      const result = yield* service.machineSync({ cwd: "/repo" });

      expect(result.ok).toBe(true);
      expect(result.files).toBe(3);
      expect(result.bytes).toBe(6);
      expect(result.message).toBe(
        "Copied 3 tracked files (0.0 MB) into /work in the codeitlab-sandbox machine.",
      );
      const archive = calls.find((call) => call.args[1]?.includes("archive"));
      expect(archive?.args).toEqual(["-c", "git -C '/repo' archive --format=tar HEAD | base64"]);
      expect(archive?.timeoutMs).toBe(60_000);
      const exec = calls.find((call) => call.args[0] === "exec");
      expect(exec?.command).toBe("docker");
      expect(exec?.args).toEqual(["exec", "-i", "codeitlab-sandbox", "sh", "-lc", syncScript]);
      expect(exec?.stdin).toBe(archiveBase64);
      expect(Buffer.from(exec?.stdin ?? "", "base64").toString("utf8")).toBe("foobar");
    });
  });

  it.effect("copies through tart exec without -i", () => {
    const { service, calls } = makeHarness({
      platform: "darwin",
      respond: (input) => {
        if (input.command === "tart" && input.args[0] === "list") {
          return available(tartList([{ Name: "codeitlab-sandbox", State: "running" }]));
        }
        if (input.command === "tart" && input.args[0] === "exec") return available("");
        if (input.command === "tart") return available("tart 2.20.0\n");
        if (input.command === "sh" && input.args[1]?.includes("ls-files")) return available("1\n");
        if (input.command === "sh" && input.args[1]?.includes("archive"))
          return available(archiveBase64);
        return missing(input.command);
      },
    });
    return Effect.gen(function* () {
      const result = yield* service.machineSync({ cwd: "/repo" });

      expect(result.ok).toBe(true);
      expect(result.message).toContain("Copied 1 tracked files");
      const exec = calls.find((call) => call.args[0] === "exec");
      expect(exec?.command).toBe("tart");
      expect(exec?.args).toEqual(["exec", "codeitlab-sandbox", "sh", "-lc", syncScript]);
      expect(exec?.stdin).toBe(archiveBase64);
    });
  });

  it.effect("keeps the machine's refusal line and redacts the tail", () => {
    const { service } = makeHarness({
      platform: "linux",
      respond: (input) => {
        if (input.command === "docker" && input.args[0] === "inspect")
          return available("running\n");
        if (input.command === "docker" && input.args[0] === "exec") {
          return {
            exitCode: 1,
            stdout: "",
            stderr: "\u001B[31mtar: invalid archive\u001B[0m\nAPI_KEY=sk-live-9\n",
          };
        }
        if (input.command === "docker") return available("Docker version 27.0.3\n");
        if (input.command === "sh" && input.args[1]?.includes("ls-files")) return available("3\n");
        if (input.command === "sh" && input.args[1]?.includes("archive"))
          return available(archiveBase64);
        return missing(input.command);
      },
    });
    return Effect.gen(function* () {
      const result = yield* service.machineSync({ cwd: "/repo" });

      expect(result.ok).toBe(false);
      expect(result.message).toBe("The machine refused the copy: tar: invalid archive");
      expect(result.outputTail).not.toContain("\u001B[");
      expect(result.outputTail).not.toContain("sk-live-9");
      expect(result.outputTail).toContain("API_KEY=[redacted]");
    });
  });
});
