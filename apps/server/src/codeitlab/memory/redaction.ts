/**
 * Memory must never become a secret store. Extraction and manual writes both
 * pass through this redaction pass first, and a candidate that still looks like
 * a credential after redaction is dropped instead of stored.
 *
 * The patterns are intentionally conservative: a false positive costs one
 * unremembered sentence, a false negative persists a live credential to disk
 * and into every later prompt.
 */

interface SecretPattern {
  readonly kind: string;
  readonly pattern: RegExp;
}

const SECRET_PATTERNS: ReadonlyArray<SecretPattern> = [
  {
    kind: "private-key",
    pattern:
      /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----(?:[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----)?/g,
  },
  {
    kind: "jwt",
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  },
  { kind: "openai-key", pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/g },
  { kind: "anthropic-key", pattern: /\bsk-ant-[A-Za-z0-9_-]{16,}\b/g },
  { kind: "github-token", pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { kind: "aws-key", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: "slack-token", pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { kind: "stripe-key", pattern: /\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
  { kind: "bearer", pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi },
  {
    kind: "credential-assignment",
    pattern:
      /\b(?:api[_-]?key|apikey|secret|client[_-]?secret|token|password|passwd|pwd|access[_-]?key)\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{8,}["']?/gi,
  },
  {
    // Long mixed-class blobs: base64 keys, session tokens, signed URLs' secrets.
    // Ordinary prose, paths, and 40-char hex commit hashes rarely clear both a
    // letter and a digit requirement at this length.
    kind: "high-entropy",
    pattern: /\b(?=[A-Za-z0-9+/_-]*[0-9])(?=[A-Za-z0-9+/_-]*[A-Za-z])[A-Za-z0-9+/_-]{48,}={0,2}\b/g,
  },
];

const REDACTED = "[redacted]";

export interface RedactionResult {
  readonly text: string;
  readonly redacted: boolean;
  readonly kinds: ReadonlyArray<string>;
}

export const redactSecrets = (text: string): RedactionResult => {
  const kinds = new Set<string>();
  let redactedText = text;
  for (const { kind, pattern } of SECRET_PATTERNS) {
    // A global regex carries lastIndex between calls; reset per use.
    pattern.lastIndex = 0;
    if (!pattern.test(redactedText)) continue;
    pattern.lastIndex = 0;
    kinds.add(kind);
    redactedText = redactedText.replace(pattern, REDACTED);
  }
  return {
    text: redactedText,
    redacted: kinds.size > 0,
    kinds: [...kinds],
  };
};

/**
 * True when the text still contains a credential-shaped run after redaction.
 * Used to reject a candidate rather than store a mangled secret.
 */
export const containsSecret = (text: string): boolean => redactSecrets(text).redacted;
