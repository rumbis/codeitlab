import type { TaskClass } from "@codeitlab/core/routing";

/**
 * Deterministic task classification for auto-routing. It is intentionally
 * explainable: each decision reports the signals that fired so the UI can show
 * why a provider was picked, and tests can pin the behaviour.
 */

export interface TaskClassification {
  readonly taskClass: TaskClass;
  readonly confidence: number;
  readonly signals: ReadonlyArray<string>;
}

const IMAGE_EXTENSION = /\.(?:png|jpe?g|gif|webp|heic|heif|bmp|tiff?|svg)$/iu;

const CODING_SIGNALS: ReadonlyArray<{ readonly pattern: RegExp; readonly label: string }> = [
  { pattern: /```/u, label: "code-fence" },
  {
    pattern:
      /\b(?:implement|refactor|debug|compile|typecheck|unit test|fix the bug|pull request|commit|migration|endpoint|function|class|module)\b/iu,
    label: "coding-verb",
  },
  {
    pattern:
      /(?:^|\s)(?:[\w.-]+\/)*[\w.-]+\.(?:ts|tsx|js|jsx|py|rs|go|java|kt|swift|c|cc|cpp|h|hpp|cs|rb|php|sh|sql|css|html|json|ya?ml|toml)(?:\b|$)/u,
    label: "source-path",
  },
  {
    pattern:
      /\b(?:typescript|javascript|python|rust|golang|java|kotlin|swift|react|effect|sql|docker|kubernetes)\b/iu,
    label: "language",
  },
];

const REASONING_SIGNALS: ReadonlyArray<{ readonly pattern: RegExp; readonly label: string }> = [
  {
    pattern:
      /\b(?:why|prove|proof|analy[sz]e|reason about|root cause|trade-?offs?|architecture|design a|strategy|compare approaches|evaluate)\b/iu,
    label: "reasoning-verb",
  },
  { pattern: /\b(?:step by step|think (?:it )?through|first principles)\b/iu, label: "deep-think" },
  { pattern: /[∫∑√±≈≠≤≥]|\b(?:theorem|lemma|derivative|integral|probability)\b/iu, label: "math" },
];

const FAST_SIGNALS: ReadonlyArray<{ readonly pattern: RegExp; readonly label: string }> = [
  {
    pattern: /\b(?:quick|quickly|short answer|one-?liner|typo|rename|tldr|just tell me)\b/iu,
    label: "quick",
  },
  { pattern: /^\s*(?:what is|who is|define)\b/iu, label: "lookup" },
];

const CHEAP_SIGNALS: ReadonlyArray<{ readonly pattern: RegExp; readonly label: string }> = [
  { pattern: /\b(?:cheap|cheapest|budget|low[- ]cost|save (?:tokens|quota))\b/iu, label: "cheap" },
];

const VISION_SIGNALS: ReadonlyArray<{ readonly pattern: RegExp; readonly label: string }> = [
  {
    pattern:
      /\b(?:screenshot|image|photo|diagram|mockup|wireframe|ui design|look at this|what(?:'s| is) in (?:this|the) (?:image|picture|screenshot))\b/iu,
    label: "visual-request",
  },
];

const collectSignals = (
  text: string,
  rules: ReadonlyArray<{ readonly pattern: RegExp; readonly label: string }>,
): ReadonlyArray<string> =>
  rules.filter((rule) => rule.pattern.test(text)).map((rule) => rule.label);

const confidenceFor = (signals: number): number => Math.min(0.95, 0.55 + signals * 0.1);

export const classifyTask = (input: {
  readonly prompt: string;
  readonly attachments?: ReadonlyArray<string> | undefined;
  readonly taskClass?: TaskClass | undefined;
}): TaskClassification => {
  if (input.taskClass !== undefined) {
    return { taskClass: input.taskClass, confidence: 1, signals: ["forced"] };
  }
  const attachments = input.attachments ?? [];
  const prompt = input.prompt;
  const visionSignals = [
    ...attachments
      .filter((attachment) => IMAGE_EXTENSION.test(attachment))
      .map(() => "image-attachment"),
    ...collectSignals(prompt, VISION_SIGNALS),
  ];
  if (visionSignals.length > 0) {
    return {
      taskClass: "vision",
      confidence: confidenceFor(visionSignals.length),
      signals: visionSignals,
    };
  }

  const cheapSignals = collectSignals(prompt, CHEAP_SIGNALS);
  if (cheapSignals.length > 0) {
    return {
      taskClass: "cheap",
      confidence: confidenceFor(cheapSignals.length),
      signals: cheapSignals,
    };
  }

  const codingSignals = collectSignals(prompt, CODING_SIGNALS);
  const reasoningSignals = collectSignals(prompt, REASONING_SIGNALS);
  const fastSignals = collectSignals(prompt, FAST_SIGNALS);

  if (codingSignals.length > 0) {
    return {
      taskClass: "coding",
      confidence: confidenceFor(codingSignals.length + fastSignals.length * 0.5),
      signals: [...codingSignals, ...fastSignals],
    };
  }
  if (reasoningSignals.length > 0) {
    return {
      taskClass: "reasoning",
      confidence: confidenceFor(reasoningSignals.length),
      signals: reasoningSignals,
    };
  }
  if (fastSignals.length > 0 || prompt.trim().length < 80) {
    return {
      taskClass: "fast",
      confidence: confidenceFor(Math.max(1, fastSignals.length)),
      signals: fastSignals.length > 0 ? fastSignals : ["short-prompt"],
    };
  }
  return { taskClass: "chat", confidence: 0.5, signals: ["default"] };
};
