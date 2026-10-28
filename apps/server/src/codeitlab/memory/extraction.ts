import type { MemoryKind } from "@codeitlab/core/memory";

import { redactSecrets } from "./redaction.ts";

/**
 * Deterministic memory extraction.
 *
 * The server's provider text-generation service only exposes fixed operations
 * (commit message, PR copy, branch name, thread title, review guide), so there
 * is no generic "summarise this turn" call to hand a transcript to. v1 extracts
 * with a small pattern set instead: it is local, free, testable, and errs toward
 * missing a fact rather than inventing one. A model-backed extractor can be
 * plugged into `MemoryService` later without changing the store or the RPCs.
 */

export interface ExtractionInput {
  readonly prompt: string;
  readonly assistantText?: string | undefined;
}

export interface MemoryCandidate {
  readonly kind: MemoryKind;
  readonly text: string;
  readonly tags: ReadonlyArray<string>;
  readonly confidence: number;
}

const MAX_CANDIDATES = 3;
const MIN_TEXT_LENGTH = 18;
const MAX_TEXT_LENGTH = 400;

interface ExtractionRule {
  readonly kind: MemoryKind;
  readonly confidence: number;
  readonly pattern: RegExp;
}

/** Strong first-person statements are the highest-signal durable facts. */
const PROMPT_RULES: ReadonlyArray<ExtractionRule> = [
  {
    kind: "preference",
    confidence: 0.85,
    pattern: /\b(?:i|we)\s+(?:prefer|always|never|want|like|hate|don'?t want)\b/i,
  },
  {
    kind: "preference",
    confidence: 0.8,
    pattern: /\b(?:always|never)\s+(?:use|run|do|commit|deploy|call|write|name)\b/i,
  },
  {
    kind: "decision",
    confidence: 0.85,
    pattern: /\b(?:we|i)\s+(?:decided|chose|settled on|agreed|picked)\b/i,
  },
  {
    kind: "decision",
    confidence: 0.75,
    pattern: /\blet'?s\s+(?:go with|use|stick with|standardise)\b/i,
  },
  {
    kind: "convention",
    confidence: 0.75,
    pattern:
      /\b(?:convention|by convention|our standard|project standard|house style|code style)\b/i,
  },
  {
    kind: "convention",
    confidence: 0.7,
    pattern:
      /\b(?:this|the)\s+(?:repo|project|codebase|team)\s+(?:uses|follows|requires|expects)\b/i,
  },
  {
    kind: "gotcha",
    confidence: 0.75,
    pattern:
      /\b(?:gotcha|watch out|known issue|be careful|breaks?\s+(?:when|if)|doesn'?t work\s+(?:with|when)|fails?\s+(?:when|if))\b/i,
  },
  {
    kind: "fact",
    confidence: 0.7,
    pattern: /\b(?:remember|note that|for the record|keep in mind|don'?t forget)\b/i,
  },
  {
    kind: "fact",
    confidence: 0.65,
    pattern: /\b(?:we|i)\s+(?:deploy|build|release|run|test|publish)\s+(?:with|using|via|on)\b/i,
  },
];

/** Assistant text is noisier, so only explicit markers are extracted from it. */
const ASSISTANT_RULES: ReadonlyArray<ExtractionRule> = [
  {
    kind: "decision",
    confidence: 0.7,
    pattern: /\b(?:decision|decided)\s*[:—-]\s*(?=\S)/i,
  },
  {
    kind: "convention",
    confidence: 0.65,
    pattern: /\b(?:convention|project rule|standard)\s*[:—-]\s*(?=\S)/i,
  },
  {
    kind: "gotcha",
    confidence: 0.65,
    pattern: /\b(?:gotcha|caveat|known issue)\s*[:—-]\s*(?=\S)/i,
  },
];

const EXPLICIT_MARKER = /\b(?:memory|remember)\s*[:：]\s*(?=\S)/i;
const EXPLICIT_MARKER_GLOBAL = /\b(?:memory|remember)\s*[:：]\s*/gi;

const stripMarkdown = (sentence: string): string =>
  sentence
    .replace(/^[\s>#*+-]+/, "")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();

export const normalizeMemoryText = (text: string): string =>
  text
    .replace(/^[\s>#*+-]+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.;:,]+$/, "");

const splitSentences = (text: string): ReadonlyArray<string> => {
  const withoutCode = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`\n]*`/g, " ")
    .replace(/<[^>]+>/g, " ");
  return withoutCode
    .split(/(?<=[.!?])\s+|\n{2,}|\n(?=[-*#\d])/u)
    .map(stripMarkdown)
    .filter((sentence) => sentence.length > 0);
};

const isEligibleText = (text: string): boolean =>
  text.length >= MIN_TEXT_LENGTH &&
  text.length <= MAX_TEXT_LENGTH &&
  // Questions are requests, not durable facts.
  !text.endsWith("?") &&
  !/^(?:can you|could you|please|why|what|how|where|when|who)\b/i.test(text);

const extractTags = (text: string): ReadonlyArray<string> => {
  const tags = new Set<string>();
  for (const match of text.matchAll(
    /(?:^|\s)([\w.-]+\/[\w./-]+|[\w-]+\.(?:ts|tsx|js|jsx|json|md|yml|yaml|toml|sh|py|rs|go))/g,
  )) {
    const tag = match[1];
    if (tag && tag.length <= 80) tags.add(tag);
  }
  for (const match of text.matchAll(
    /\b(?:npm|pnpm|bun|yarn|make|git|docker|cargo|go|node|npx|uv)\s+[a-z][\w.:-]*(?:\s+[a-z][\w.:-]*)?/gi,
  )) {
    const tag = match[0]?.trim();
    if (tag && tag.length <= 80) tags.add(tag);
  }
  return [...tags].slice(0, 5);
};

const matchRule = (
  sentence: string,
  rules: ReadonlyArray<ExtractionRule>,
): ExtractionRule | undefined => rules.find((rule) => rule.pattern.test(sentence));

const toCandidate = (
  rawText: string,
  rule: { readonly kind: MemoryKind; readonly confidence: number },
): MemoryCandidate | undefined => {
  const redaction = redactSecrets(rawText);
  // A redacted candidate is a credential we would have stored half of. Drop it
  // instead of remembering a mangled secret.
  if (redaction.redacted) return undefined;
  const text = normalizeMemoryText(redaction.text);
  if (!isEligibleText(text)) return undefined;
  return {
    kind: rule.kind,
    text,
    tags: extractTags(text),
    confidence: rule.confidence,
  };
};

/**
 * Near-duplicate detection used for within-turn dedupe and for store-level
 * dedupe. Token-set Jaccard keeps "we deploy with make release" and "we deploy
 * using make release" from becoming two memories.
 */
export const memoryTextKey = (text: string): ReadonlySet<string> => {
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((token) => token.length > 1);
  return new Set(tokens);
};

export const isNearDuplicateMemory = (a: string, b: string, threshold = 0.7): boolean => {
  const left = memoryTextKey(a);
  const right = memoryTextKey(b);
  if (left.size === 0 || right.size === 0) return false;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  const union = left.size + right.size - intersection;
  return union > 0 && intersection / union >= threshold;
};

const dedupeCandidates = (
  candidates: ReadonlyArray<MemoryCandidate>,
): ReadonlyArray<MemoryCandidate> => {
  const kept: MemoryCandidate[] = [];
  for (const candidate of candidates) {
    const duplicate = kept.find((existing) => isNearDuplicateMemory(existing.text, candidate.text));
    if (duplicate === undefined) {
      kept.push(candidate);
    } else if (candidate.confidence > duplicate.confidence) {
      kept[kept.indexOf(duplicate)] = candidate;
    }
  }
  return kept;
};

export const extractMemoryCandidates = (input: ExtractionInput): ReadonlyArray<MemoryCandidate> => {
  const candidates: MemoryCandidate[] = [];

  for (const sentence of splitSentences(input.prompt)) {
    const explicit = EXPLICIT_MARKER.test(sentence);
    if (explicit) {
      const text = sentence.replace(EXPLICIT_MARKER_GLOBAL, "");
      const candidate = toCandidate(text, { kind: "fact", confidence: 0.9 });
      if (candidate !== undefined) candidates.push(candidate);
      continue;
    }
    const rule = matchRule(sentence, PROMPT_RULES);
    if (rule === undefined) continue;
    const candidate = toCandidate(sentence, rule);
    if (candidate !== undefined) candidates.push(candidate);
  }

  if (input.assistantText !== undefined) {
    for (const sentence of splitSentences(input.assistantText)) {
      const rule = matchRule(sentence, ASSISTANT_RULES);
      if (rule === undefined) continue;
      const candidate = toCandidate(sentence, rule);
      if (candidate !== undefined) candidates.push(candidate);
    }
  }

  return [...dedupeCandidates(candidates)]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, MAX_CANDIDATES);
};
