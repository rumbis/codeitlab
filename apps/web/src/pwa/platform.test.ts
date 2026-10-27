import { describe, expect, it } from "vite-plus/test";

import { isIosSafari, isStandaloneMode } from "./platform";

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPADOS_SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const IPHONE_CHROME =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1";
const MAC_SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";

describe("isStandaloneMode", () => {
  it("treats either the display mode or navigator.standalone as installed", () => {
    expect(isStandaloneMode({ displayModeStandalone: true, navigatorStandalone: false })).toBe(
      true,
    );
    expect(isStandaloneMode({ displayModeStandalone: false, navigatorStandalone: true })).toBe(
      true,
    );
    expect(isStandaloneMode({ displayModeStandalone: false, navigatorStandalone: false })).toBe(
      false,
    );
  });
});

describe("isIosSafari", () => {
  it("detects iPhone Safari", () => {
    expect(isIosSafari(IPHONE_SAFARI, 5)).toBe(true);
  });

  it("detects iPadOS Safari, which reports a desktop user agent", () => {
    expect(isIosSafari(IPADOS_SAFARI, 5)).toBe(true);
  });

  it("does not treat a Mac without a touch screen as iOS", () => {
    expect(isIosSafari(MAC_SAFARI, 0)).toBe(false);
  });

  it("excludes alternative iOS browsers that cannot add to the home screen", () => {
    expect(isIosSafari(IPHONE_CHROME, 5)).toBe(false);
  });

  it("ignores Android browsers", () => {
    expect(isIosSafari(ANDROID_CHROME, 5)).toBe(false);
  });
});
