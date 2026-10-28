import type { CodeItLabRemoteStatus } from "@codeitlab/core/remote";
import { describe, expect, it, vi } from "vite-plus/test";

import "~/index.css";

import { render as renderUi } from "../../../test/render";
import { CodeItLabRemotePage } from "./CodeItLabRemotePage";

const mock = vi.hoisted(() => ({
  status: null as unknown,
  isPending: false,
  refreshes: 0,
}));

vi.mock(import("../../codeitlab/api"), async (original) => ({
  ...(await original()),
  useCodeItLabRemote: (() => ({
    data: mock.status,
    source: "server",
    error: null,
    isPending: mock.isPending,
    refresh: () => {
      mock.refreshes += 1;
    },
    createPairingLink: async () => null,
    manageTunnel: async () => null,
  })) as never,
}));

vi.mock(import("../../codeitlab/audio"), async (original) => ({
  ...(await original()),
  playCodeItLabSfx: (() => {}) as never,
  unlockCodeItLabAudio: (() => {}) as never,
}));

const remote = (patch: Partial<CodeItLabRemoteStatus> = {}): CodeItLabRemoteStatus => ({
  tailnet: { available: false, running: false },
  server: { host: "127.0.0.1", port: 4319, loopbackOnly: true, urls: [] },
  tunnel: { available: true, running: false },
  pairingAvailable: true,
  ...patch,
});

describe("remote page", () => {
  it("says what the status read is based on", async () => {
    mock.status = remote();
    mock.isPending = false;
    mock.refreshes = 0;
    await using screen = await renderUi(<CodeItLabRemotePage />);
    const state = screen.container.querySelector("#remote-status-state");
    expect(state?.textContent).toContain("Status comes from the last read");
    const refresh = screen.container.querySelector<HTMLButtonElement>("[data-remote-retry]");
    expect(refresh?.disabled).toBe(false);
    expect(refresh?.getAttribute("aria-describedby")).toBe("remote-status-state");
  });

  it("disables Refresh status while a read is in flight", async () => {
    mock.status = remote();
    mock.isPending = true;
    await using screen = await renderUi(<CodeItLabRemotePage />);
    const refresh = screen.container.querySelector<HTMLButtonElement>("[data-remote-retry]");
    expect(refresh?.disabled).toBe(true);
    expect(screen.container.querySelector("#remote-status-state")?.textContent).toContain(
      "Reading remote status",
    );
  });

  it("names the live tunnel action on every tunnel button", async () => {
    mock.status = remote({ tunnel: { available: true, running: false } });
    mock.isPending = false;
    await using screen = await renderUi(<CodeItLabRemotePage />);
    const start = screen.container.querySelector<HTMLButtonElement>("[data-remote-tunnel-start]");
    const stop = screen.container.querySelector<HTMLButtonElement>("[data-remote-tunnel-stop]");
    expect(start?.disabled).toBe(false);
    expect(stop?.disabled).toBe(true);
    for (const button of [start, stop]) {
      expect(button?.getAttribute("aria-describedby")).toBe("remote-tunnel-state");
    }
    expect(screen.container.querySelector("#remote-tunnel-state")?.textContent).toContain(
      "The tunnel is stopped",
    );
  });

  it("says a running tunnel can be stopped or refreshed", async () => {
    mock.status = remote({
      tunnel: { available: true, running: true, url: "https://example.trycloudflare.com/" },
    });
    mock.isPending = false;
    await using screen = await renderUi(<CodeItLabRemotePage />);
    const start = screen.container.querySelector<HTMLButtonElement>("[data-remote-tunnel-start]");
    expect(start?.disabled).toBe(true);
    expect(screen.container.querySelector("#remote-tunnel-state")?.textContent).toContain(
      "The tunnel is running",
    );
  });

  it("describes the pairing action and what happens to links", async () => {
    mock.status = remote();
    mock.isPending = false;
    await using screen = await renderUi(<CodeItLabRemotePage />);
    const create = screen.container.querySelector<HTMLButtonElement>("[data-remote-create-link]");
    expect(create?.getAttribute("aria-describedby")).toBe("remote-pairing-state");
    expect(screen.container.querySelector("#remote-pairing-state")?.textContent).toContain(
      "No link has been minted yet",
    );
  });
});
