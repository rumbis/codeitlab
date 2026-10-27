import * as NodeServices from "@effect/platform-node/NodeServices";
import { CodeItLabContextService, type CodeItLabTurnContext } from "@codeitlab/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ServerConfig } from "../config.ts";

import {
  driverSupportsAppContext,
  registerCodeItLabContextService,
  resetCodeItLabContextService,
  resolveCodeItLabInstructions,
} from "./turnInjection.ts";

const context = (instructions: string): CodeItLabTurnContext => ({
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
    resetCodeItLabContextService();
    registerCodeItLabContextService(
      CodeItLabContextService.of({
        buildTurnContext: () => Effect.succeed(context("## Recalled memory\n- use pnpm")),
      }),
    );
    const block = yield* resolveCodeItLabInstructions({ prompt: "hello" }).pipe(
      Effect.provide(baseLayer),
    );
    assert.strictEqual(block, "## Recalled memory\n- use pnpm");
    resetCodeItLabContextService();
  }),
);

it.effect("returns null when nothing is registered", () =>
  Effect.gen(function* () {
    resetCodeItLabContextService();
    assert.isNull(
      yield* resolveCodeItLabInstructions({ prompt: "hello" }).pipe(Effect.provide(baseLayer)),
    );
  }),
);

it.effect("returns null for an empty block", () =>
  Effect.gen(function* () {
    resetCodeItLabContextService();
    registerCodeItLabContextService(
      CodeItLabContextService.of({
        buildTurnContext: () => Effect.succeed(context("   ")),
      }),
    );
    assert.isNull(
      yield* resolveCodeItLabInstructions({ prompt: "hello" }).pipe(Effect.provide(baseLayer)),
    );
    resetCodeItLabContextService();
  }),
);

it.effect("never fails the turn when the context service fails", () =>
  Effect.gen(function* () {
    resetCodeItLabContextService();
    registerCodeItLabContextService(
      CodeItLabContextService.of({
        buildTurnContext: () => Effect.die(new Error("memory store exploded")),
      }),
    );
    assert.isNull(
      yield* resolveCodeItLabInstructions({ prompt: "hello" }).pipe(Effect.provide(baseLayer)),
    );
    resetCodeItLabContextService();
  }),
);

it.effect("falls back to an explicitly provided context service", () =>
  Effect.gen(function* () {
    resetCodeItLabContextService();
    const block = yield* resolveCodeItLabInstructions({ prompt: "hello" }).pipe(
      Effect.provide(
        Layer.merge(
          baseLayer,
          Layer.succeed(
            CodeItLabContextService,
            CodeItLabContextService.of({
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
