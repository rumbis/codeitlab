import { AUTO_ROUTE_SELECTION, createAutoRouteSelection } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import { describe } from "vite-plus/test";

import {
  AUTO_ROUTER_LABEL,
  AUTO_ROUTER_SUBLABEL,
  autoRouterLabel,
  isAutoRouteActiveSelection,
} from "./autoRouterLabel.ts";

const concrete = { instanceId: "codex", model: "gpt-5" };

describe("auto router labels", () => {
  it("labels the routing sentinel", () => {
    assert.strictEqual(AUTO_ROUTER_LABEL, "Auto router");
    assert.strictEqual(AUTO_ROUTER_SUBLABEL, "Best model per task · all enabled apps");
    assert.strictEqual(autoRouterLabel(AUTO_ROUTE_SELECTION), "Auto router");
    assert.strictEqual(autoRouterLabel(createAutoRouteSelection()), "Auto router");
  });

  it("keeps concrete selections and missing selections unlabeled", () => {
    assert.isNull(autoRouterLabel(concrete));
    assert.isNull(autoRouterLabel(null));
    assert.isNull(autoRouterLabel(undefined));
  });

  it("only treats the exact sentinel pair as auto routing", () => {
    assert.isNull(autoRouterLabel({ instanceId: "codeitlab_auto", model: "gpt-5" }));
    assert.isNull(autoRouterLabel({ instanceId: "codex", model: "auto" }));
  });
});

describe("isAutoRouteActiveSelection", () => {
  it("follows a draft sentinel", () => {
    assert.isTrue(
      isAutoRouteActiveSelection({
        draftSelection: createAutoRouteSelection(),
        threadSelection: concrete,
      }),
    );
  });

  it("follows the thread when the draft has no selection", () => {
    assert.isTrue(
      isAutoRouteActiveSelection({
        draftSelection: null,
        threadSelection: createAutoRouteSelection(),
      }),
    );
    assert.isTrue(
      isAutoRouteActiveSelection({
        draftSelection: undefined,
        threadSelection: createAutoRouteSelection(),
      }),
    );
  });

  it("lets a concrete draft selection replace a sentinel thread selection", () => {
    assert.isFalse(
      isAutoRouteActiveSelection({
        draftSelection: concrete,
        threadSelection: createAutoRouteSelection(),
      }),
    );
  });

  it("is false for concrete selections", () => {
    assert.isFalse(
      isAutoRouteActiveSelection({ draftSelection: concrete, threadSelection: concrete }),
    );
    assert.isFalse(
      isAutoRouteActiveSelection({ draftSelection: null, threadSelection: undefined }),
    );
  });
});
