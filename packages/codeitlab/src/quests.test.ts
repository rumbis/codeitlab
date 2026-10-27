import * as Schema from "effect/Schema";
import { assert, describe, it } from "vite-plus/test";

import {
  buildCodeItLabQuestBoard,
  CodeItLabQuestFacts,
  type CodeItLabQuestFacts as QuestFacts,
} from "./quests.ts";

const decodeQuestFacts = Schema.decodeUnknownSync(CodeItLabQuestFacts);

const facts = (overrides: Partial<QuestFacts> = {}): QuestFacts => ({
  agentsInstalled: 0,
  modelsConfigured: 0,
  memoryEntries: 0,
  reaInstalled: false,
  studioProjects: 0,
  studioVideos: 0,
  integrationsConfigured: 0,
  remoteReachable: false,
  credentialsActive: false,
  boardTasks: 0,
  boardCompleted: 0,
  ...overrides,
});

describe("CodeItLab quest board", () => {
  it("starts at Explorer with the agent quest first and nothing done", () => {
    const board = buildCodeItLabQuestBoard(facts());
    assert.strictEqual(board.done, 0);
    assert.strictEqual(board.total, 11);
    assert.strictEqual(board.level, "explorer");
    assert.strictEqual(board.levelLabel, "Explorer");
    assert.strictEqual(board.next?.id, "agent");
    assert.strictEqual(board.quests[0]?.done, false);
    assert.ok(board.quests.every((quest) => quest.lesson.length > 40));
  });

  it("marks exactly the quests whose facts are present", () => {
    const board = buildCodeItLabQuestBoard(
      facts({
        agentsInstalled: 2,
        modelsConfigured: 179,
        memoryEntries: 12,
        reaInstalled: true,
      }),
    );
    assert.strictEqual(board.done, 4);
    assert.deepStrictEqual(
      board.quests.filter((quest) => quest.done).map((quest) => quest.id),
      ["agent", "models", "memory", "evidence"],
    );
    assert.strictEqual(board.next?.id, "board");
    assert.strictEqual(board.level, "builder");
  });

  it("moves through Operator and Architect as the rest lands", () => {
    const operator = buildCodeItLabQuestBoard(
      facts({
        agentsInstalled: 1,
        modelsConfigured: 1,
        memoryEntries: 1,
        reaInstalled: true,
        studioProjects: 1,
        studioVideos: 1,
      }),
    );
    assert.strictEqual(operator.done, 6);
    assert.strictEqual(operator.level, "operator");
    assert.strictEqual(operator.next?.id, "board");

    const architect = buildCodeItLabQuestBoard(
      facts({
        agentsInstalled: 1,
        modelsConfigured: 1,
        memoryEntries: 1,
        reaInstalled: true,
        studioProjects: 2,
        studioVideos: 1,
        integrationsConfigured: 1,
        remoteReachable: true,
        credentialsActive: true,
        boardTasks: 1,
        boardCompleted: 1,
      }),
    );
    assert.strictEqual(architect.done, 11);
    assert.strictEqual(architect.level, "architect");
    assert.strictEqual(architect.next, null);
  });

  it("is deterministic and decodes default facts from an empty payload", () => {
    const first = buildCodeItLabQuestBoard(facts());
    const second = buildCodeItLabQuestBoard(facts());
    assert.deepStrictEqual(first, second);

    const decoded = decodeQuestFacts({});
    assert.strictEqual(decoded.agentsInstalled, 0);
    assert.strictEqual(decoded.reaInstalled, false);
    assert.strictEqual(decoded.credentialsActive, false);
  });
});
