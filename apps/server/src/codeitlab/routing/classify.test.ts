import { assert, it } from "@effect/vitest";
import { describe } from "vite-plus/test";

import { classifyTask } from "./classify.ts";

const classify = (prompt: string, attachments?: ReadonlyArray<string>) =>
  classifyTask({
    prompt,
    ...(attachments === undefined ? {} : { attachments }),
  });

describe("task classification (English)", () => {
  it("recognises coding, reasoning, fast, cheap and vision prompts", () => {
    assert.strictEqual(
      classify("implement a typescript endpoint and add unit tests").taskClass,
      "coding",
    );
    assert.strictEqual(
      classify("why is this build slow? analyse the trade-offs").taskClass,
      "reasoning",
    );
    assert.strictEqual(classify("tldr: what is a mutex").taskClass, "fast");
    assert.strictEqual(classify("cheapest model for this summary").taskClass, "cheap");
    assert.strictEqual(
      classify("look at this screenshot and describe the layout").taskClass,
      "vision",
    );
  });

  it("treats image attachments as vision and honours a forced class", () => {
    assert.strictEqual(classify("fix this", ["/tmp/shot.PNG"]).taskClass, "vision");
    assert.deepEqual(classifyTask({ prompt: "whatever", taskClass: "reasoning" }), {
      taskClass: "reasoning",
      confidence: 1,
      signals: ["forced"],
    });
  });
});

describe("task classification (Greek / Greeklish)", () => {
  it("recognises Greek coding requests instead of treating them as short chat", () => {
    const result = classify(
      "γράψε μου μια συνάρτηση που να διαβάζει ένα αρχείο και να το επιστρέφει",
    );
    assert.strictEqual(result.taskClass, "coding");
    assert.ok(result.signals.includes("coding-el"));
  });

  it("recognises Greeklish coding requests", () => {
    assert.strictEqual(classify("graps mou ena endpoint gia login me tests").taskClass, "coding");
  });

  it("recognises Greek reasoning and fast prompts", () => {
    assert.strictEqual(
      classify("γιατί αργεί το build και ανάλυσε τα trade-offs της αρχιτεκτονικής").taskClass,
      "reasoning",
    );
    assert.strictEqual(classify("tldr: τι είναι το mutex;").taskClass, "fast");
    assert.strictEqual(classify("σύντομα, μόνο πες μου ποιος είναι ο CEO").taskClass, "fast");
  });

  it("recognises Greek vision and cheap prompts", () => {
    assert.strictEqual(classify("δες αυτή την εικόνα και πες μου τι δείχνει").taskClass, "vision");
    assert.strictEqual(classify("θέλω το πιο φθηνό μοντέλο για αυτό").taskClass, "cheap");
  });

  it("keeps Greek prose without tech signals out of the coding class", () => {
    const result = classify(
      "Θέλω να μου γράψεις μια ιστορία για έναν ταξιδιώτη που ψάχνει το σπίτι του",
    );
    assert.notStrictEqual(result.taskClass, "coding");
  });
});
