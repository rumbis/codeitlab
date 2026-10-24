import type { TaskClass } from "@codeitlab/core/routing";

/**
 * Deterministic task classification for auto-routing. It is intentionally
 * explainable: each decision reports the signals that fired so the UI can show
 * why a provider was picked, and tests can pin the behaviour.
 *
 * Greek and Greeklish prompts need their own signals: JavaScript's `\b` only
 * knows ASCII word characters, so Greek rules use Unicode lookarounds instead.
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
  {
    pattern:
      /\b(?:api|endpoint|backend|frontend|deploy|commit|merge|branch|repo|docker|regex|script|bug|error|exception)\b/iu,
    label: "coding-tech",
  },
  {
    pattern:
      /(?<![\p{L}])(?:γράψε|γραψε|φτιάξε|φτιαξε|δημιούργησε|δημιουργησε|υλοποίησε|υλοποιησε|διόρθωσε|διορθωσε|προσθέσε|προσθεσε|αφαίρεσε|αφαιρεσε|μετέτρεψε|μετετρεψε|κώδικας|κωδικας|κώδικα|κωδικα|συνάρτηση|συναρτηση|κλάση|κλαση|αρχείο|αρχειο|σφάλμα|σφαλμα|δοκιμές|δοκιμες|τεστ|βιβλιοθήκη|βιβλιοθηκη|διεπαφή|διεπαφη)(?![\p{L}])/iu,
    label: "coding-el",
  },
  {
    pattern:
      /(?<![\p{L}])(?:graps|ftiax|diorthose|prosthese|kwdika|kodika|synartisi|sinartisi|klasi|arxeio|arheio|sfalma|vivliothiki)\w*/iu,
    label: "coding-greeklish",
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
  {
    pattern:
      /(?<![\p{L}])(?:γιατί|γιατι|ανάλυσε|αναλυσε|εξήγησε|εξηγησε|σύγκρινε|συγκρινε|απόδειξε|αποδειξε|αιτιολόγησε|αιτιολογησε|αρχιτεκτονική|αρχιτεκτονικη|στρατηγική|στρατηγικη|σχεδίασε|σχεδιασε|αξιολόγησε|αξιολογησε|συλλογισμός|συλλογισμος|βήμα βήμα|βημα βημα|πρώτες αρχές|πρωτες αρχες|θεώρημα|θεωρημα|πιθανότητα|πιθανοτητα)(?![\p{L}])/iu,
    label: "reasoning-el",
  },
  {
    pattern:
      /(?<![\p{L}])(?:giati|analise|eksigise|sigkrine|apodeikse|arxitektoniki|stratigiki|sxediase|aksiologise)\w*/iu,
    label: "reasoning-greeklish",
  },
];

const FAST_SIGNALS: ReadonlyArray<{ readonly pattern: RegExp; readonly label: string }> = [
  {
    pattern: /\b(?:quick|quickly|short answer|one-?liner|typo|rename|tldr|just tell me)\b/iu,
    label: "quick",
  },
  {
    pattern:
      /^\s*(?:what is|who is|define)\b|^\s*(?:τι είναι|τι ειναι|ποιος είναι|ποιος ειναι|όρισε|ορισε)(?![\p{L}])/iu,
    label: "lookup",
  },
  {
    pattern:
      /(?<![\p{L}])(?:γρήγορα|γρηγορα|σύντομα|συντομα|σύντομη απάντηση|συντομη απαντηση|μονολεκτικά|μονολεκτικα|μία γραμμή|μια γραμμη|απλά πες μου|απλα πες μου|μόνο πες μου|μονο πες μου|τι είναι|τι ειναι|ποιος είναι|ποιος ειναι|ορισμός|ορισμος|tldr)(?![\p{L}])/iu,
    label: "quick-el",
  },
  {
    pattern: /\b(?:grigora|grhgora|sintoma|monolektika|orismos|ti einai)\w*/iu,
    label: "quick-greeklish",
  },
];

const CHEAP_SIGNALS: ReadonlyArray<{ readonly pattern: RegExp; readonly label: string }> = [
  { pattern: /\b(?:cheap|cheapest|budget|low[- ]cost|save (?:tokens|quota))\b/iu, label: "cheap" },
  {
    pattern:
      /(?<![\p{L}])(?:φθηνό|φθηνο|φτηνό|φτηνο|οικονομικό|οικονομικο|οικονομικά|οικονομικα|λίγα tokens|λιγα tokens|εξοικονόμηση|εξοικονομηση)(?![\p{L}])/iu,
    label: "cheap-el",
  },
];

const VISION_SIGNALS: ReadonlyArray<{ readonly pattern: RegExp; readonly label: string }> = [
  {
    pattern:
      /\b(?:screenshot|image|photo|diagram|mockup|wireframe|ui design|look at this|what(?:'s| is) in (?:this|the) (?:image|picture|screenshot))\b/iu,
    label: "visual-request",
  },
  {
    pattern:
      /(?<![\p{L}])(?:εικόνα|εικονα|φωτογραφία|φωτογραφια|στιγμιότυπο|στιγμιοτυπο|διάγραμμα|διαγραμμα|μακέτα|μακετα|δες (?:αυτό|αυτη|την)|τι δείχνει|τι δειχνει)(?![\p{L}])/iu,
    label: "visual-request-el",
  },
  {
    pattern: /(?<![\p{L}])(?:eikona|fotografia|stigmiotypo|diagramma|maketa|des auto)\w*/iu,
    label: "visual-request-greeklish",
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
