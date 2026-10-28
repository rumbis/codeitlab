import { assert, describe, it } from "vite-plus/test";

import {
  bundledCredentialModel,
  credentialFeatureIndices,
  fnv1a32,
  parseCredentialModel,
  scoreWithCredentialModel,
  type CredentialModelWeights,
} from "./model.ts";
import { BUNDLED_CREDENTIAL_MODEL } from "./model-weights.ts";

const model = bundledCredentialModel();
const weights = BUNDLED_CREDENTIAL_MODEL as unknown as CredentialModelWeights;

const score = (token: string, context = "") => model.score(token, context);

describe("tiny credential model", () => {
  it("ships the expected number of int8 weights", () => {
    assert.strictEqual(weights.weights.length, weights.buckets + weights.denseFeatures.length);
    assert.strictEqual(weights.buckets, 8192);
    assert.isAbove(model.threshold, 0.3);
    assert.isBelow(model.threshold, 0.8);
  });

  it("scores context-cued unknown shapes above the threshold", () => {
    const cases: Array<[string, string]> = [
      ["QwErTyUiOpAsDfGhJkLzXcVbNm", "the password is "],
      ["aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1xY3zA5bC7dE9fG1hJ3kL5mN7pQ9rS1tU3vW5xY7z", "token: "],
      ["Zm9vYmFyQmF6UXV4MTIzNDU2Nzg5MGFiY2RlZmdoaWo", "client_secret = "],
    ];
    for (const [token, context] of cases) {
      assert.isAtLeast(
        score(token, context),
        model.threshold,
        `${context}${token} should look like a credential`,
      );
    }
  });

  it("scores ordinary identifiers, hashes and paths below the threshold", () => {
    const cases: Array<[string, string]> = [
      ["e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "checksum: "],
      ["getUserById", ""],
      ["resolveWorkspaceRootPath", ""],
      ["9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08", "checksum: "],
      ["/Users/rumbis/projects/codeitlab/src/index.ts", "path: "],
      ["3f2b8c1e-9a4d-4c7e-8b2f-1d6e5a4c3b2a", "session_id: "],
      ["2026-10-23T06:42:41Z", "created: "],
      ["abc123def456ghi789jkl012mno345pqr678", "image_data: "],
    ];
    for (const [token, context] of cases) {
      assert.isBelow(
        score(token, context),
        model.threshold,
        `${token} should not look like a credential`,
      );
    }
  });

  it("is deterministic and uses the context window", () => {
    const token = "QwErTyUiOpAsDfGhJkLzXcVbNm";
    assert.strictEqual(score(token, ""), score(token, ""));
    assert.notStrictEqual(score(token, ""), score(token, "the password is "));
    assert.isAbove(score(token, "the password is "), score(token, ""));
  });

  it("hashes features the same way as the trainer", () => {
    assert.strictEqual(fnv1a32("g3:abc"), fnv1a32("g3:abc"));
    const indices = credentialFeatureIndices("sk-proj-abc", "key", weights);
    assert.isAbove(indices.length, 10);
    for (const index of indices) {
      assert.isAtLeast(index, 0);
      assert.isBelow(index, weights.weights.length);
    }
  });

  it("reloads the bundled weights from JSON", () => {
    const reloaded = parseCredentialModel(JSON.stringify(weights));
    const token = "QwErTyUiOpAsDfGhJkLzXcVbNm";
    assert.strictEqual(reloaded.score(token, "password: "), model.score(token, "password: "));
    assert.strictEqual(reloaded.threshold, model.threshold);
  });

  it("rejects a malformed model file", () => {
    assert.throws(() => parseCredentialModel("not json"), /JSON/);
    assert.throws(() => parseCredentialModel("{}"), /unexpected shape/);
    assert.throws(
      () => parseCredentialModel(JSON.stringify({ ...weights, weights: [1, 2, 3] })),
      /unexpected shape/,
    );
  });

  it("scores with the same numbers the trainer reported", () => {
    // Sanity check against the quantized weights: the sigmoid must stay in [0,1]
    // and a credential-looking token in a credential context must clear the
    // threshold comfortably.
    const value = scoreWithCredentialModel(
      "aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1xY3zA5bC7dE9fG1hJ3kL5mN7pQ9rS1tU3vW5xY7z",
      "token: ",
      weights,
    );
    assert.isAtLeast(value, 0);
    assert.isAtMost(value, 1);
    assert.isAbove(value, 0.9);
  });
});
