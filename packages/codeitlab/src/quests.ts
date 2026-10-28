import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/**
 * Quest board: the education layer of CodeItLab.
 *
 * Every feature has a quest that says what to do in one sentence, why it
 * matters in one more, and links straight to the surface where it happens.
 * Progress is derived from what the server can already observe (projects,
 * agents, memory, routing...), so nobody has to tick boxes or keep a streak —
 * using the app *is* the progress. No points, no guilt, no busywork.
 */

const NumberDefault = (value: number) =>
  Schema.Number.pipe(Schema.withDecodingDefault(Effect.succeed(value)));
const BooleanDefault = (value: boolean) =>
  Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(value)));

export const CodeItLabQuestId = Schema.Literals([
  "agent",
  "models",
  "memory",
  "evidence",
  "deck",
  "video",
  "engine",
  "remote",
  "keys",
  "board",
  "finish",
]);
export type CodeItLabQuestId = typeof CodeItLabQuestId.Type;

/** The observable state the board is derived from. */
export const CodeItLabQuestFacts = Schema.Struct({
  agentsInstalled: NumberDefault(0),
  modelsConfigured: NumberDefault(0),
  memoryEntries: NumberDefault(0),
  reaInstalled: BooleanDefault(false),
  studioProjects: NumberDefault(0),
  studioVideos: NumberDefault(0),
  integrationsConfigured: NumberDefault(0),
  remoteReachable: BooleanDefault(false),
  credentialsActive: BooleanDefault(false),
  boardTasks: NumberDefault(0),
  boardCompleted: NumberDefault(0),
});
export type CodeItLabQuestFacts = typeof CodeItLabQuestFacts.Type;

export const CodeItLabQuest = Schema.Struct({
  id: CodeItLabQuestId,
  title: Schema.String,
  /** What to do, in one action-sized sentence. */
  detail: Schema.String,
  /** Why it is worth doing. This is the part that teaches instead of nagging. */
  lesson: Schema.String,
  href: Schema.String,
  done: Schema.Boolean,
});
export type CodeItLabQuest = typeof CodeItLabQuest.Type;

export const CodeItLabQuestBoard = Schema.Struct({
  quests: Schema.Array(CodeItLabQuest),
  done: Schema.Number,
  total: Schema.Number,
  /** The first unfinished quest, or null when everything is done. */
  next: Schema.NullOr(CodeItLabQuest),
  level: Schema.Literals(["explorer", "builder", "operator", "architect"]),
  levelLabel: Schema.String,
});
export type CodeItLabQuestBoard = typeof CodeItLabQuestBoard.Type;

export const CODEITLAB_QUEST_LEVELS: Readonly<
  Record<CodeItLabQuestBoard["level"], { readonly label: string; readonly from: number }>
> = {
  explorer: { label: "Explorer", from: 0 },
  builder: { label: "Builder", from: 3 },
  operator: { label: "Operator", from: 6 },
  architect: { label: "Architect", from: 10 },
};

const quest = (
  id: CodeItLabQuestId,
  title: string,
  detail: string,
  lesson: string,
  href: string,
  done: boolean,
): CodeItLabQuest => ({ id, title, detail, lesson, href, done });

/**
 * Builds the board in a fixed order: first the fundamentals (an agent, models,
 * memory), then the making surfaces (evidence, deck, video), then reach (an
 * engine, your phone, your keys). Deterministic for the same facts.
 */
export const buildCodeItLabQuestBoard = (facts: CodeItLabQuestFacts): CodeItLabQuestBoard => {
  const quests: ReadonlyArray<CodeItLabQuest> = [
    quest(
      "agent",
      "Connect your first agent",
      "Enable an ACP agent (Hermes, Qoder CLI, Claude Code…) in Settings → Agents.",
      "ACP is the plug: one harness, every agent. You are never locked to one vendor, and a new agent is an upgrade, not a migration.",
      "/settings/codeitlab/agents",
      facts.agentsInstalled > 0,
    ),
    quest(
      "models",
      "Pick the models you trust",
      "Choose a routing mode and the models CodeItLab may use.",
      "Auto-routing picks the cheapest model that can do the job, so you pay for judgement, not for habit.",
      "/settings/codeitlab/routing",
      facts.modelsConfigured > 0,
    ),
    quest(
      "memory",
      "Give it memory",
      "Let a conversation teach CodeItLab something worth remembering.",
      "Memory is what turns a clever tool into a colleague: context survives the tab, the day and the model switch.",
      "/settings/codeitlab/memory",
      facts.memoryEntries > 0,
    ),
    quest(
      "evidence",
      "Turn on evidence",
      "Install REA so answers come with sources, not just confidence.",
      "The fear between people and AI is mostly the fear of being fooled. Evidence is how a tool earns trust instead of demanding it.",
      "/settings/codeitlab/rea",
      facts.reaInstalled,
    ),
    quest(
      "board",
      "Write down the next step",
      "Add one task to the board and start it when you have time.",
      "A vision becomes work only when it has a next step. The board is that step: it keeps the idea alive until you can give it an hour.",
      "/board",
      facts.boardTasks > 0,
    ),
    quest(
      "finish",
      "Finish one task",
      "Move a started task to Completed and let it leave the board.",
      "Finishing is a skill, not a formality: a completed task is proof the loop closes, and the board keeps the date so the streak is not a guess.",
      "/board",
      facts.boardCompleted > 0,
    ),
    quest(
      "deck",
      "Build a deck",
      "Open Studio and shape a four-slide story.",
      "A deck is the smallest useful artefact: it turns a vague idea into something a client can react to.",
      "/studio",
      facts.studioProjects > 0,
    ),
    quest(
      "video",
      "Render a video from code",
      "Create a video project in Studio and press Render video.",
      "Video from code means the artefact is reproducible: change the source, re-render, and the story updates without a timeline editor.",
      "/studio",
      facts.studioVideos > 0,
    ),
    quest(
      "engine",
      "Connect a creative engine",
      "Point Shorts, Crew or Search at a self-hostable engine you control.",
      "Your creative stack should be yours: open engines, your hardware, your data — no per-seat tax on your own ideas.",
      "/settings/codeitlab/shorts",
      facts.integrationsConfigured > 0,
    ),
    quest(
      "remote",
      "Take it to your phone",
      "Pair a phone or open the tunnel so CodeItLab follows you.",
      "The work does not happen only at the desk. A private tunnel keeps the same session in your pocket without a cloud account.",
      "/settings/codeitlab/remote",
      facts.remoteReachable,
    ),
    quest(
      "keys",
      "Use your keys safely",
      "Start the credentials gateway and let agents borrow access without seeing secrets.",
      "Handing an agent a raw key is a leap of faith. A gateway that masks and blocks is how you keep control while still saying yes.",
      "/settings/codeitlab/credentials",
      facts.credentialsActive,
    ),
  ];

  const done = quests.filter((entry) => entry.done).length;
  const total = quests.length;
  const next = quests.find((entry) => !entry.done) ?? null;
  const level =
    done >= CODEITLAB_QUEST_LEVELS.architect.from
      ? "architect"
      : done >= CODEITLAB_QUEST_LEVELS.operator.from
        ? "operator"
        : done >= CODEITLAB_QUEST_LEVELS.builder.from
          ? "builder"
          : "explorer";
  return {
    quests,
    done,
    total,
    next,
    level,
    levelLabel: CODEITLAB_QUEST_LEVELS[level].label,
  };
};
