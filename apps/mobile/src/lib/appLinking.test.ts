import { describe, expect, it } from "vite-plus/test";

import { shouldHandleAppLink } from "./appLinking";

describe("shouldHandleAppLink", () => {
  it.each(["codeitlab://", "codeitlab:///", "codeitlab-dev://", "codeitlab-preview://"])(
    "ignores scheme-only URL %s",
    (url) => {
      expect(shouldHandleAppLink(url)).toBe(false);
    },
  );

  it.each([
    "codeitlab://threads/env-1/thread-1",
    "codeitlab://pair?pairingUrl=x",
    "codeitlab-dev://settings/usage?tab=limits",
  ])("handles path-bearing URL %s", (url) => {
    expect(shouldHandleAppLink(url)).toBe(true);
  });

  it.each(["codeitlab://expo-development-client/?url=x", "codeitlab://expo-sharing/anything"])(
    "ignores lifecycle URL %s",
    (url) => {
      expect(shouldHandleAppLink(url)).toBe(false);
    },
  );
});
