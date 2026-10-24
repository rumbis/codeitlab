import * as NodeServices from "@effect/platform-node/NodeServices";
import { CodeitlabContextService, type CodeitlabTurnContext } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ServerConfig } from "../config.ts";

import {
  driverSupportsAppContext,
  registerCodeitlabContextService,
  resetCodeitlabContextService,
  resolveCodeitlabInstructions,
} from "./turnInjection.ts";

const context = (instructions: string): CodeitlabTurnContext => ({
  instructions,
  policy: {
    profile: "standard",
    appliedTo: [],
    unsupported: [],
    instructionBlock: "",
    limitations: [],
  },
});

const baseLayer = Layer.mergeAll(
  NodeServices.layer,
  ServerConfig.layerTest(process.cwd(), { prefix: "turn-injection-test-" }).pipe(
    Layer.provide(NodeServices.layer),
  ),
);

it.effect("returns the registered instruction block", () =>
  Effect.gen(function* () {
    resetCodeitlabContextService();
    registerCodeitlabContextService(
      CodeitlabContextService.of({
        buildTurnContext: () => Effect.succeed(context("## Recalled memory\n- use pnpm")),
      }),
    );
    const block = yield* resolveCodeitlabInstructions({ prompt: "hello" }).pipe(
      Effect.provide(baseLayer),
    );
    assert.strictEqual(block, "## Recalled memory\n- use pnpm");
    resetCodeitlabContextService();
  }),
);

it.effect("returns null when nothing is registered", () =>
  Effect.gen(function* () {
    resetCodeitlabContextService();
    assert.isNull(
      yield* resolveCodeitlabInstructions({ prompt: "hello" }).pipe(Effect.provide(baseLayer)),
    );
  }),
);

it.effect("returns null for an empty block", () =>
  Effect.gen(function* () {
    resetCodeitlabContextService();
    registerCodeitlabContextService(
      CodeitlabContextService.of({
        buildTurnContext: () => Effect.succeed(context("   ")),
      }),
    );
    assert.isNull(
      yield* resolveCodeitlabInstructions({ prompt: "hello" }).pipe(Effect.provide(baseLayer)),
    );
    resetCodeitlabContextService();
  }),
);

it.effect("never fails the turn when the context service fails", () =>
  Effect.gen(function* () {
    resetCodeitlabContextService();
    registerCodeitlabContextService(
      CodeitlabContextService.of({
        buildTurnContext: () => Effect.die(new Error("memory store exploded")),
      }),
    );
    assert.isNull(
      yield* resolveCodeitlabInstructions({ prompt: "hello" }).pipe(Effect.provide(baseLayer)),
    );
    resetCodeitlabContextService();
  }),
);

it.effect("falls back to an explicitly provided context service", () =>
  Effect.gen(function* () {
    resetCodeitlabContextService();
    const block = yield* resolveCodeitlabInstructions({ prompt: "hello" }).pipe(
      Effect.provide(
        Layer.merge(
          baseLayer,
          Layer.succeed(
            CodeitlabContextService,
            CodeitlabContextService.of({
              buildTurnContext: () => Effect.succeed(context("from layer")),
            }),
          ),
        ),
      ),
    );
    assert.strictEqual(block, "from layer");
  }),
);

it("sends app context only to Codex", () => {
  assert.isTrue(driverSupportsAppContext("codex"));
  assert.isFalse(driverSupportsAppContext("claude"));
  assert.isFalse(driverSupportsAppContext("hermes"));
});
