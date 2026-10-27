import type { EffectivePolicy } from "@codeitlab/core/policy";
import type { CodeItLabPolicySettings } from "@codeitlab/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import "~/index.css";

import { render as renderUi } from "../../../test/render";
import { CodeItLabUncensoredPage } from "./CodeItLabUncensoredPage";

const mock = vi.hoisted(() => ({
  settings: null as unknown,
  policy: null as unknown,
  providers: [] as ReadonlyArray<unknown>,
}));

vi.mock(import("../../codeitlab/api"), async (original) => ({
  ...(await original()),
  useCodeItLabPolicy: (() => mock.policy) as never,
  useCodeItLabNexus: (() => ({
    data: { providers: mock.providers },
    source: "server",
    error: null,
    isPending: false,
    refresh: () => {},
  })) as never,
}));

vi.mock(import("../../codeitlab/effectsSettings"), async (original) => ({
  ...(await original()),
  useCodeItLabSettingsWriter: (() => ({
    codeitlab: { policy: mock.settings },
    environmentId: "env-1",
    update: (patch: Record<string, unknown>) => patch,
  })) as never,
}));

const settings = (patch: Partial<CodeItLabPolicySettings> = {}): CodeItLabPolicySettings => ({
  uncensored: false,
  applyToProviders: [],
  auditTrail: true,
  ...patch,
});

const effective = (patch: Partial<EffectivePolicy> = {}): EffectivePolicy => ({
  profile: "standard",
  appliedTo: [],
  unsupported: [],
  instructionBlock: "",
  limitations: ["It cannot lift an upstream provider's policy."],
  ...patch,
});

const view = (data: EffectivePolicy, isPending = false) => ({
  data,
  source: "server" as const,
  error: null,
  isPending,
  refresh: () => {},
  setProfile: async () => null,
});

const provider = (instanceId: string, name: string) => ({
  instanceId,
  name,
  driverKind: "acp",
  available: true,
  transport: "local",
  skills: 0,
  sessions: 0,
  mcpServers: 0,
});

const toggle = (screen: { container: HTMLElement }, label: string) =>
  screen.container.querySelector<HTMLElement>(`[aria-label="${label}"]`);

describe("uncensored page", () => {
  it("says the audit trail has nothing to record under the standard profile", async () => {
    mock.settings = settings({ uncensored: false });
    mock.policy = view(effective());
    mock.providers = [provider("claude", "Claude")];
    await using screen = await renderUi(<CodeItLabUncensoredPage />);
    const audit = toggle(screen, "Record policy audit trail");
    expect(audit?.getAttribute("aria-disabled")).toBe("true");
    expect(audit?.getAttribute("aria-describedby")).toBe("policy-audit-state");
    expect(screen.container.querySelector("#policy-audit-state")?.textContent).toContain(
      "Nothing to record while the profile is standard",
    );
  });

  it("keeps provider switches waiting while the profile is standard", async () => {
    mock.settings = settings({ uncensored: false });
    mock.policy = view(effective());
    mock.providers = [provider("claude", "Claude")];
    await using screen = await renderUi(<CodeItLabUncensoredPage />);
    const providerToggle = toggle(screen, "Apply permissive profile to Claude");
    expect(providerToggle?.getAttribute("aria-disabled")).toBe("true");
    expect(providerToggle?.getAttribute("aria-describedby")).toBe("policy-providers-state");
    expect(screen.container.querySelector("#policy-providers-state")?.textContent).toContain(
      "enable the permissive profile first",
    );
  });

  it("turns off the switch of a provider that cannot take the profile", async () => {
    mock.settings = settings({ uncensored: true });
    mock.policy = view(
      effective({
        profile: "permissive",
        unsupported: [{ providerInstanceId: "codex", reason: "No instruction hook" }],
      }),
    );
    mock.providers = [provider("codex", "Codex")];
    await using screen = await renderUi(<CodeItLabUncensoredPage />);
    const providerToggle = toggle(screen, "Apply permissive profile to Codex");
    expect(providerToggle?.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText("unsupported")).not.toBeNull();
  });

  it("says what the effective policy read is based on", async () => {
    mock.settings = settings({ uncensored: true });
    mock.policy = view(effective({ profile: "permissive" }));
    mock.providers = [];
    await using screen = await renderUi(<CodeItLabUncensoredPage />);
    const state = screen.container.querySelector("#policy-refresh-state");
    expect(state?.textContent).toContain("Effective policy comes from the last read");
    const apply = toggle(screen, "Enable permissive profile");
    expect(apply?.getAttribute("aria-describedby")).toBe("policy-apply-state");
    expect(screen.container.querySelector("#policy-apply-state")?.textContent).toContain(
      "The profile is permissive.",
    );
  });
});
