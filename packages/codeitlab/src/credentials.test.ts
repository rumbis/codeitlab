import * as Schema from "effect/Schema";
import { assert, describe, it } from "vite-plus/test";

import { CodeItLabCredentialsSettings, CREDENTIALS_PROXY_DEFAULT_PORT } from "./credentials.ts";

const decode = Schema.decodeUnknownSync(CodeItLabCredentialsSettings);

describe("CodeItLab credentials settings defaults", () => {
  it("is a privacy firewall, not an opt-in: masking is on for an empty block", () => {
    const settings = decode({});
    assert.strictEqual(settings.enabled, true);
    assert.strictEqual(settings.maskPersonalData, true);
    assert.strictEqual(settings.restoreResponses, true);
    assert.strictEqual(settings.mode, "balanced");
    assert.strictEqual(settings.privateTag, "mask");
    assert.strictEqual(settings.gatewayPort, CREDENTIALS_PROXY_DEFAULT_PORT);
    assert.strictEqual(settings.blockOnModelFlag, false);
  });

  it("keeps every explicit choice, including turning the firewall off", () => {
    const settings = decode({
      enabled: false,
      maskPersonalData: false,
      mode: "secrets",
      privateTag: "block",
      gatewayPort: 6001,
      restoreResponses: false,
      blockOnModelFlag: true,
    });
    assert.strictEqual(settings.enabled, false);
    assert.strictEqual(settings.maskPersonalData, false);
    assert.strictEqual(settings.mode, "secrets");
    assert.strictEqual(settings.privateTag, "block");
    assert.strictEqual(settings.gatewayPort, 6001);
    assert.strictEqual(settings.restoreResponses, false);
    assert.strictEqual(settings.blockOnModelFlag, true);
  });

  it("fills a partial block from the defaults and ignores unknown keys", () => {
    const settings = decode({ enabled: true, futureKnob: "ignored" });
    assert.strictEqual(settings.maskPersonalData, true);
    assert.strictEqual(settings.mode, "balanced");
    assert.strictEqual("futureKnob" in settings, false);
  });
});
