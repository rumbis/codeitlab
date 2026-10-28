import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import { Schema } from "effect";

import { fromRunner, type Request, type Runner } from "./textGenerationOperations.ts";

const modelSelection = { instanceId: "claude-main", model: "claude-sonnet" } as never;

const run =
  (reply: unknown, seen: Array<Request<Schema.Top>>): Runner =>
  (request) => {
    seen.push(request);
    return Effect.succeed(reply) as never;
  };

describe("fromRunner generateDeliveryHandoff", () => {
  it("sends the delivery facts to the model and keeps the structured reply", () =>
    Effect.gen(function* () {
      const seen: Array<Request<Schema.Top>> = [];
      const generation = fromRunner(
        "TestGeneration",
        run({ summary: "Landing page ready", body: "## What was built\nA page." }, seen),
      );

      const result = yield* generation.generateDeliveryHandoff({
        cwd: "/tmp/project",
        engagementTitle: "Landing page",
        deliveryNote: "Changed 3 files on feature/landing",
        amountLabel: "€1,200",
        modelSelection,
      });

      expect(result).toEqual({ summary: "Landing page ready", body: "## What was built\nA page." });
      expect(seen[0]?.operation).toBe("generateDeliveryHandoff");
      expect(seen[0]?.prompt).toContain("Changed 3 files on feature/landing");
      expect(seen[0]?.prompt).toContain("€1,200");
    }).pipe(Effect.runPromise));

  it("makes the summary one short line even when the model rambles", () =>
    Effect.gen(function* () {
      const generation = fromRunner(
        "TestGeneration",
        run({ summary: "## " + "a".repeat(300), body: "body" }, []),
      );

      const result = yield* generation.generateDeliveryHandoff({
        cwd: "/tmp/project",
        engagementTitle: "Landing page",
        deliveryNote: "note",
        modelSelection,
      });

      expect(result.summary.length).toBeLessThanOrEqual(160);
      expect(result.summary.startsWith("#")).toBe(false);
      expect(result.summary.endsWith("…")).toBe(true);
    }).pipe(Effect.runPromise));
});
