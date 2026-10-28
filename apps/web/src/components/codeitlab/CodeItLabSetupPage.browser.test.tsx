import * as Result from "effect/Result";
import type {
  SandboxBackendId,
  SandboxBackendStatus,
  SandboxCheck,
  SandboxHealth,
  SandboxHealthBackend,
  SandboxMachine,
  SandboxStatus,
} from "@codeitlab/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render as renderUi } from "../../../test/render";
import { CodeItLabSetupPage } from "./CodeItLabSetupPage";

const mock = vi.hoisted(() => ({
  status: null as unknown,
  health: null as unknown,
  installs: [] as Array<{ backend: string; consent: boolean }>,
  installResult: null as unknown,
  refreshes: 0,
  healthRefreshes: 0,
  creates: [] as Array<{ backend: string }>,
  removes: 0,
  starts: [] as Array<{ backend: string }>,
  stops: 0,
  runs: [] as string[],
  createResult: null as unknown,
  removeResult: null as unknown,
  startResult: null as unknown,
  stopResult: null as unknown,
  runResult: null as unknown,
  nextHealth: null as unknown,
  machineError: null as string | null,
}));

vi.mock(import("../../codeitlab/api"), async (original) => {
  const { useState } = await import("react");
  return {
    ...(await original()),
    useCodeItLabSandbox: (() => ({
      status: mock.status,
      refresh: () => {
        mock.refreshes += 1;
      },
      install: async (input: { backend: string; consent: boolean }) => {
        mock.installs.push(input);
        return mock.installResult;
      },
    })) as never,
    useCodeItLabSandboxHealth: (() => {
      const [health, setHealth] = useState(mock.health);
      return {
        health,
        refresh: () => {
          mock.healthRefreshes += 1;
          if (mock.nextHealth !== null) {
            mock.health = mock.nextHealth;
            mock.nextHealth = null;
          }
          setHealth(mock.health);
        },
      };
    }) as never,
    useSandboxMachineActions: (() => ({
      create: async (backend: string) => {
        mock.creates.push({ backend });
        return mock.createResult;
      },
      remove: async () => {
        mock.removes += 1;
        return mock.removeResult;
      },
      start: async (backend: string) => {
        mock.starts.push({ backend });
        return mock.startResult;
      },
      stop: async () => {
        mock.stops += 1;
        return mock.stopResult;
      },
      run: async (command: string) => {
        mock.runs.push(command);
        return mock.runResult;
      },
      pending: null,
      error: mock.machineError,
    })) as never,
  };
});

const TART_COMMAND = "brew install cirruslabs/cli/tart";
const DOCKER_MAC_COMMAND = "brew install --cask docker";
const PODMAN_MAC_COMMAND = "brew install podman";
const DOCKER_LINUX_COMMAND = "curl -fsSL https://get.docker.com | sh";

const LABELS: Readonly<Record<SandboxBackendId, string>> = {
  tart: "Tart",
  docker: "Docker",
  podman: "Podman",
  wsl2: "WSL2",
};

const SUMMARIES: Readonly<Record<SandboxBackendId, string>> = {
  tart: "Apple-silicon macOS VMs.",
  docker: "Containers.",
  podman: "Rootless containers.",
  wsl2: "The Windows path: a Linux kernel inside Windows.",
};

const DOCS: Readonly<Record<SandboxBackendId, string>> = {
  tart: "https://tart.run",
  docker: "https://docs.docker.com/get-docker/",
  podman: "https://podman.io",
  wsl2: "https://learn.microsoft.com/windows/wsl/install",
};

function backend(
  id: SandboxBackendId,
  platform: SandboxStatus["platform"],
  patch: Partial<SandboxBackendStatus> = {},
): SandboxBackendStatus {
  return {
    id,
    label: LABELS[id],
    summary: SUMMARIES[id],
    platform,
    state: "not-installed",
    version: null,
    installCommand: null,
    autoInstall: false,
    installNote: null,
    reason: LABELS[id] + " is not installed.",
    recommended: false,
    docsUrl: DOCS[id],
    ...patch,
  };
}

function status(
  platform: SandboxStatus["platform"],
  backends: ReadonlyArray<SandboxBackendStatus>,
  patch: Partial<SandboxStatus> = {},
): SandboxStatus {
  const recommendedId =
    platform === "darwin"
      ? "tart"
      : platform === "linux"
        ? "docker"
        : platform === "win32"
          ? "wsl2"
          : null;
  return {
    platform,
    arch: platform === "darwin" ? "arm64" : "x64",
    checkedAt: "2026-10-25T03:00:00.000Z",
    backends,
    recommendedId,
    ready: backends.some((row) => row.id === recommendedId && row.state === "available"),
    installAvailable: backends.some((row) => row.autoInstall),
    notes: [],
    ...patch,
  };
}

function macBackends(): ReadonlyArray<SandboxBackendStatus> {
  return [
    backend("tart", "darwin", {
      state: "needs-consent",
      installCommand: TART_COMMAND,
      autoInstall: true,
      recommended: true,
      reason:
        "Tart is not installed. Installing runs " +
        TART_COMMAND +
        " on this machine, so it waits for your consent.",
    }),
    backend("docker", "darwin", {
      installCommand: DOCKER_MAC_COMMAND,
      reason:
        "Docker is not installed. Run " +
        DOCKER_MAC_COMMAND +
        " yourself; the app does not run this one.",
    }),
    backend("podman", "darwin", {
      installCommand: PODMAN_MAC_COMMAND,
      reason:
        "Podman is not installed. Run " +
        PODMAN_MAC_COMMAND +
        " yourself; the app does not run this one.",
    }),
    backend("wsl2", "darwin", { state: "unsupported", reason: "WSL2 is Windows-only." }),
  ];
}

function linuxBackends(): ReadonlyArray<SandboxBackendStatus> {
  return [
    backend("tart", "linux", { state: "unsupported", reason: "Tart is macOS-only." }),
    backend("docker", "linux", {
      installCommand: DOCKER_LINUX_COMMAND,
      recommended: true,
      reason:
        "Docker is not installed. Run " +
        DOCKER_LINUX_COMMAND +
        " yourself; the app does not run this one.",
    }),
    backend("podman", "linux", {
      installCommand: "sudo apt install podman",
      reason:
        "Podman is not installed. Run sudo apt install podman yourself; the app does not run this one.",
    }),
    backend("wsl2", "linux", { state: "unsupported", reason: "WSL2 is Windows-only." }),
  ];
}

function readyMacStatus(): SandboxStatus {
  return status(
    "darwin",
    macBackends().map((row) =>
      row.id === "tart"
        ? {
            ...row,
            state: "available",
            version: "tart 2.20.0",
            reason: "Tart answers, so a VM sandbox can be created.",
          }
        : row,
    ),
    { ready: true },
  );
}

function check(id: string, label: string, ok: boolean, detail: string | null = null): SandboxCheck {
  return { id, label, ok, detail };
}

function healthBackend(
  id: SandboxBackendId,
  patch: Partial<SandboxHealthBackend> = {},
): SandboxHealthBackend {
  return {
    id,
    label: LABELS[id],
    state: "available",
    recommended: id === "tart",
    healthy: true,
    checks: [],
    message: LABELS[id] + " answered every check.",
    ...patch,
  };
}

function health(
  backends: ReadonlyArray<SandboxHealthBackend>,
  patch: Partial<SandboxHealth> = {},
): SandboxHealth {
  const readyBackend =
    backends.find((backend) => backend.healthy && backend.recommended) ??
    backends.find((backend) => backend.healthy) ??
    null;
  return {
    platform: "darwin",
    arch: "arm64",
    checkedAt: "2026-10-25T07:00:00.000Z",
    backends,
    readyId: readyBackend?.id ?? null,
    ready: readyBackend !== null,
    message:
      readyBackend === null
        ? "No sandbox backend can run on this platform."
        : "Sandbox ready: " + readyBackend.message,
    machine: null,
    ...patch,
  };
}

function machine(patch: Partial<SandboxMachine> = {}): SandboxMachine {
  return {
    backend: "tart",
    name: "codeitlab-sandbox",
    image: "ghcr.io/cirruslabs/macos-sonoma-base:latest",
    state: "missing",
    detail: null,
    ...patch,
  };
}

function readyHealth(): SandboxHealth {
  return health([
    healthBackend("tart", {
      checks: [
        check("version", "Tart answers its version check", true),
        check("vm-list", "Tart answers its VM list", true),
      ],
    }),
  ]);
}

function failingHealth(): SandboxHealth {
  const message =
    "Tart answered its version check, but tart answers its VM list failed: Error: no such VM";
  return health(
    [
      healthBackend("tart", {
        healthy: false,
        checks: [
          check("version", "Tart answers its version check", true),
          check("vm-list", "Tart answers its VM list", false, "Error: no such VM"),
        ],
        message,
      }),
    ],
    { message: "Sandbox not ready: " + message },
  );
}

function setup(
  options: {
    readonly status?: SandboxStatus;
    readonly health?: SandboxHealth;
    readonly loading?: boolean;
    readonly error?: string | null;
    readonly healthError?: string | null;
    readonly installResult?: unknown;
    readonly createResult?: unknown;
    readonly removeResult?: unknown;
    readonly startResult?: unknown;
    readonly stopResult?: unknown;
    readonly runResult?: unknown;
    readonly nextHealth?: unknown;
    readonly machineError?: string | null;
  } = {},
): void {
  mock.installs.length = 0;
  mock.refreshes = 0;
  mock.healthRefreshes = 0;
  mock.creates.length = 0;
  mock.removes = 0;
  mock.starts.length = 0;
  mock.stops = 0;
  mock.runs.length = 0;
  mock.installResult = options.installResult ?? null;
  mock.createResult = options.createResult ?? null;
  mock.removeResult = options.removeResult ?? null;
  mock.startResult = options.startResult ?? null;
  mock.stopResult = options.stopResult ?? null;
  mock.runResult = options.runResult ?? null;
  mock.nextHealth = options.nextHealth ?? null;
  mock.machineError = options.machineError ?? null;
  mock.status =
    options.error != null
      ? Result.fail(options.error)
      : options.loading === true || options.status === undefined
        ? null
        : Result.succeed(options.status);
  mock.health =
    options.healthError != null
      ? Result.fail(options.healthError)
      : options.health === undefined
        ? null
        : Result.succeed(options.health);
}

function rowFor(container: HTMLElement, id: SandboxBackendId): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-sandbox-backend="' + id + '"]');
}

function buttonLabels(row: Element): ReadonlyArray<string> {
  return [...row.querySelectorAll("button")].map((button) => button.textContent?.trim() ?? "");
}

function installButtons(container: HTMLElement): ReadonlyArray<HTMLButtonElement> {
  return [...container.querySelectorAll<HTMLButtonElement>("button")].filter(
    (button) => button.textContent?.trim() === "Install",
  );
}

describe("CodeItLabSetupPage", () => {
  it("renders the macOS matrix from the server status", async () => {
    setup({ status: status("darwin", macBackends()) });
    await using screen = await renderUi(<CodeItLabSetupPage />);

    expect(screen.container.querySelector("[data-codeitlab-page=setup]")).not.toBeNull();
    const tart = rowFor(screen.container, "tart");
    expect(tart?.getAttribute("data-sandbox-state")).toBe("needs-consent");
    expect(tart?.textContent).toContain("Recommended");
    expect(screen.getByText("needs consent")).toBeDefined();
    // Only Tart is installable by the app on macOS.
    expect(installButtons(screen.container)).toHaveLength(1);

    // The action group names the visible reason, and the page keeps one live region.
    const actions = tart?.querySelector('[role="group"]');
    expect(actions?.getAttribute("aria-describedby")).toBe("sandbox-reason-tart");
    expect(screen.container.querySelector("#sandbox-reason-tart")?.textContent).toContain(
      TART_COMMAND,
    );
    // One live region for the status probe, one for the health sentence.
    expect(screen.container.querySelectorAll('[aria-live="polite"]')).toHaveLength(2);

    const docker = rowFor(screen.container, "docker");
    expect(docker?.getAttribute("data-sandbox-state")).toBe("not-installed");
    expect(buttonLabels(docker!)).not.toContain("Install");
    expect(buttonLabels(docker!)).toContain("Copy command");
    expect(docker?.textContent).toContain(DOCKER_MAC_COMMAND);

    // The manual Podman row keeps its copy command too.
    expect(buttonLabels(rowFor(screen.container, "podman")!)).toContain("Copy command");
    // WSL2 is not supported on macOS and says so.
    expect(rowFor(screen.container, "wsl2")?.textContent).toContain("WSL2 is Windows-only.");
  });

  it("says Tart is macOS-only on Linux and offers no Install button for it", async () => {
    setup({ status: status("linux", linuxBackends()) });
    await using screen = await renderUi(<CodeItLabSetupPage />);

    const tart = rowFor(screen.container, "tart");
    expect(tart?.getAttribute("data-sandbox-state")).toBe("unsupported");
    expect(tart?.textContent).toContain("Tart is macOS-only.");
    expect(buttonLabels(tart!)).not.toContain("Install");
    expect(buttonLabels(tart!)).not.toContain("Copy command");

    const docker = rowFor(screen.container, "docker");
    expect(docker).not.toBeNull();
    expect(docker?.textContent).toContain(DOCKER_LINUX_COMMAND);
    expect(buttonLabels(docker!)).toContain("Copy command");
    expect(installButtons(screen.container)).toHaveLength(0);
  });

  it("waits for explicit confirmation before installing and then reports ready", async () => {
    setup({
      status: status("darwin", macBackends()),
      installResult: {
        backend: "tart",
        ok: true,
        message: "Tart installed.",
        outputTail: "",
        status: readyMacStatus(),
      },
    });
    await using screen = await renderUi(<CodeItLabSetupPage />);

    await userEvent.click(screen.getByRole("button", { name: /^install$/i }));
    await expect
      .element(screen.getByText("This runs " + TART_COMMAND + " on this machine."))
      .toBeVisible();
    expect(mock.installs).toEqual([]);

    await userEvent.click(screen.getByRole("button", { name: /^confirm$/i }));
    await vi.waitFor(() => expect(mock.installs).toEqual([{ backend: "tart", consent: true }]));
    await vi.waitFor(() =>
      expect(screen.container.querySelector("#sandbox-live")?.textContent).toBe("Sandbox ready"),
    );
    expect(rowFor(screen.container, "tart")?.getAttribute("data-sandbox-state")).toBe("available");
  });

  it("copies the exact command and announces it in the live region", async () => {
    setup({ status: status("darwin", macBackends()) });
    await using screen = await renderUi(<CodeItLabSetupPage />);
    using writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);

    const tart = rowFor(screen.container, "tart")!;
    const copy = [...tart.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Copy command",
    );
    await userEvent.click(copy!);

    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(TART_COMMAND));
    await expect
      .element(screen.getByRole("status"))
      .toHaveTextContent("Copied Tart install command.");
  });

  it("shows the install output tail when an install fails and keeps the row uninstalled", async () => {
    setup({
      status: status("darwin", macBackends()),
      installResult: {
        backend: "tart",
        ok: false,
        message: "brew install failed",
        outputTail: "Error: formula not found",
        status: status("darwin", macBackends()),
      },
    });
    await using screen = await renderUi(<CodeItLabSetupPage />);

    await userEvent.click(screen.getByRole("button", { name: /^install$/i }));
    await userEvent.click(screen.getByRole("button", { name: /^confirm$/i }));

    await expect.element(screen.getByText("Error: formula not found")).toBeVisible();
    const tart = rowFor(screen.container, "tart");
    expect(tart?.getAttribute("data-sandbox-state")).not.toBe("available");
    expect(tart?.textContent).toContain("needs consent");
    await expect
      .element(screen.getByRole("status"))
      .toHaveTextContent("Install failed: brew install failed");
  });

  it("shows the probe detail for an unknown backend and offers no Install button", async () => {
    const backends = macBackends().map((row) =>
      row.id === "docker"
        ? {
            ...row,
            state: "unknown" as const,
            reason: "Docker did not answer its version check: spawn docker ENOENT",
          }
        : row,
    );
    setup({ status: status("darwin", backends) });
    await using screen = await renderUi(<CodeItLabSetupPage />);

    const docker = rowFor(screen.container, "docker");
    expect(docker?.getAttribute("data-sandbox-state")).toBe("unknown");
    expect(docker?.textContent).toContain("spawn docker ENOENT");
    expect(buttonLabels(docker!)).not.toContain("Install");
    expect(screen.getByText("unknown")).toBeDefined();
  });

  it("shows skeleton rows while the probe has not answered", async () => {
    setup({ loading: true });
    await using screen = await renderUi(<CodeItLabSetupPage />);
    const loading = screen.container.querySelector("[data-sandbox-loading]");
    expect(loading?.getAttribute("aria-busy")).toBe("true");
    expect(loading?.textContent).toContain("Loading sandbox backends");
    expect(screen.container.querySelector("[data-sandbox-backend]")).toBeNull();
    expect(screen.container.querySelector('[role="progressbar"]')).toBeNull();
  });

  it("says the probe failed and retries it", async () => {
    setup({ error: "environment disconnected" });
    await using screen = await renderUi(<CodeItLabSetupPage />);
    expect(screen.getByText(/the sandbox probe failed/i)).toBeDefined();
    expect(screen.getByText(/environment disconnected/)).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: /^retry probe$/i }));
    expect(mock.refreshes).toBe(1);
  });

  it("renders the server's ready sentence and every passing check", async () => {
    setup({ status: status("darwin", macBackends()), health: readyHealth() });
    await using screen = await renderUi(<CodeItLabSetupPage />);

    const card = screen.container.querySelector("[data-codeitlab-sandbox-health]");
    expect(card?.getAttribute("data-sandbox-health-state")).toBe("ready");
    expect(card?.textContent).toContain("Sandbox ready: Tart answered every check.");
    expect(card?.textContent).toContain("Tart answers its version check");
    expect(card?.textContent).toContain("Tart answers its VM list");
    expect(card?.textContent).not.toContain("failed:");
    expect(card?.querySelector('[data-sandbox-check-ok="false"]')).toBeNull();
    expect(card?.querySelector('[data-sandbox-health-backend="tart"]')).not.toBeNull();
  });

  it("renders the failing check detail and the server's not-ready sentence", async () => {
    setup({ status: status("darwin", macBackends()), health: failingHealth() });
    await using screen = await renderUi(<CodeItLabSetupPage />);

    const card = screen.container.querySelector("[data-codeitlab-sandbox-health]");
    expect(card?.getAttribute("data-sandbox-health-state")).toBe("not-ready");
    expect(card?.textContent).toContain("Sandbox not ready: Tart answered its version check");
    expect(card?.textContent).toContain("Error: no such VM");
    expect(card?.querySelector('[data-sandbox-check-ok="false"]')).not.toBeNull();
    expect(card?.textContent).toContain("check failed");
  });

  it("shows the health error and retries the health probe", async () => {
    setup({ healthError: "environment disconnected" });
    await using screen = await renderUi(<CodeItLabSetupPage />);

    const card = screen.container.querySelector("[data-codeitlab-sandbox-health]");
    expect(card?.getAttribute("data-sandbox-health-state")).toBe("error");
    expect(card?.textContent).toContain("The health check failed: environment disconnected");
    await userEvent.click(screen.getByRole("button", { name: /^retry$/i }));
    expect(mock.healthRefreshes).toBe(1);
  });

  it("shows a busy skeleton while the health probe has not answered", async () => {
    setup({});
    await using screen = await renderUi(<CodeItLabSetupPage />);

    const card = screen.container.querySelector("[data-codeitlab-sandbox-health]");
    expect(card?.getAttribute("data-sandbox-health-state")).toBe("loading");
    const loading = card?.querySelector("[data-sandbox-health-loading]");
    expect(loading?.getAttribute("aria-busy")).toBe("true");
    expect(loading?.textContent).toContain("Loading sandbox health");
  });

  it("creates a missing machine only after confirming the image download", async () => {
    setup({
      status: status("darwin", macBackends()),
      health: health([healthBackend("tart")], { machine: machine({ state: "missing" }) }),
      createResult: {
        ok: true,
        machine: machine({ state: "running" }),
        message: "Created codeitlab-sandbox.",
        outputTail: "",
      },
    });
    await using screen = await renderUi(<CodeItLabSetupPage />);

    const block = screen.container.querySelector("[data-codeitlab-sandbox-machine]");
    expect(block?.getAttribute("data-sandbox-machine-state")).toBe("missing");
    expect(block?.textContent).toContain("codeitlab-sandbox");
    expect(block?.textContent).toContain("ghcr.io/cirruslabs/macos-sonoma-base:latest");

    await userEvent.click(screen.getByRole("button", { name: /^create$/i }));
    await expect
      .element(screen.getByRole("group", { name: "Confirm creating the sandbox machine" }))
      .toBeVisible();
    const group = screen.container.querySelector(
      '[role="group"][aria-label="Confirm creating the sandbox machine"]',
    );
    expect(group?.textContent).toContain("This may download the image");
    expect(mock.creates).toEqual([]);

    await userEvent.keyboard("{Escape}");
    expect(
      screen.container.querySelector(
        '[role="group"][aria-label="Confirm creating the sandbox machine"]',
      ),
    ).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await userEvent.click(screen.getByRole("button", { name: /^confirm$/i }));
    await vi.waitFor(() => expect(mock.creates).toEqual([{ backend: "tart" }]));
    await vi.waitFor(() => expect(mock.healthRefreshes).toBe(1));
    await vi.waitFor(() => expect(block?.textContent).toContain("Created codeitlab-sandbox."));
  });

  it("removes a running machine and runs a typed command in it", async () => {
    setup({
      status: status("darwin", macBackends()),
      health: health([healthBackend("tart")], { machine: machine({ state: "running" }) }),
      removeResult: {
        ok: true,
        removed: true,
        message: "Removed codeitlab-sandbox.",
        outputTail: "",
      },
      runResult: {
        ok: true,
        exitCode: 0,
        stdout: "Darwin sandbox 25.0 arm64",
        stderr: "",
        durationMs: 42,
        message: "Ran uname -a.",
      },
    });
    await using screen = await renderUi(<CodeItLabSetupPage />);

    const block = screen.container.querySelector("[data-codeitlab-sandbox-machine]");
    expect(block?.getAttribute("data-sandbox-machine-state")).toBe("running");

    await userEvent.click(screen.getByRole("button", { name: /^remove$/i }));
    await expect
      .element(screen.getByRole("group", { name: "Confirm removing the sandbox machine" }))
      .toBeVisible();
    const group = screen.container.querySelector(
      '[role="group"][aria-label="Confirm removing the sandbox machine"]',
    );
    expect(group?.textContent).toContain("This deletes codeitlab-sandbox.");
    await userEvent.click(screen.getByRole("button", { name: /^confirm$/i }));
    await vi.waitFor(() => expect(mock.removes).toBe(1));
    await vi.waitFor(() => expect(mock.healthRefreshes).toBe(1));
    await vi.waitFor(() => expect(block?.textContent).toContain("Removed codeitlab-sandbox."));

    await expect
      .element(screen.getByRole("textbox", { name: "Command to run in the sandbox" }))
      .toBeVisible();
    const input = screen.container.querySelector<HTMLInputElement>("#sandbox-machine-command");
    expect(input?.value).toBe("uname -a");
    await userEvent.clear(input!);
    await userEvent.type(input!, "echo hi");
    await userEvent.click(screen.getByRole("button", { name: /^run$/i }));

    await vi.waitFor(() => expect(mock.runs).toEqual(["echo hi"]));
    await vi.waitFor(() => expect(block?.textContent).toContain("Exit 0"));
    expect(block?.textContent).toContain("42 ms");
    expect(block?.textContent).toContain("Darwin sandbox 25.0 arm64");
    expect(block?.textContent).toContain("Ran uname -a.");
  });

  it("shows the start command for a stopped machine and no run row", async () => {
    const detail = "tart run codeitlab-sandbox";
    setup({
      status: status("darwin", macBackends()),
      health: health([healthBackend("tart")], { machine: machine({ state: "stopped", detail }) }),
    });
    await using screen = await renderUi(<CodeItLabSetupPage />);

    const block = screen.container.querySelector("[data-codeitlab-sandbox-machine]");
    expect(block?.getAttribute("data-sandbox-machine-state")).toBe("stopped");
    expect(block?.textContent).toContain(detail);
    expect(block?.textContent).not.toContain("The app does not start machines by itself yet.");
    expect(block?.querySelector("input")).toBeNull();
    expect(buttonLabels(block!)).not.toContain("Run");
    expect(buttonLabels(block!)).toContain("Start");
    expect(buttonLabels(block!)).toContain("Remove");
  });

  it("starts a stopped machine and shows the server message", async () => {
    setup({
      status: status("darwin", macBackends()),
      health: health([healthBackend("tart")], {
        machine: machine({ state: "stopped", detail: "tart run codeitlab-sandbox" }),
      }),
      startResult: {
        ok: true,
        machine: machine({ state: "running" }),
        message: "Started codeitlab-sandbox.",
        outputTail: "",
      },
      nextHealth: Result.succeed(
        health([healthBackend("tart")], { machine: machine({ state: "running" }) }),
      ),
    });
    await using screen = await renderUi(<CodeItLabSetupPage />);

    const block = screen.container.querySelector("[data-codeitlab-sandbox-machine]");
    await userEvent.click(screen.getByRole("button", { name: /^start$/i }));

    await vi.waitFor(() => expect(mock.starts).toEqual([{ backend: "tart" }]));
    await vi.waitFor(() => expect(mock.healthRefreshes).toBe(1));
    await vi.waitFor(() => expect(block?.textContent).toContain("Started codeitlab-sandbox."));
    await vi.waitFor(() =>
      expect(block?.getAttribute("data-sandbox-machine-state")).toBe("running"),
    );
    expect(block?.querySelector("#sandbox-machine-command")).not.toBeNull();
    expect(buttonLabels(block!)).toContain("Stop");
    expect(buttonLabels(block!)).not.toContain("Start");
  });

  it("stops a running machine, shows the message, and hides the run row", async () => {
    setup({
      status: status("darwin", macBackends()),
      health: health([healthBackend("tart")], { machine: machine({ state: "running" }) }),
      stopResult: {
        ok: true,
        stopped: true,
        message: "Stopped codeitlab-sandbox.",
        outputTail: "",
      },
      nextHealth: Result.succeed(
        health([healthBackend("tart")], {
          machine: machine({ state: "stopped", detail: "tart run codeitlab-sandbox" }),
        }),
      ),
    });
    await using screen = await renderUi(<CodeItLabSetupPage />);

    const block = screen.container.querySelector("[data-codeitlab-sandbox-machine]");
    expect(block?.querySelector("#sandbox-machine-command")).not.toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /^stop$/i }));

    await vi.waitFor(() => expect(mock.stops).toBe(1));
    await vi.waitFor(() => expect(mock.healthRefreshes).toBe(1));
    await vi.waitFor(() => expect(block?.textContent).toContain("Stopped codeitlab-sandbox."));
    await vi.waitFor(() =>
      expect(block?.getAttribute("data-sandbox-machine-state")).toBe("stopped"),
    );
    expect(block?.querySelector("#sandbox-machine-command")).toBeNull();
    expect(buttonLabels(block!)).not.toContain("Run");
    expect(buttonLabels(block!)).toContain("Start");
  });

  it("shows Create but neither Start nor Stop for a missing machine", async () => {
    setup({
      status: status("darwin", macBackends()),
      health: health([healthBackend("tart")], { machine: machine({ state: "missing" }) }),
    });
    await using screen = await renderUi(<CodeItLabSetupPage />);

    const block = screen.container.querySelector("[data-codeitlab-sandbox-machine]");
    const labels = buttonLabels(block!);
    expect(labels).toContain("Create");
    expect(labels).not.toContain("Start");
    expect(labels).not.toContain("Stop");
  });

  it("says no backend can own a machine and offers no machine buttons", async () => {
    setup({
      status: status("darwin", macBackends()),
      health: health([healthBackend("tart")], { machine: null }),
    });
    await using screen = await renderUi(<CodeItLabSetupPage />);

    const block = screen.container.querySelector("[data-codeitlab-sandbox-machine]");
    expect(block?.getAttribute("data-sandbox-machine-state")).toBe("none");
    expect(block?.textContent).toContain("No backend can own a machine here.");
    expect(block?.querySelectorAll("button")).toHaveLength(0);
  });
});
