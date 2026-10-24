import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  CodeitlabContextSettings,
  formatContextTokens,
  resolveContextSize,
  type CodeitlabContextSize,
} from "./context.ts";

const decode = Schema.decodeSync(CodeitlabContextSettings);

const size = (patch: Partial<CodeitlabContextSize>): CodeitlabContextSize => ({
  instanceId: "",
  model: "claude-sonnet-4",
  tokens: 200_000,
  ...patch,
});

describe("context sizes", () => {
  it("decodes an empty block", () => {
    expect(decode({}).sizes).toEqual([]);
  });

  it("prefers an instance-scoped recorded value over a generic one", () => {
    const sizes = [
      size({ model: "custom-model", instanceId: "", tokens: 100_000 }),
      size({ model: "custom-model", instanceId: "work", tokens: 250_000 }),
    ];
    expect(resolveContextSize(sizes, "work", "custom-model")).toEqual({
      tokens: 250_000,
      source: "recorded",
    });
    expect(resolveContextSize(sizes, "personal", "custom-model")).toEqual({
      tokens: 100_000,
      source: "recorded",
    });
  });

  it("falls back to a labelled family estimate only when nothing is recorded", () => {
    expect(resolveContextSize([], "work", "claude-sonnet-4-5")).toEqual({
      tokens: 200_000,
      source: "estimate",
    });
    expect(resolveContextSize([], "work", "totally-unknown-model")).toBeNull();
    expect(resolveContextSize([], "work", " ")).toBeNull();
  });

  it("ignores zero-token rows so a cleared input cannot fake a limit", () => {
    expect(resolveContextSize([size({ tokens: 0 })], "work", "claude-sonnet-4")).toEqual({
      tokens: 200_000,
      source: "estimate",
    });
  });

  it("formats sizes for humans", () => {
    expect(formatContextTokens(200_000)).toBe("200k");
    expect(formatContextTokens(1_000_000)).toBe("1M");
    expect(formatContextTokens(0)).toBe("unknown");
  });
});
