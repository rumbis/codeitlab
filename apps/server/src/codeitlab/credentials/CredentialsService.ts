// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off globalFetchInEffect:off - node:http runs the loopback-only gateway, node:crypto seals the local vault, and the gateway passes provider JSON through untouched.
import * as NodeCrypto from "node:crypto";
import * as NodeHttp from "node:http";

import { CodeItLabServiceError, DEFAULT_CODEITLAB_SETTINGS } from "@codeitlab/core";
import {
  CREDENTIALS_DEFAULT_MODEL_ID,
  CREDENTIALS_MODEL_DOWNLOAD_URL,
  type CodeItLabCredentialsAuditEntry,
  type CodeItLabCredentialsFindingKind,
  type CodeItLabCredentialsFindingSource,
  type CodeItLabCredentialsModel,
  type CodeItLabCredentialsRestoreResult,
  type CodeItLabCredentialsScanInput,
  type CodeItLabCredentialsScanResult,
  type CodeItLabCredentialsSettings,
  type CodeItLabCredentialsStatus,
} from "@codeitlab/core/credentials";
import {
  CredentialVault,
  maskedEnvironmentRecord,
  maskedEnvironment,
  maskText,
  maskValue,
  type CredentialsEngineOptions,
  type VaultEntry,
} from "@codeitlab/core/credentials/engine";
import {
  bundledCredentialModel,
  parseCredentialModel,
  type TinyCredentialModel,
} from "@codeitlab/core/credentials/model";
import { CredentialsService as CredentialsServiceTag } from "@codeitlab/core/services";
import { writeFileStringAtomically } from "@codeitlab/shared/atomicWrite";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import { HttpClient } from "effect/http";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";

import * as ServerConfig from "../../config.ts";
import * as ServerSettings from "../../serverSettings.ts";

/**
 * The credentials proxy — CodeItLab's local privacy firewall.
 *
 * Every string the app sends to a model can be inspected locally first: known
 * secrets (API keys, passwords, tokens, private keys, connection strings),
 * personal data, `/private` blocks and whatever the tiny local model flags are
 * replaced with deterministic, format-preserving fakes. The fake ↔ original
 * map never leaves the machine: it lives in memory and in an AES-256-GCM sealed
 * file under the state directory, and the real values are restored in answers
 * and tool output.
 *
 * Two entry points share that engine:
 *
 * 1. `scan` / `restore` — what the app itself sends and receives.
 * 2. A loopback HTTP gateway (`http://127.0.0.1:<port>`) that CLI agents can
 *    point their provider base URL at, so their own HTTP calls are covered too.
 *    The upstream is explicit per request (`x-codeitlab-upstream` header,
 *    `?upstream=` query, or `/upstream/<base64url>` prefix) and never guessed.
 *
 * Nothing is enabled by default and no value is ever logged, audited, or
 * returned in a finding: the audit trail records counts and kinds only.
 */

const CREDENTIALS_DIR = "codeitlab/credentials";
const VAULT_FILE = "vault.enc.json";
const VAULT_KEY_FILE = "vault.key";
const MODEL_FILE = "model.json";
const GATEWAY_HOST = "127.0.0.1";

/**
 * Loopback addresses a request may be addressed to. A page that rebinds its own
 * hostname to 127.0.0.1 still sends its own `Host`, so checking it turns DNS
 * rebinding into a plain 403 instead of a way to reach the vault.
 */
const GATEWAY_HOSTNAMES: ReadonlySet<string> = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function isGatewayHostAllowed(hostHeader: string | undefined): boolean {
  if (hostHeader === undefined) return false;
  const value = hostHeader.trim().toLowerCase();
  const hostname = value.startsWith("[")
    ? value.slice(0, value.indexOf("]") + 1)
    : (value.split(":")[0] ?? "");
  return GATEWAY_HOSTNAMES.has(hostname);
}
const MAX_BODY_BYTES = 16 * 1024 * 1024;
/** A fake can be longer than the original (private keys); keep a tail unflushed while streaming. */
const RESTORE_LOOKBEHIND = 512;
const DEFAULT_AUDIT_LIMIT = 500;

const serviceError = (operation: string, message: string, cause?: unknown) =>
  new CodeItLabServiceError({ operation, message, ...(cause === undefined ? {} : { cause }) });

interface VaultFile {
  readonly version: 1;
  readonly iv: string;
  readonly tag: string;
  readonly data: string;
}

interface ModelState {
  readonly model: TinyCredentialModel;
  readonly state: CodeItLabCredentialsModel["state"];
  readonly path?: string;
  readonly sha256?: string;
  readonly detail?: string;
}

interface Counters {
  scanned: number;
  maskedValues: number;
  blocked: number;
  lastActivityAt?: string;
}

export interface CredentialsServiceDeps {
  readonly stateDir: string;
  readonly fs: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly readSettings: Effect.Effect<CodeItLabCredentialsSettings, CodeItLabServiceError>;
  readonly writeSettings: (
    next: CodeItLabCredentialsSettings,
  ) => Effect.Effect<void, CodeItLabServiceError>;
  /** Injectable for tests and offline builds. */
  readonly fetchText?: (url: string) => Effect.Effect<string, CodeItLabServiceError>;
  readonly modelDownloadUrl?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const sha256Hex = (value: string): string =>
  NodeCrypto.createHash("sha256").update(value).digest("hex");

const encryptVault = (key: Buffer, entries: ReadonlyArray<VaultEntry>): string => {
  const iv = NodeCrypto.randomBytes(12);
  const cipher = NodeCrypto.createCipheriv("aes-256-gcm", key, iv);
  const plaintext = JSON.stringify({ version: 1, entries });
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const file: VaultFile = {
    version: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  };
  return JSON.stringify(file);
};

const decryptVault = (key: Buffer, contents: string): VaultEntry[] => {
  const parsed: unknown = JSON.parse(contents);
  if (!isRecord(parsed) || parsed.version !== 1) throw new Error("Unknown vault format.");
  if (
    typeof parsed.iv !== "string" ||
    typeof parsed.tag !== "string" ||
    typeof parsed.data !== "string"
  ) {
    throw new Error("The vault file is incomplete.");
  }
  const decipher = NodeCrypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(parsed.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(parsed.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(parsed.data, "base64")),
    decipher.final(),
  ]).toString("utf8");
  const payload: unknown = JSON.parse(plaintext);
  if (!isRecord(payload) || !Array.isArray(payload.entries)) {
    throw new Error("The vault payload is incomplete.");
  }
  return payload.entries.flatMap((entry: unknown): VaultEntry[] => {
    if (!isRecord(entry)) return [];
    if (
      typeof entry.fake !== "string" ||
      typeof entry.original !== "string" ||
      typeof entry.kind !== "string"
    ) {
      return [];
    }
    return [{ fake: entry.fake, original: entry.original, kind: entry.kind as VaultEntry["kind"] }];
  });
};

const resolveUpstream = (request: NodeHttp.IncomingMessage, url: URL): string | undefined => {
  const header = request.headers["x-codeitlab-upstream"];
  const fromHeader = Array.isArray(header) ? header[0] : header;
  const candidates = [fromHeader, url.searchParams.get("upstream") ?? undefined];
  for (const candidate of candidates) {
    if (candidate === undefined || candidate.length === 0) continue;
    const parsed = parseUpstream(candidate);
    if (parsed !== undefined) return parsed;
  }
  const encoded = /^\/upstream\/([A-Za-z0-9_-]+)(\/.*)?$/.exec(url.pathname);
  if (encoded?.[1]) {
    const decoded = parseUpstream(Buffer.from(encoded[1], "base64url").toString("utf8"));
    if (decoded !== undefined) return decoded;
  }
  return undefined;
};

const parseUpstream = (value: string): string | undefined => {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
};

const requestPath = (url: URL, upstream: string): string => {
  const base = new URL(upstream);
  const prefix = base.pathname.replace(/\/$/, "");
  const path = url.pathname.startsWith("/upstream/")
    ? url.pathname.split("/").slice(3).join("/") || ""
    : url.pathname;
  const search = new URLSearchParams(url.searchParams);
  search.delete("upstream");
  const query = search.toString();
  return `${prefix}/${path.replace(/^\//, "")}${query.length > 0 ? `?${query}` : ""}`;
};

const readRequestBody = (
  request: NodeHttp.IncomingMessage,
): Effect.Effect<string, CodeItLabServiceError> =>
  Effect.tryPromise({
    try: (signal) =>
      new Promise<string>((resolve, reject) => {
        const chunks: Buffer[] = [];
        let size = 0;
        const onAbort = () => reject(new Error("The request was cancelled."));
        signal.addEventListener("abort", onAbort, { once: true });
        request.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BODY_BYTES) {
            reject(new Error("The request body is too large for the credentials gateway."));
            request.destroy();
            return;
          }
          chunks.push(chunk);
        });
        request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        request.on("error", reject);
      }),
    catch: (cause) =>
      serviceError("credentials.gateway", "Could not read the request body.", cause),
  });

const writeJson = (response: NodeHttp.ServerResponse, status: number, body: unknown): void => {
  if (response.headersSent) return;
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
};

export interface CredentialsServiceHandle {
  readonly service: CredentialsServiceTag["Service"];
  /** Close the gateway; registered as the layer finalizer. */
  readonly close: Effect.Effect<void>;
}

export const makeCredentialsService = Effect.fn("codeitlab.credentials.service.make")(function* (
  deps: CredentialsServiceDeps,
) {
  const dir = deps.path.join(deps.stateDir, CREDENTIALS_DIR);
  yield* deps.fs
    .makeDirectory(dir, { recursive: true })
    .pipe(
      Effect.mapError((cause) =>
        serviceError("credentials.init", "Could not create the credentials directory.", cause),
      ),
    );

  const keyPath = deps.path.join(dir, VAULT_KEY_FILE);
  const keyHex = yield* Effect.gen(function* () {
    const existing = yield* deps.fs.readFileString(keyPath).pipe(Effect.option);
    if (Option.isSome(existing) && /^[0-9a-f]{64}$/.test(existing.value.trim())) {
      return existing.value.trim();
    }
    const generated = NodeCrypto.randomBytes(32).toString("hex");
    yield* deps.fs.writeFileString(keyPath, generated);
    yield* deps.fs.chmod(keyPath, 0o600);
    return generated;
  }).pipe(
    Effect.mapError((cause) =>
      serviceError("credentials.init", "Could not prepare the local vault key.", cause),
    ),
  );
  const vaultKey = Buffer.from(keyHex, "hex");
  const fakeKey = sha256Hex(`${keyHex}:fakes`);

  const vault = new CredentialVault();
  const vaultPath = deps.path.join(dir, VAULT_FILE);
  const loadedVault = yield* deps.fs.readFileString(vaultPath).pipe(Effect.option);
  if (Option.isSome(loadedVault)) {
    yield* Effect.sync(() => {
      vault.load(decryptVault(vaultKey, loadedVault.value));
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("CodeItLab could not open the credentials vault; starting empty.", {
          cause,
        }),
      ),
    );
  }

  const saveVault = () =>
    writeFileStringAtomically({
      filePath: vaultPath,
      contents: encryptVault(vaultKey, vault.entries()),
    }).pipe(
      Effect.provideService(FileSystem.FileSystem, deps.fs),
      Effect.provideService(Path.Path, deps.path),
      Effect.catchCause((cause) =>
        Effect.logWarning("CodeItLab could not persist the credentials vault.", { cause }),
      ),
    );

  const modelPath = deps.path.join(dir, MODEL_FILE);
  const initialModel = yield* Effect.gen(function* () {
    const downloaded = yield* deps.fs.readFileString(modelPath).pipe(Effect.option);
    if (Option.isNone(downloaded)) {
      return {
        model: bundledCredentialModel(),
        state: "bundled",
      } satisfies ModelState;
    }
    return yield* Effect.sync(
      () =>
        ({
          model: parseCredentialModel(downloaded.value),
          state: "ready",
          path: modelPath,
          sha256: sha256Hex(downloaded.value),
        }) satisfies ModelState,
    ).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("CodeItLab ignored an unreadable credentials model file.", {
          cause,
        }).pipe(
          Effect.as({
            model: bundledCredentialModel(),
            state: "bundled",
            detail: "The downloaded model file was unreadable; the bundled model is in use.",
          } satisfies ModelState),
        ),
      ),
    );
  });

  const modelRef = yield* Ref.make<ModelState>(initialModel);
  const countersRef = yield* Ref.make<Counters>({ scanned: 0, maskedValues: 0, blocked: 0 });
  const auditRef = yield* Ref.make<ReadonlyArray<CodeItLabCredentialsAuditEntry>>([]);
  const gatewayRef = yield* Ref.make<NodeHttp.Server | undefined>(undefined);

  const engineOptions = (settings: CodeItLabCredentialsSettings): CredentialsEngineOptions => ({
    mode: settings.mode,
    privateTag: settings.privateTag,
    maskPersonalData: settings.maskPersonalData,
    fakeKey,
  });

  const withModel = Effect.fn("codeitlab.credentials.withModel")(
    (settings: CodeItLabCredentialsSettings): Effect.Effect<CredentialsEngineOptions> =>
      Ref.get(modelRef).pipe(
        Effect.map((state) => ({ ...engineOptions(settings), model: state.model })),
      ),
  );

  const recordActivity = Effect.fn("codeitlab.credentials.recordActivity")(function* (
    settings: CodeItLabCredentialsSettings,
    target: string,
    findings: ReadonlyArray<{
      kind: CodeItLabCredentialsFindingKind;
      source: CodeItLabCredentialsFindingSource;
    }>,
    blocked: boolean,
  ) {
    const at = DateTime.formatIso(DateTime.nowUnsafe());
    yield* Ref.update(countersRef, (counters) => ({
      scanned: counters.scanned + 1,
      maskedValues: counters.maskedValues + findings.length,
      blocked: counters.blocked + (blocked ? 1 : 0),
      lastActivityAt: at,
    }));
    if (findings.length === 0 && !blocked) return;
    const kinds = [...new Set(findings.map((finding) => finding.kind))];
    const entry: CodeItLabCredentialsAuditEntry = {
      id: `cred_${NodeCrypto.randomUUID()}`,
      at,
      target,
      findings: findings.length,
      kinds,
      blocked,
    };
    const limit = Math.max(1, Math.min(settings.auditLimit || DEFAULT_AUDIT_LIMIT, 5000));
    yield* Ref.update(auditRef, (entries) => [...entries, entry].slice(-limit));
  });

  const modelStatus = (state: ModelState): CodeItLabCredentialsModel => ({
    id: state.model.id || CREDENTIALS_DEFAULT_MODEL_ID,
    label: "CodeItLab Tiny Credentials",
    version: state.model.version,
    sizeBytes: state.model.sizeBytes,
    state: state.state,
    ...(state.path === undefined ? {} : { path: state.path }),
    ...(state.sha256 === undefined ? {} : { sha256: state.sha256 }),
    ...(state.detail === undefined ? {} : { detail: state.detail }),
  });

  const status = Effect.fn("codeitlab.credentials.status")(function* () {
    const settings = yield* deps.readSettings;
    const counters = yield* Ref.get(countersRef);
    const modelState = yield* Ref.get(modelRef);
    const audit = yield* Ref.get(auditRef);
    const gateway = yield* Ref.get(gatewayRef);
    const limit = Math.max(1, Math.min(settings.auditLimit || DEFAULT_AUDIT_LIMIT, 5000));
    return {
      enabled: settings.enabled,
      running: gateway !== undefined,
      port: settings.gatewayPort,
      gatewayUrl: `http://${GATEWAY_HOST}:${settings.gatewayPort}/v1`,
      mode: settings.mode,
      privateTag: settings.privateTag,
      model: modelStatus(modelState),
      scanned: counters.scanned,
      maskedValues: counters.maskedValues,
      blocked: counters.blocked,
      ...(counters.lastActivityAt === undefined ? {} : { lastActivityAt: counters.lastActivityAt }),
      audit: audit.slice(-limit),
    } satisfies CodeItLabCredentialsStatus;
  });

  const scan = Effect.fn("codeitlab.credentials.scan")(function* (
    input: CodeItLabCredentialsScanInput,
  ) {
    const settings = yield* deps.readSettings;
    const options = yield* withModel(
      input.mode === undefined ? settings : { ...settings, mode: input.mode },
    );
    const result = maskText(input.text, options, vault);
    const blocked =
      result.blocked ||
      (settings.blockOnModelFlag && result.findings.some((finding) => finding.source === "model"));
    yield* saveVault();
    yield* recordActivity(settings, input.target ?? "preview", result.findings, blocked);
    return {
      masked: result.masked,
      findings: result.findings,
      blocked,
      privateBlocks: result.privateBlocks,
      modelUsed: result.modelUsed,
    } satisfies CodeItLabCredentialsScanResult;
  });

  const restore = Effect.fn("codeitlab.credentials.restore")(
    (input: { readonly text: string }): Effect.Effect<CodeItLabCredentialsRestoreResult> =>
      Effect.sync(() => {
        const result = vault.restore(input.text);
        return {
          text: result.text,
          restored: result.restored,
        } satisfies CodeItLabCredentialsRestoreResult;
      }),
  );

  const stop = Effect.fn("codeitlab.credentials.stop")(function* () {
    const server = yield* Ref.get(gatewayRef);
    if (server !== undefined) {
      yield* Effect.callback<void>((resume) => {
        server.close(() => resume(Effect.void));
      });
      yield* Ref.set(gatewayRef, undefined);
    }
    return yield* status();
  });

  const gatewayRequestImpl = Effect.fn("codeitlab.credentials.gatewayRequest")(function* (
    request: NodeHttp.IncomingMessage,
    response: NodeHttp.ServerResponse,
  ) {
    const settings = yield* deps.readSettings;
    const url = new URL(request.url ?? "/", `http://${GATEWAY_HOST}:${settings.gatewayPort}`);
    if (!isGatewayHostAllowed(request.headers.host)) {
      writeJson(response, 403, {
        error: {
          message:
            "The credentials gateway only answers requests addressed to 127.0.0.1 or localhost.",
          type: "codeitlab_gateway_host_rejected",
        },
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/health") {
      const modelState = yield* Ref.get(modelRef);
      writeJson(response, 200, {
        ok: true,
        service: "codeitlab-credentials",
        enabled: settings.enabled,
        mode: settings.mode,
        model: { id: modelState.model.id, version: modelState.model.version },
      });
      return;
    }

    const upstream = resolveUpstream(request, url);
    if (upstream === undefined) {
      writeJson(response, 400, {
        error: {
          message:
            "CodeItLab needs to know where to forward this request. Set the x-codeitlab-upstream header (or ?upstream=) to the provider base URL, e.g. https://api.anthropic.com.",
          type: "codeitlab_upstream_required",
        },
      });
      return;
    }

    const bodyText = yield* readRequestBody(request);
    const options = yield* withModel(settings);
    const contentType = String(request.headers["content-type"] ?? "");
    let outbound = bodyText;
    let findings: ReadonlyArray<{
      kind: CodeItLabCredentialsFindingKind;
      source: CodeItLabCredentialsFindingSource;
    }> = [];
    let blocked = false;
    if (bodyText.length > 0) {
      if (contentType.includes("json")) {
        const parsed = yield* Effect.sync(() => {
          try {
            return JSON.parse(bodyText) as unknown;
          } catch {
            return undefined;
          }
        });
        if (parsed !== undefined) {
          const masked = maskValue(parsed, options, vault);
          outbound = JSON.stringify(masked.value);
          findings = masked.findings;
          blocked = masked.blocked;
        } else {
          const masked = maskText(bodyText, options, vault);
          outbound = masked.masked;
          findings = masked.findings;
          blocked = masked.blocked;
        }
      } else {
        const masked = maskText(bodyText, options, vault);
        outbound = masked.masked;
        findings = masked.findings;
        blocked = masked.blocked;
      }
    }

    blocked =
      blocked ||
      (settings.blockOnModelFlag && findings.some((finding) => finding.source === "model"));

    yield* saveVault();
    yield* recordActivity(settings, "gateway", findings, blocked);

    if (blocked) {
      writeJson(response, 403, {
        error: {
          message:
            "CodeItLab blocked this request: it contains a /private block and the private tag behaviour is set to block.",
          type: "codeitlab_private_block",
        },
      });
      return;
    }

    const target = `${upstream}${requestPath(url, upstream)}`;
    const forwardHeaders: Record<string, string> = {};
    for (const [name, value] of Object.entries(request.headers)) {
      if (value === undefined) continue;
      const lower = name.toLowerCase();
      if (lower === "host" || lower === "content-length" || lower === "x-codeitlab-upstream") {
        continue;
      }
      forwardHeaders[lower] = Array.isArray(value) ? value.join(", ") : value;
    }

    const upstreamResponse = yield* Effect.tryPromise({
      try: (signal) =>
        fetch(target, {
          ...(request.method === undefined ? {} : { method: request.method }),
          headers: forwardHeaders,
          ...(request.method === "GET" || request.method === "HEAD" ? {} : { body: outbound }),
          signal,
        }),
      catch: (cause) =>
        serviceError(
          "credentials.gateway",
          "The credentials gateway could not reach the provider.",
          cause,
        ),
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.sync(() => {
          writeJson(response, 502, {
            error: {
              message: `The credentials gateway could not reach the provider: ${String(cause).slice(0, 200)}`,
              type: "codeitlab_upstream_unreachable",
            },
          });
          return undefined;
        }),
      ),
    );
    if (upstreamResponse === undefined) return;

    const responseHeaders: Record<string, string> = {};
    upstreamResponse.headers.forEach((value, name) => {
      const lower = name.toLowerCase();
      if (
        lower === "content-encoding" ||
        lower === "content-length" ||
        lower === "transfer-encoding" ||
        lower === "connection"
      ) {
        return;
      }
      responseHeaders[lower] = value;
    });
    response.writeHead(upstreamResponse.status, responseHeaders);

    const responseType = upstreamResponse.headers.get("content-type") ?? "";
    if (responseType.includes("text/event-stream") && upstreamResponse.body !== null) {
      const reader = upstreamResponse.body.getReader();
      const decoder = new TextDecoder();
      let pending = "";
      for (;;) {
        const chunk = yield* Effect.tryPromise({
          try: () => reader.read(),
          catch: (cause) =>
            serviceError("credentials.gateway", "Reading the provider stream failed.", cause),
        });
        if (chunk.done) break;
        pending += decoder.decode(chunk.value, { stream: true });
        const flushAt = Math.max(0, pending.length - RESTORE_LOOKBEHIND);
        if (flushAt > 0) {
          const safe = pending.slice(0, flushAt);
          pending = pending.slice(flushAt);
          response.write(vault.restore(safe).text);
        }
      }
      pending += decoder.decode();
      response.write(vault.restore(pending).text);
      response.end();
      return;
    }

    const text = yield* Effect.tryPromise({
      try: () => upstreamResponse.text(),
      catch: (cause) =>
        serviceError("credentials.gateway", "Reading the provider response failed.", cause),
    });
    response.end(vault.restore(text).text);
  });

  const handleGatewayRequest = (
    request: NodeHttp.IncomingMessage,
    response: NodeHttp.ServerResponse,
  ) =>
    gatewayRequestImpl(request, response).pipe(
      Effect.catchCause((cause) =>
        Effect.sync(() => {
          if (response.headersSent) {
            response.end();
            return;
          }
          writeJson(response, 500, {
            error: {
              message: `The credentials gateway failed: ${String(cause).slice(0, 200)}`,
              type: "codeitlab_gateway_error",
            },
          });
        }),
      ),
    );

  const start = Effect.fn("codeitlab.credentials.start")(function* () {
    const settings = yield* deps.readSettings;
    const existing = yield* Ref.get(gatewayRef);
    if (existing !== undefined) return yield* status();
    const runtimeContext = yield* Effect.context<never>();
    const runPromise = Effect.runPromiseWith(runtimeContext);
    const server = NodeHttp.createServer((request, response) => {
      void runPromise(handleGatewayRequest(request, response)).catch(() => {
        writeJson(response, 500, {
          error: {
            message: "The credentials gateway failed.",
            type: "codeitlab_gateway_error",
          },
        });
      });
    });
    yield* Effect.callback<void, CodeItLabServiceError>((resume) => {
      const onError = (error: Error) =>
        resume(
          Effect.fail(
            serviceError(
              "credentials.start",
              `Could not start the local credentials gateway on ${GATEWAY_HOST}:${settings.gatewayPort}.`,
              error,
            ),
          ),
        );
      server.once("error", onError);
      server.listen(settings.gatewayPort, GATEWAY_HOST, () => {
        server.off("error", onError);
        resume(Effect.void);
      });
      return Effect.sync(() => {
        server.close();
      });
    });
    yield* Ref.set(gatewayRef, server);
    return yield* status();
  });

  const update = Effect.fn("codeitlab.credentials.update")(function* (
    next: CodeItLabCredentialsSettings,
  ) {
    yield* deps.writeSettings(next);
    const existing = yield* Ref.get(gatewayRef);
    if (!next.enabled && existing !== undefined) return yield* stop();
    if (next.enabled && existing === undefined) return yield* start();
    if (next.enabled && existing !== undefined) {
      // A port change restarts the listener; anything else is live already.
      const address = existing.address();
      const port = typeof address === "object" && address !== null ? address.port : undefined;
      if (port !== next.gatewayPort) {
        yield* stop();
        return yield* start();
      }
    }
    return yield* status();
  });

  const downloadModel = Effect.fn("codeitlab.credentials.downloadModel")(function* () {
    const settings = yield* deps.readSettings;
    const url =
      deps.modelDownloadUrl ??
      process.env["CODEITLAB_CREDENTIALS_MODEL_URL"] ??
      CREDENTIALS_MODEL_DOWNLOAD_URL;
    const fetchText = deps.fetchText;
    if (fetchText === undefined) {
      return yield* Effect.fail(
        serviceError(
          "credentials.model",
          "This build has no model downloader; the bundled model is in use.",
        ),
      );
    }
    yield* Ref.update(modelRef, (state) => ({ ...state, state: "downloading" as const }));
    const downloaded = yield* fetchText(url).pipe(
      Effect.catchCause((cause) =>
        Ref.update(modelRef, (state) => ({
          ...state,
          state: state.state === "downloading" ? ("bundled" as const) : state.state,
          detail: `Could not download the model update: ${String(cause).slice(0, 200)}`,
        })).pipe(
          Effect.andThen(
            Effect.fail(
              serviceError(
                "credentials.model",
                `Could not download the credentials model from ${url}.`,
                cause,
              ),
            ),
          ),
        ),
      ),
    );
    const model = yield* Effect.try({
      try: () => parseCredentialModel(downloaded),
      catch: (cause) =>
        serviceError("credentials.model", "The downloaded model file is not valid.", cause),
    }).pipe(
      Effect.catchCause((cause) =>
        Ref.update(modelRef, (state) => ({
          ...state,
          state: "bundled" as const,
          detail: "The downloaded model file was not valid; the bundled model is in use.",
        })).pipe(
          Effect.andThen(
            Effect.fail(
              serviceError(
                "credentials.model",
                "The downloaded credentials model file is not valid.",
                cause,
              ),
            ),
          ),
        ),
      ),
    );
    yield* writeFileStringAtomically({ filePath: modelPath, contents: downloaded }).pipe(
      Effect.provideService(FileSystem.FileSystem, deps.fs),
      Effect.provideService(Path.Path, deps.path),
      Effect.mapError((cause) =>
        serviceError("credentials.model", "Could not save the downloaded model.", cause),
      ),
    );
    const state: ModelState = {
      model,
      state: "ready",
      path: modelPath,
      sha256: sha256Hex(downloaded),
    };
    yield* Ref.set(modelRef, state);
    yield* Effect.logInfo("CodeItLab downloaded a credentials model update.", {
      version: model.version,
      sizeBytes: model.sizeBytes,
      settings: settings.modelId,
    });
    return modelStatus(state);
  });

  const programEnvironment = Effect.fn("codeitlab.credentials.programEnvironment")(function* () {
    const settings = yield* deps.readSettings;
    if (!settings.exposeKeywordsToPrograms) return {};
    return maskedEnvironmentRecord(maskedEnvironment(vault.entries()));
  });

  const service = CredentialsServiceTag.of({
    status: status(),
    update,
    scan,
    restore,
    start: start(),
    stop: stop(),
    downloadModel: downloadModel(),
    programEnvironment: programEnvironment(),
  });

  const close = Effect.gen(function* () {
    const server = yield* Ref.get(gatewayRef);
    if (server === undefined) return;
    yield* Effect.callback<void>((resume) => {
      server.close(() => resume(Effect.void));
    });
    yield* Ref.set(gatewayRef, undefined);
  });

  return { service, close };
});

export const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const settings = yield* ServerSettings.ServerSettingsService;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const httpClient = yield* HttpClient.HttpClient;

  const readSettings = settings.getSettings.pipe(
    Effect.map((current) => current.codeitlab.credentials),
    Effect.orElseSucceed(() => DEFAULT_CODEITLAB_SETTINGS.credentials),
  );
  const writeSettings = Effect.fn("codeitlab.credentials.writeSettings")(
    (next: CodeItLabCredentialsSettings) =>
      Effect.gen(function* () {
        const current = yield* settings.getSettings;
        yield* settings.updateSettings({ codeitlab: { ...current.codeitlab, credentials: next } });
      }).pipe(
        Effect.mapError(
          (cause) =>
            new CodeItLabServiceError({
              operation: "credentials.update",
              message: "Could not save the credentials settings.",
              cause,
            }),
        ),
      ),
  );

  const fetchText = (url: string): Effect.Effect<string, CodeItLabServiceError> =>
    httpClient.get(url).pipe(
      Effect.timeout("20 seconds"),
      Effect.flatMap((response) => response.text),
      Effect.mapError((cause) =>
        serviceError("credentials.model", `Fetching ${url} failed.`, cause),
      ),
    );

  return yield* makeCredentialsService({
    stateDir: config.stateDir,
    fs,
    path,
    readSettings,
    writeSettings,
    fetchText,
    ...(process.env["CODEITLAB_CREDENTIALS_MODEL_URL"] === undefined
      ? {}
      : { modelDownloadUrl: process.env["CODEITLAB_CREDENTIALS_MODEL_URL"] }),
  });
});

export const layer = Layer.effect(
  CredentialsServiceTag,
  Effect.gen(function* () {
    const handle = yield* make;
    yield* Effect.addFinalizer(() => handle.close);
    // A proxy that was enabled keeps running after a restart; one that failed to
    // bind must not stop the server, so the failure is logged and reported.
    yield* Effect.gen(function* () {
      const current = yield* handle.service.status;
      if (!current.enabled) return;
      yield* handle.service.start.pipe(
        Effect.catch((cause) =>
          Effect.logWarning("The CodeItLab credentials gateway could not start.", { cause }),
        ),
      );
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("Reading the credentials settings at startup failed.", { cause }),
      ),
    );
    return handle.service;
  }),
);
