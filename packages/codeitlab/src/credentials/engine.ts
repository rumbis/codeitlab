import type {
  CodeitlabCredentialsFinding,
  CodeitlabCredentialsFindingKind,
  CodeitlabCredentialsMode,
  CodeitlabPrivateTagBehavior,
} from "../credentials.ts";

/**
 * The credentials proxy engine: pure, synchronous and dependency-free.
 *
 * It finds secrets and private blocks in a piece of text, replaces each value
 * with a deterministic fake of the same shape, and can put the originals back
 * later. It never stores a value in a finding, a log line or a schema: only the
 * local vault keeps the mapping, and the vault lives on this machine.
 *
 * Fakes are deterministic per (value, key) so the same key gets the same fake
 * in every request and every session — code the model writes still lines up,
 * and history the agent sends again does not cost another detection.
 */

export interface CredentialsEngineOptions {
  mode: CodeitlabCredentialsMode;
  privateTag: CodeitlabPrivateTagBehavior;
  maskPersonalData: boolean;
  /** Deterministic fake key. A different key produces different fakes. */
  fakeKey: string;
  /** The tiny local model, when loaded. */
  model?: CredentialsModel;
  /** Score at or above which the model's candidate is treated as a secret. */
  modelThreshold?: number;
}

export interface CredentialsModel {
  readonly id: string;
  readonly version: string;
  /** 0..1 likelihood that a bare token is a credential. */
  score(token: string, context?: string): number;
}

export interface CredentialsMaskResult {
  masked: string;
  findings: CodeitlabCredentialsFinding[];
  blocked: boolean;
  privateBlocks: number;
  modelUsed: boolean;
}

interface Span {
  start: number;
  end: number;
  kind: CodeitlabCredentialsFindingKind;
  source: "pattern" | "model" | "tag";
}

const BASE62 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const BASE64URL = `${BASE62}-_`;
const DIGITS = "0123456789";
const ALNUM = BASE62;

/** Keyed 32-bit hash (FNV-1a over key + kind + value). */
function hash32(key: string, kind: string, value: string): number {
  let h = 0x811c9dc5;
  const input = `${key}\u0000${kind}\u0000${value}`;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic character stream seeded by a keyed hash. */
function createStream(seed: number): () => number {
  let state = seed || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state;
  };
}

function pick(stream: () => number, alphabet: string): string {
  return alphabet[stream() % alphabet.length]!;
}

function randomString(stream: () => number, alphabet: string, length: number): string {
  let out = "";
  for (let i = 0; i < length; i += 1) out += pick(stream, alphabet);
  return out;
}

const KNOWN_PREFIXES = [
  "sk-ant-api03-",
  "sk-ant-",
  "sk-proj-",
  "sk-",
  "ghp_",
  "gho_",
  "ghu_",
  "ghs_",
  "ghr_",
  "github_pat_",
  "glpat-",
  "AKIA",
  "ASIA",
  "AIza",
  "xoxb-",
  "xoxp-",
  "xoxa-",
  "xoxr-",
  "npm_",
  "sk_live_",
  "rk_live_",
  "whsec_",
] as const;

function preservedPrefix(value: string): string {
  let best = "";
  for (const prefix of KNOWN_PREFIXES) {
    if (value.startsWith(prefix) && prefix.length > best.length) best = prefix;
  }
  return best;
}

/** Luhn check digit for a numeric prefix. */
function luhnCheckDigit(prefix: string): string {
  let sum = 0;
  let double = true;
  for (let i = prefix.length - 1; i >= 0; i -= 1) {
    let digit = prefix.charCodeAt(i) - 48;
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return String((10 - (sum % 10)) % 10);
}

function ibanMod97(iban: string): number {
  const rearranged = `${iban.slice(4)}${iban.slice(0, 4)}`;
  let remainder = 0;
  for (const char of rearranged) {
    const code = char >= "0" && char <= "9" ? char.charCodeAt(0) - 48 : char.charCodeAt(0) - 55;
    remainder = (remainder * (code > 9 ? 100 : 10) + code) % 97;
  }
  return remainder;
}

function fakeIban(value: string, stream: () => number): string {
  const country = value.slice(0, 2).toUpperCase();
  const length = Math.min(Math.max(value.length, 15), 34);
  const bban = randomString(stream, ALNUM.toUpperCase(), length - 4);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = `${country}00${bban}`;
    const check = 98 - ibanMod97(candidate);
    const withCheck = `${country}${String(check).padStart(2, "0")}${bban}`;
    if (ibanMod97(withCheck) === 1) return withCheck;
  }
  return `${country}00${bban}`;
}

function fakeCard(value: string, stream: () => number): string {
  const digits = value.replace(/\D/g, "");
  const length = Math.min(Math.max(digits.length, 13), 19);
  const body = randomString(stream, DIGITS, length - 1);
  return `${body}${luhnCheckDigit(body)}`;
}

function fakePrivateKey(value: string, stream: () => number): string {
  const headerMatch = /^-----BEGIN ([A-Z0-9 ]*PRIVATE KEY)-----/.exec(value);
  const footerMatch = /-----END ([A-Z0-9 ]*PRIVATE KEY)-----$/.exec(value);
  const header = headerMatch?.[1] ?? "PRIVATE KEY";
  const footer = footerMatch?.[1] ?? header;
  const bodyLength = Math.max(64, value.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "").length);
  const body = randomString(stream, `${BASE64URL}=`, Math.min(bodyLength, 4096));
  const lines: string[] = [];
  for (let i = 0; i < body.length; i += 64) lines.push(body.slice(i, i + 64));
  return `-----BEGIN ${header}-----\n${lines.join("\n")}\n-----END ${footer}-----`;
}

function fakeJwt(value: string, stream: () => number): string {
  const parts = value.split(".");
  const segment = (length: number) => randomString(stream, BASE64URL, Math.max(length, 8));
  return parts.map((part) => segment(part.length)).join(".");
}

function fakeConnectionString(value: string, stream: () => number, maskHost: boolean): string {
  const match =
    /^([a-z][a-z0-9+.-]*):\/\/(?:([^:@/\s]+):)?([^@/\s]*)@([^/\s:]+)(:\d+)?(\/[^\s]*)?$/i.exec(
      value,
    );
  if (!match) return randomString(stream, BASE64URL, value.length);
  const [, scheme, user, , host, port, rest] = match;
  const fakeUser = user ?? "user";
  const fakePassword = randomString(stream, ALNUM, 24);
  const fakeHost = maskHost ? `db-${randomString(stream, "abcdef0123456789", 6)}.invalid` : host;
  return `${scheme}://${fakeUser}:${fakePassword}@${fakeHost}${port ?? ""}${rest ?? ""}`;
}

/** Produce a deterministic fake that keeps the value's shape. */
export function createFake(
  kind: CodeitlabCredentialsFindingKind,
  value: string,
  fakeKey: string,
  mode: CodeitlabCredentialsMode = "balanced",
): string {
  const stream = createStream(hash32(fakeKey, kind, value));
  switch (kind) {
    case "api-key": {
      const prefix = preservedPrefix(value);
      return `${prefix}${randomString(stream, BASE64URL, Math.max(value.length - prefix.length, 12))}`;
    }
    case "token":
    case "password":
      return randomString(stream, ALNUM, Math.max(value.length, 8));
    case "jwt":
      return fakeJwt(value, stream);
    case "private-key":
      return fakePrivateKey(value, stream);
    case "connection-string":
      return fakeConnectionString(value, stream, mode === "max");
    case "email": {
      const local = randomString(stream, "abcdefghijklmnopqrstuvwxyz", 8);
      return `user_${local}@masked.invalid`;
    }
    case "phone": {
      const plus = value.startsWith("+") ? "+" : "";
      const digits = value.replace(/\D/g, "");
      const keep = digits.slice(0, Math.min(2, digits.length));
      return `${plus}${keep}${randomString(stream, DIGITS, Math.max(digits.length - keep.length, 6))}`;
    }
    case "iban":
      return fakeIban(value, stream);
    case "card":
      return fakeCard(value, stream);
    case "ip":
      return `10.${stream() % 256}.${stream() % 256}.${stream() % 256}`;
    case "private-block":
      return `[private:${randomString(stream, "0123456789abcdef", 8)}]`;
    case "model-detected":
      return randomString(stream, ALNUM, Math.max(value.length, 12));
  }
}

export interface VaultEntry {
  fake: string;
  original: string;
  kind: CodeitlabCredentialsFindingKind;
}

/**
 * Local fake ↔ original map. The server persists it encrypted; the engine only
 * keeps it in memory. Restoring the longest fake first prevents a shorter fake
 * that happens to be a prefix of a longer one from corrupting the text.
 */
export class CredentialVault {
  private readonly byFake = new Map<string, VaultEntry>();
  private readonly byOriginal = new Map<string, VaultEntry>();

  remember(original: string, fake: string, kind: CodeitlabCredentialsFindingKind): void {
    if (original === fake) return;
    const entry: VaultEntry = { fake, original, kind };
    this.byFake.set(fake, entry);
    this.byOriginal.set(original, entry);
  }

  /** Reuse the same fake for a value seen before (history, repeated turns). */
  existingFake(original: string): string | undefined {
    return this.byOriginal.get(original)?.fake;
  }

  restore(text: string): { text: string; restored: number } {
    if (this.byFake.size === 0) return { text, restored: 0 };
    const fakes = [...this.byFake.keys()].sort((a, b) => b.length - a.length);
    let out = text;
    let restored = 0;
    for (const fake of fakes) {
      if (!out.includes(fake)) continue;
      const entry = this.byFake.get(fake)!;
      out = out.split(fake).join(entry.original);
      restored += 1;
    }
    return { text: out, restored };
  }

  restoreDeep(value: unknown): unknown {
    if (typeof value === "string") return this.restore(value).text;
    if (Array.isArray(value)) return value.map((item) => this.restoreDeep(item));
    if (value !== null && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        out[key] = this.restoreDeep(item);
      }
      return out;
    }
    return value;
  }

  entries(): VaultEntry[] {
    return [...this.byFake.values()];
  }

  load(entries: ReadonlyArray<VaultEntry>): void {
    for (const entry of entries) this.remember(entry.original, entry.fake, entry.kind);
  }

  get size(): number {
    return this.byFake.size;
  }
}

interface PatternRule {
  kind: CodeitlabCredentialsFindingKind;
  regex: RegExp;
  /** Capture group that holds the value; 0 means the whole match. */
  group?: number;
  /** Only active at these modes. */
  modes?: ReadonlyArray<CodeitlabCredentialsMode>;
  /** Personal data, switched off unless `maskPersonalData` is on. */
  personal?: boolean;
  /** Value-level validation (checksums, shapes). */
  validate?: (value: string) => boolean;
}

function validIban(value: string): boolean {
  const compact = value.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(compact)) return false;
  return ibanMod97(compact) === 1;
}

function validCard(value: string): boolean {
  const digits = value.replace(/[^0-9]/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let digit = Number(digits[i]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

const PERSONAL_MODES: ReadonlyArray<CodeitlabCredentialsMode> = ["balanced", "max"];
const MAX_MODES: ReadonlyArray<CodeitlabCredentialsMode> = ["max"];

const PATTERN_RULES: ReadonlyArray<PatternRule> = [
  {
    kind: "private-key",
    regex: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
  },
  {
    kind: "jwt",
    regex: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  },
  {
    kind: "connection-string",
    regex:
      /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss|amqp|amqps):\/\/[^\s"'<>`]+/gi,
  },
  {
    kind: "api-key",
    regex:
      /\b(?:sk-ant-api03-[A-Za-z0-9_-]{16,}|sk-ant-[A-Za-z0-9_-]{16,}|sk-proj-[A-Za-z0-9_-]{16,}|sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|xox[baprs]-[A-Za-z0-9-]{10,}|npm_[A-Za-z0-9]{30,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{10,}|whsec_[A-Za-z0-9]{20,})\b/g,
  },
  {
    kind: "token",
    regex: /\bBearer\s+([A-Za-z0-9\-._~+/]{16,}=*)/gi,
    group: 1,
  },
  {
    kind: "password",
    regex:
      /\b(?:api[_-]?key|apikey|secret[_-]?key|client[_-]?secret|access[_-]?key|auth[_-]?token|refresh[_-]?token|password|passwd|pwd|private[_-]?key|secret|token)\b["']?\s*[:=]\s*["']?([^\s"',;}\]]{4,})/gi,
    group: 1,
  },
  {
    kind: "password",
    regex: /^[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD|CREDENTIAL)[A-Z0-9_]*\s*=\s*(.+)$/gm,
    group: 1,
  },
  {
    kind: "email",
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    modes: PERSONAL_MODES,
    personal: true,
  },
  {
    kind: "phone",
    regex: /\+(?:[0-9][\s().-]?){8,15}[0-9]\b/g,
    modes: PERSONAL_MODES,
    personal: true,
  },
  {
    kind: "iban",
    regex: /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g,
    modes: PERSONAL_MODES,
    personal: true,
    validate: validIban,
  },
  {
    kind: "card",
    regex: /\b(?:\d[ -]?){13,19}\b/g,
    modes: PERSONAL_MODES,
    personal: true,
    validate: validCard,
  },
  {
    kind: "ip",
    regex:
      /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/g,
    modes: MAX_MODES,
  },
];

const PRIVATE_TAG_PAIRS = [
  { open: "/private", close: "/private" },
  { open: "[private]", close: "[/private]" },
  { open: "<private>", close: "</private>" },
] as const;

/** `/private` must not match the `/private` inside `</private>`, `[/private]` or `<private>`. */
const SLASH_PRIVATE_TAG = /(?<![<[])\/private(?![>\]])/g;

function collectPrivateSpans(text: string): { spans: Span[]; count: number } {
  const spans: Span[] = [];

  // The bare tag pair: the same token opens and closes a block.
  const slashMatches: Array<{ start: number; end: number }> = [];
  for (const match of text.matchAll(SLASH_PRIVATE_TAG)) {
    if (match.index === undefined) continue;
    slashMatches.push({ start: match.index, end: match.index + match[0].length });
  }
  for (let i = 0; i + 1 < slashMatches.length; i += 2) {
    const open = slashMatches[i]!;
    const close = slashMatches[i + 1]!;
    spans.push({ start: open.end, end: close.start, kind: "private-block", source: "tag" });
  }

  for (const pair of PRIVATE_TAG_PAIRS.slice(1)) {
    let from = 0;
    for (;;) {
      const open = text.indexOf(pair.open, from);
      if (open === -1) break;
      const contentStart = open + pair.open.length;
      const close = text.indexOf(pair.close, contentStart);
      if (close === -1) break;
      spans.push({ start: contentStart, end: close, kind: "private-block", source: "tag" });
      from = close + pair.close.length;
    }
  }
  return { spans: mergeSpans(spans), count: spans.length };
}

function mergeSpans(spans: Span[]): Span[] {
  if (spans.length < 2) return spans;
  const sorted = [...spans].sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: Span[] = [];
  for (const span of sorted) {
    const last = merged[merged.length - 1];
    if (last && span.start < last.end) {
      if (span.end > last.end) last.end = span.end;
      continue;
    }
    merged.push({ ...span });
  }
  return merged;
}

function overlaps(a: Span, b: Span): boolean {
  return a.start < b.end && b.start < a.end;
}

function collectPatternSpans(
  text: string,
  mode: CodeitlabCredentialsMode,
  maskPersonal: boolean,
): Span[] {
  const spans: Span[] = [];
  for (const rule of PATTERN_RULES) {
    if (rule.modes && !rule.modes.includes(mode)) continue;
    if (!maskPersonal && rule.personal === true) continue;
    const regex = new RegExp(rule.regex.source, rule.regex.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      if (match[0].length === 0) {
        regex.lastIndex += 1;
        continue;
      }
      const group = rule.group ?? 0;
      const value = match[group];
      if (value === undefined) continue;
      if (rule.validate && !rule.validate(value)) continue;
      const offset = group === 0 ? 0 : match[0].indexOf(value);
      const start = match.index + Math.max(offset, 0);
      spans.push({ start, end: start + value.length, kind: rule.kind, source: "pattern" });
    }
  }
  return mergeSpans(spans);
}

const CANDIDATE_TOKEN = /[A-Za-z0-9+/_=.-]{12,}/g;

function candidateTokens(text: string): Span[] {
  const spans: Span[] = [];
  let match: RegExpExecArray | null;
  CANDIDATE_TOKEN.lastIndex = 0;
  while ((match = CANDIDATE_TOKEN.exec(text)) !== null) {
    spans.push({
      start: match.index,
      end: match.index + match[0].length,
      kind: "model-detected",
      source: "model",
    });
  }
  return spans;
}

/**
 * Mask every value the engine recognizes. The returned text is what may leave
 * the machine; `findings` describe the spans without their values.
 */
export function maskText(
  text: string,
  options: CredentialsEngineOptions,
  vault?: CredentialVault,
): CredentialsMaskResult {
  if (text.length === 0) {
    return { masked: text, findings: [], blocked: false, privateBlocks: 0, modelUsed: false };
  }
  const privateResult = collectPrivateSpans(text);
  const patternSpans = collectPatternSpans(text, options.mode, options.maskPersonalData);

  const accepted: Span[] = [...privateResult.spans];
  for (const span of patternSpans) {
    if (accepted.some((existing) => overlaps(existing, span))) continue;
    accepted.push(span);
  }

  let modelUsed = false;
  if (options.model) {
    const threshold = options.modelThreshold ?? 0.5;
    const tokens = candidateTokens(text);
    for (const token of tokens) {
      if (accepted.some((existing) => overlaps(existing, token))) continue;
      const value = text.slice(token.start, token.end);
      const context = text.slice(Math.max(0, token.start - 48), token.start);
      const score = options.model.score(value, context);
      if (score < threshold) continue;
      modelUsed = true;
      accepted.push(token);
    }
  }

  accepted.sort((a, b) => a.start - b.start || b.end - a.end);

  const store = vault ?? new CredentialVault();
  const findings: CodeitlabCredentialsFinding[] = [];
  let masked = "";
  let cursor = 0;
  for (const span of accepted) {
    if (span.start < cursor) continue;
    const value = text.slice(span.start, span.end);
    const fake =
      store.existingFake(value) ?? createFake(span.kind, value, options.fakeKey, options.mode);
    store.remember(value, fake, span.kind);
    masked += text.slice(cursor, span.start) + fake;
    cursor = span.end;
    findings.push({ kind: span.kind, source: span.source, start: span.start, end: span.end });
  }
  masked += text.slice(cursor);

  return {
    masked,
    findings,
    blocked: options.privateTag === "block" && privateResult.count > 0,
    privateBlocks: privateResult.count,
    modelUsed,
  };
}

/** Restore fakes in a value of any JSON shape (responses, tool output, settings). */
export function restoreValue(value: unknown, vault: CredentialVault): unknown {
  return vault.restoreDeep(value);
}

/** Mask every string in a JSON value (request bodies, attachments, tool arguments). */
export function maskValue(
  value: unknown,
  options: CredentialsEngineOptions,
  vault: CredentialVault,
): { value: unknown; findings: CodeitlabCredentialsFinding[]; blocked: boolean } {
  const findings: CodeitlabCredentialsFinding[] = [];
  let blocked = false;
  const walk = (item: unknown): unknown => {
    if (typeof item === "string") {
      const result = maskText(item, options, vault);
      findings.push(...result.findings);
      if (result.blocked) blocked = true;
      return result.masked;
    }
    if (Array.isArray(item)) return item.map(walk);
    if (item !== null && typeof item === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(item as Record<string, unknown>))
        out[key] = walk(entry);
      return out;
    }
    return item;
  };
  return { value: walk(value), findings, blocked };
}

export const CREDENTIALS_ENGINE_VERSION = "1.0.0";
