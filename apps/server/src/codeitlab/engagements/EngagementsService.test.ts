import { describe, expect } from "vite-plus/test";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { HttpClient } from "effect/http";
import * as TestClock from "effect/testing/TestClock";

import type { CodeItLabServiceError } from "@codeitlab/contracts";

import {
  makeEngagementsService,
  makeHttpJson,
  type EngagementsServiceDeps,
} from "./EngagementsService.ts";

/**
 * The bridge is all client: these tests inject the HTTP call and the vault, so
 * no test opens a socket or writes a real token. What is pinned here is the
 * honest state machine: unconfigured means read-only with a reason, a refused
 * request never looks like an empty list, and nothing is sent when the bridge is
 * read-only.
 */

interface Call {
  readonly method: "GET" | "POST";
  readonly url: string;
  readonly token: string;
  readonly body?: unknown;
}

const NOW = Date.parse("2026-10-25T12:00:00.000Z");

interface WorkspaceFake {
  readonly cwd: string;
  readonly title: string;
  readonly modelSelection?: { readonly instanceId: string; readonly model: string } | null;
}

interface HandoffFake {
  readonly summary: string;
  readonly body: string;
}

interface FilesFake {
  readonly isRepo: boolean;
  readonly files: ReadonlyArray<{ path: string; insertions: number; deletions: number }>;
  readonly insertions: number;
  readonly deletions: number;
  readonly branch: string | null;
}

function service(input: {
  readonly url?: string;
  readonly enabled?: boolean;
  readonly token?: string | null;
  readonly respond?: (call: Call) => { readonly status: number; readonly text: string } | Error;
  readonly workspace?: WorkspaceFake | null;
  readonly files?: FilesFake;
  /** Injected text generation: records what the handoff asked for. */
  readonly handoff?: (input: {
    readonly cwd: string;
    readonly engagementTitle: string;
    readonly deliveryNote: string;
    readonly amountLabel: string;
    readonly modelSelection: { readonly instanceId: string; readonly model: string };
  }) => Effect.Effect<HandoffFake, CodeItLabServiceError>;
}) {
  const calls: Call[] = [];
  const written: Array<{ url: string; enabled: boolean }> = [];
  const tokens: Array<string | null> = [];
  let currentToken = input.token === undefined ? null : input.token;
  const deps: EngagementsServiceDeps = {
    readSettings: Effect.succeed({
      url: input.url ?? "",
      enabled: input.enabled ?? true,
    }),
    writeSettings: (next) =>
      Effect.sync(() => {
        written.push({ url: next.url, enabled: next.enabled });
      }),
    readToken: Effect.sync(() => currentToken),
    writeToken: (token) =>
      Effect.sync(() => {
        tokens.push(token);
        currentToken = token;
      }),
    nowMs: Effect.succeed(NOW),
    resolveThreadWorkspace: () =>
      Effect.succeed(
        input.workspace === undefined
          ? { cwd: "/work/repo", title: "Checkout thread" }
          : input.workspace,
      ),
    readDeliveryFiles: () =>
      Effect.succeed(
        input.files ?? {
          isRepo: true,
          files: [
            { path: "src/checkout.ts", insertions: 40, deletions: 3 },
            { path: "src/checkout.test.ts", insertions: 90, deletions: 0 },
          ],
          insertions: 130,
          deletions: 3,
          branch: "feat/checkout",
        },
      ),
    ...(input.handoff === undefined ? {} : { generateHandoff: input.handoff }),
    httpJson: (call) => {
      calls.push(call);
      const result = (input.respond ?? (() => ({ status: 200, text: "{}" })))(call);
      return result instanceof Error
        ? Effect.fail({
            _tag: "CodeItLabServiceError",
            operation: "engagements.request",
            message: result.message,
          } as never)
        : Effect.succeed(result);
    },
  };
  return { service: makeEngagementsService(deps), calls, written, tokens };
}

const listBody = JSON.stringify({
  engagements: [
    {
      id: "eng-1",
      jobTitle: "Ship the checkout rewrite",
      role: "coder",
      counterpartName: "Acme Ltd",
      status: "in_progress",
      amountCents: 120000,
      currency: "USD",
      updatedAt: "2026-10-24T09:00:00.000Z",
    },
  ],
});

describe("bridge state", () => {
  it.effect("is read-only and says why when no URL is configured", () =>
    Effect.gen(function* () {
      const bridge = yield* service({}).service.bridge;
      expect(bridge.readOnly).toBe(true);
      expect(bridge.reason).toContain("marketplace URL");
      expect(bridge.url).toBe("");
    }),
  );

  it.effect("is read-only when the URL exists but the vault has no token", () =>
    Effect.gen(function* () {
      const bridge = yield* service({ url: "https://acme.example/market", token: null }).service
        .bridge;
      expect(bridge.configured).toBe(false);
      expect(bridge.reason).toContain("API token");
    }),
  );

  it.effect("is read-only when the user has not opted in", () =>
    Effect.gen(function* () {
      const bridge = yield* service({
        url: "https://acme.example/market",
        token: "mk_abc",
        enabled: false,
      }).service.bridge;
      expect(bridge.configured).toBe(true);
      expect(bridge.readOnly).toBe(true);
      expect(bridge.reason).toContain("turned off");
    }),
  );

  it.effect("is usable when URL, token and opt-in are all present", () =>
    Effect.gen(function* () {
      const bridge = yield* service({ url: "https://acme.example/market", token: "mk_abc" }).service
        .bridge;
      expect(bridge).toMatchObject({
        url: "https://acme.example/market",
        configured: true,
        tokenPresent: true,
        enabled: true,
        readOnly: false,
        reason: "",
      });
    }),
  );
});

describe("list", () => {
  it.effect("returns an empty read-only list without calling the network", () =>
    Effect.gen(function* () {
      const { service: svc, calls } = service({});
      const result = yield* svc.list;
      expect(result.engagements).toEqual([]);
      expect(result.bridge.readOnly).toBe(true);
      expect(calls).toHaveLength(0);
    }),
  );

  it.effect("maps engagements and derives the next step for the account's role", () =>
    Effect.gen(function* () {
      const { service: svc, calls } = service({
        url: "https://acme.example/market",
        token: "mk_abc",
        respond: () => ({ status: 200, text: listBody }),
      });
      const result = yield* svc.list;
      expect(calls[0]).toMatchObject({
        method: "GET",
        url: "https://acme.example/market/api/engagements",
        token: "mk_abc",
      });
      expect(result.engagements).toHaveLength(1);
      expect(result.engagements[0]).toMatchObject({
        id: "eng-1",
        jobTitle: "Ship the checkout rewrite",
        role: "coder",
        counterpartName: "Acme Ltd",
        status: "in_progress",
        amountCents: 120000,
        nextStep: "Deliver the work with a note and evidence.",
      });
    }),
  );

  it.effect("turns a refused request into a read-only bridge with the status", () =>
    Effect.gen(function* () {
      const { service: svc } = service({
        url: "https://acme.example/market",
        token: "mk_abc",
        respond: () => ({ status: 401, text: JSON.stringify({ message: "Unauthorized." }) }),
      });
      const result = yield* svc.list;
      expect(result.engagements).toEqual([]);
      expect(result.bridge.readOnly).toBe(true);
      expect(result.bridge.reason).toContain("401");
      expect(result.bridge.reason).toContain("Unauthorized.");
    }),
  );

  it.effect("says it could not reach the deployment instead of showing nothing", () =>
    Effect.gen(function* () {
      const { service: svc } = service({
        url: "https://acme.example/market",
        token: "mk_abc",
        respond: () => new Error("ECONNREFUSED"),
      });
      const result = yield* svc.list;
      expect(result.bridge.readOnly).toBe(true);
      expect(result.bridge.reason).toContain("Could not reach");
    }),
  );
});

describe("messages", () => {
  it.effect("passes the cursor through and maps the thread", () =>
    Effect.gen(function* () {
      const { service: svc, calls } = service({
        url: "https://acme.example/market",
        token: "mk_abc",
        respond: () => ({
          status: 200,
          text: JSON.stringify({
            messages: [
              {
                id: "msg-2",
                engagementId: "eng-1",
                authorRole: "business",
                authorName: "Acme Ltd",
                body: "Can you also update the docs?",
                evidence: ["https://acme.example/spec"],
                createdAt: "2026-10-25T10:00:00.000Z",
              },
            ],
          }),
        }),
      });
      const result = yield* svc.messages({ engagementId: "eng-1", after: "msg-1" });
      expect(calls[0]?.url).toBe(
        "https://acme.example/market/api/engagements/eng-1/messages?after=msg-1",
      );
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0]).toMatchObject({
        authorRole: "business",
        body: "Can you also update the docs?",
        evidence: ["https://acme.example/spec"],
      });
    }),
  );

  it.effect("returns an empty read-only thread without a request when unconfigured", () =>
    Effect.gen(function* () {
      const { service: svc, calls } = service({});
      const result = yield* svc.messages({ engagementId: "eng-1" });
      expect(result.messages).toEqual([]);
      expect(result.bridge.readOnly).toBe(true);
      expect(calls).toHaveLength(0);
    }),
  );

  it.effect("refuses an empty engagement id", () =>
    Effect.gen(function* () {
      const error = yield* service({ url: "https://acme.example/market", token: "mk_abc" })
        .service.messages({ engagementId: "  " })
        .pipe(Effect.flip);
      expect(error.message).toContain("engagement id");
    }),
  );
});

describe("postMessage", () => {
  it.effect("does not send an empty message", () =>
    Effect.gen(function* () {
      const { service: svc, calls } = service({
        url: "https://acme.example/market",
        token: "mk_abc",
      });
      // Read through a local name: the unicorn postMessage rule is about window.postMessage.
      const send = svc.postMessage;
      const result = yield* send({ engagementId: "eng-1", body: "   ", evidence: [] });
      expect(result.posted).toBe(false);
      expect(result.reason).toContain("Write a message");
      expect(calls).toHaveLength(0);
    }),
  );

  it.effect("drops evidence that is not an http(s) URL", () =>
    Effect.gen(function* () {
      const { service: svc, calls } = service({
        url: "https://acme.example/market",
        token: "mk_abc",
        respond: () => ({
          status: 201,
          text: JSON.stringify({
            message: {
              id: "msg-3",
              engagementId: "eng-1",
              authorRole: "coder",
              authorName: "You",
              body: "Done.",
              evidence: ["https://acme.example/pr/1"],
              createdAt: "2026-10-25T11:00:00.000Z",
            },
          }),
        }),
      });
      const send = svc.postMessage;
      const result = yield* send({
        engagementId: "eng-1",
        body: "Done.",
        evidence: ["javascript:alert(1)", "https://acme.example/pr/1"],
      });
      expect(result.posted).toBe(true);
      expect(calls[0]?.body).toEqual({ body: "Done.", evidence: ["https://acme.example/pr/1"] });
    }),
  );

  it.effect("reports the marketplace's refusal instead of claiming success", () =>
    Effect.gen(function* () {
      const { service: svc } = service({
        url: "https://acme.example/market",
        token: "mk_abc",
        respond: () => ({ status: 404, text: JSON.stringify({ message: "Not found." }) }),
      });
      const send = svc.postMessage;
      const result = yield* send({ engagementId: "eng-1", body: "Hi", evidence: [] });
      expect(result.posted).toBe(false);
      expect(result.reason).toBe("Not found.");
    }),
  );
});

describe("configure", () => {
  it.effect("refuses a URL that is not http(s)", () =>
    Effect.gen(function* () {
      const error = yield* service({})
        .service.configure({ url: "javascript:alert(1)" })
        .pipe(Effect.flip);
      expect(error.message).toContain("http");
    }),
  );

  it.effect("saves the URL, opts in and stores the token in the vault", () =>
    Effect.gen(function* () {
      const { service: svc, written, tokens } = service({});
      const bridge = yield* svc.configure({
        url: "https://acme.example/market/",
        token: "  mk_new  ",
      });
      expect(written).toEqual([{ url: "https://acme.example/market", enabled: true }]);
      expect(tokens).toEqual(["mk_new"]);
      expect(bridge).toMatchObject({
        configured: true,
        tokenPresent: true,
        enabled: true,
        readOnly: false,
      });
    }),
  );

  it.effect("clears the token when the input is empty", () =>
    Effect.gen(function* () {
      const { service: svc, tokens } = service({
        url: "https://acme.example/market",
        token: "mk_old",
      });
      const bridge = yield* svc.configure({ url: "https://acme.example/market", token: "" });
      expect(tokens).toEqual([null]);
      expect(bridge.tokenPresent).toBe(false);
      expect(bridge.readOnly).toBe(true);
    }),
  );
});

describe("draftDelivery", () => {
  it.effect("composes a note and a handoff from the thread's git facts", () =>
    Effect.gen(function* () {
      const { service: svc, calls } = service({});
      const draft = yield* svc.draftDelivery({
        engagementId: "eng-1",
        threadId: "thread-1",
        jobTitle: "Ship the checkout rewrite",
        amountLabel: "1200.00 USD",
      });
      expect(calls).toHaveLength(0);
      expect(draft.reason).toBe("");
      expect(draft.threadTitle).toBe("Checkout thread");
      expect(draft.fileCount).toBe(2);
      expect(draft.branch).toBe("feat/checkout");
      expect(draft.note).toContain("Delivered: Ship the checkout rewrite");
      expect(draft.note).toContain("- src/checkout.ts (+40 −3)");
      expect(draft.handoff).toContain("1200.00 USD");
      expect(draft.handoff).toContain("What was NOT done");
    }),
  );

  it.effect("says why there is nothing to attach when the thread has no project", () =>
    Effect.gen(function* () {
      const { service: svc } = service({ workspace: null });
      const draft = yield* svc.draftDelivery({ engagementId: "eng-1", threadId: "t" });
      expect(draft.fileCount).toBe(0);
      expect(draft.reason).toContain("not in a project");
    }),
  );

  it.effect("says so when the folder is not a git repository", () =>
    Effect.gen(function* () {
      const { service: svc } = service({
        files: { isRepo: false, files: [], insertions: 0, deletions: 0, branch: null },
      });
      const draft = yield* svc.draftDelivery({ engagementId: "eng-1", threadId: "t" });
      expect(draft.reason).toContain("not a git repository");
    }),
  );

  it.effect("says so when the working tree is clean", () =>
    Effect.gen(function* () {
      const { service: svc } = service({
        files: { isRepo: true, files: [], insertions: 0, deletions: 0, branch: "main" },
      });
      const draft = yield* svc.draftDelivery({ engagementId: "eng-1", threadId: "t" });
      expect(draft.reason).toContain("No changed files");
      expect(draft.branch).toBe("main");
    }),
  );

  it.effect("requires a thread", () =>
    Effect.gen(function* () {
      const error = yield* service({})
        .service.draftDelivery({ engagementId: "eng-1", threadId: " " })
        .pipe(Effect.flip);
      expect(error.message).toContain("thread");
    }),
  );
});

describe("deliver", () => {
  it.effect("refuses an empty note without sending", () =>
    Effect.gen(function* () {
      const { service: svc, calls } = service({
        url: "https://acme.example/market",
        token: "mk_abc",
      });
      const result = yield* svc.deliver({ engagementId: "eng-1", note: "   ", evidence: [] });
      expect(result.delivered).toBe(false);
      expect(result.reason).toContain("delivery note");
      expect(calls).toHaveLength(0);
    }),
  );

  it.effect("refuses more than five evidence links", () =>
    Effect.gen(function* () {
      const { service: svc } = service({ url: "https://acme.example/market", token: "mk_abc" });
      const result = yield* svc.deliver({
        engagementId: "eng-1",
        note: "Done.",
        evidence: [
          "https://a.example/1",
          "https://a.example/2",
          "https://a.example/3",
          "https://a.example/4",
          "https://a.example/5",
          "https://a.example/6",
        ],
      });
      expect(result.delivered).toBe(false);
      expect(result.reason).toContain("at most 5");
    }),
  );

  it.effect("refuses to deliver through a read-only bridge", () =>
    Effect.gen(function* () {
      const { service: svc, calls } = service({});
      const result = yield* svc.deliver({ engagementId: "eng-1", note: "Done.", evidence: [] });
      expect(result.delivered).toBe(false);
      expect(result.bridge.readOnly).toBe(true);
      expect(calls).toHaveLength(0);
    }),
  );

  it.effect("posts the reviewed note and evidence and maps the new status", () =>
    Effect.gen(function* () {
      const { service: svc, calls } = service({
        url: "https://acme.example/market",
        token: "mk_abc",
        respond: () => ({
          status: 200,
          text: JSON.stringify({
            engagement: {
              id: "eng-1",
              jobTitle: "Ship the checkout rewrite",
              role: "coder",
              counterpartName: "Acme Ltd",
              status: "delivered",
              amountCents: 120000,
              currency: "USD",
              updatedAt: "2026-10-25T11:00:00.000Z",
            },
          }),
        }),
      });
      const result = yield* svc.deliver({
        engagementId: "eng-1",
        note: "  Delivered the checkout.  ",
        evidence: ["https://github.com/acme/pr/12"],
      });
      expect(calls[0]).toMatchObject({
        method: "POST",
        url: "https://acme.example/market/api/engagements/eng-1/deliver",
        body: {
          deliveryNote: "Delivered the checkout.",
          deliveryEvidence: ["https://github.com/acme/pr/12"],
        },
      });
      expect(result.delivered).toBe(true);
      expect(result.engagement?.status).toBe("delivered");
      expect(result.engagement?.nextStep).toContain("Wait for the business");
    }),
  );

  it.effect("reports the marketplace's refusal instead of claiming a delivery", () =>
    Effect.gen(function* () {
      const { service: svc } = service({
        url: "https://acme.example/market",
        token: "mk_abc",
        respond: () => ({
          status: 409,
          text: JSON.stringify({ message: "Cannot deliver an engagement that is delivered." }),
        }),
      });
      const result = yield* svc.deliver({ engagementId: "eng-1", note: "Done.", evidence: [] });
      expect(result.delivered).toBe(false);
      expect(result.reason).toBe("Cannot deliver an engagement that is delivered.");
    }),
  );
});

describe("applyToJob", () => {
  it.effect("posts the trimmed message to the job's apply endpoint", () =>
    Effect.gen(function* () {
      const { service: svc, calls } = service({
        url: "https://acme.example/market",
        token: "mk_abc",
        respond: () => ({ status: 200, text: JSON.stringify({ applied: true }) }),
      });
      const result = yield* svc.applyToJob({ jobId: "  job/7 42  ", message: "  I can help.  " });
      expect(calls[0]).toMatchObject({
        method: "POST",
        url: "https://acme.example/market/api/jobs/job%2F7%2042/apply",
        body: { message: "I can help." },
      });
      expect(result.applied).toBe(true);
      expect(result.reason).toBeUndefined();
    }),
  );

  it.effect("sends an empty message when the applicant wrote none", () =>
    Effect.gen(function* () {
      const { service: svc, calls } = service({
        url: "https://acme.example/market",
        token: "mk_abc",
        respond: () => ({ status: 200, text: "" }),
      });
      const result = yield* svc.applyToJob({ jobId: "job-1" });
      expect(calls[0]?.body).toEqual({ message: "" });
      expect(result.applied).toBe(true);
    }),
  );

  it.effect("reports the marketplace's refusal instead of claiming an application", () =>
    Effect.gen(function* () {
      const { service: svc } = service({
        url: "https://acme.example/market",
        token: "mk_abc",
        respond: () => ({
          status: 403,
          text: JSON.stringify({ message: "This job is no longer open." }),
        }),
      });
      const result = yield* svc.applyToJob({ jobId: "job-1" });
      expect(result.applied).toBe(false);
      expect(result.reason).toBe("This job is no longer open.");
    }),
  );

  it.effect("refuses to apply when the marketplace is not configured", () =>
    Effect.gen(function* () {
      const { service: svc, calls } = service({});
      const result = yield* svc.applyToJob({ jobId: "job-1" });
      expect(result).toEqual({ applied: false, reason: "Marketplace not configured." });
      expect(calls).toHaveLength(0);
    }),
  );

  it.effect("refuses to apply without a token", () =>
    Effect.gen(function* () {
      const { service: svc, calls } = service({
        url: "https://acme.example/market",
        token: null,
      });
      const result = yield* svc.applyToJob({ jobId: "job-1" });
      expect(result).toEqual({ applied: false, reason: "Marketplace token not configured." });
      expect(calls).toHaveLength(0);
    }),
  );

  it.effect("refuses a blank job id without sending", () =>
    Effect.gen(function* () {
      const { service: svc, calls } = service({
        url: "https://acme.example/market",
        token: "mk_abc",
      });
      const result = yield* svc.applyToJob({ jobId: "   ", message: "I can help." });
      expect(result).toEqual({ applied: false, reason: "A job id is required." });
      expect(calls).toHaveLength(0);
    }),
  );

  it.effect("reports a marketplace it could not reach", () =>
    Effect.gen(function* () {
      const { service: svc } = service({
        url: "https://acme.example/market",
        token: "mk_abc",
        respond: () => new Error("socket closed"),
      });
      const result = yield* svc.applyToJob({ jobId: "job-1" });
      expect(result).toEqual({ applied: false, reason: "Could not reach marketplace." });
    }),
  );
});

describe("deliveryHandoff", () => {
  const modelSelection = { instanceId: "claude-main", model: "claude-sonnet" };

  it.effect("returns the deterministic handoff with a reason when no model is configured", () =>
    Effect.gen(function* () {
      const { service: svc, calls } = service({
        workspace: { cwd: "/work/repo", title: "Checkout thread", modelSelection },
      });
      const handoff = yield* svc.deliveryHandoff({
        engagementId: "eng-1",
        threadId: "thread-1",
        jobTitle: "Ship the checkout rewrite",
      });
      expect(calls).toHaveLength(0);
      expect(handoff.generated).toBe(false);
      expect(handoff.model).toBeNull();
      expect(handoff.reason).toContain("no text generation");
      expect(handoff.body).toBe(handoff.draft.handoff);
      expect(handoff.summary).toContain("Checkout thread");
    }),
  );

  it.effect("asks the model with the delivery facts and keeps its answer", () =>
    Effect.gen(function* () {
      const seen: Array<{
        readonly cwd: string;
        readonly engagementTitle: string;
        readonly deliveryNote: string;
        readonly amountLabel: string;
        readonly modelSelection: { readonly instanceId: string; readonly model: string };
      }> = [];
      const { service: svc } = service({
        workspace: { cwd: "/work/repo", title: "Checkout thread", modelSelection },
        handoff: (input) => {
          seen.push(input);
          return Effect.succeed({
            summary: "The checkout rewrite is ready for you to try",
            body: "## What was built\nA new checkout.\n\n## What was NOT done\nNothing was deployed.",
          });
        },
      });
      const handoff = yield* svc.deliveryHandoff({
        engagementId: "eng-1",
        threadId: "thread-1",
        jobTitle: "Ship the checkout rewrite",
        amountLabel: "1200.00 USD",
      });

      expect(handoff.generated).toBe(true);
      expect(handoff.model).toBe("claude-sonnet");
      expect(handoff.reason).toBe("");
      expect(handoff.summary).toBe("The checkout rewrite is ready for you to try");
      expect(handoff.body).toContain("## What was NOT done");
      expect(handoff.draft.fileCount).toBe(2);
      expect(seen).toHaveLength(1);
      expect(seen[0]?.engagementTitle).toBe("Ship the checkout rewrite");
      expect(seen[0]?.deliveryNote).toContain("- src/checkout.ts (+40 −3)");
      expect(seen[0]?.amountLabel).toBe("1200.00 USD");
      expect(seen[0]?.cwd).toBe("/work/repo");
      expect(seen[0]?.modelSelection).toEqual(modelSelection);
    }),
  );

  it.effect("falls back to the deterministic handoff when the model fails", () =>
    Effect.gen(function* () {
      const { service: svc } = service({
        workspace: { cwd: "/work/repo", title: "Checkout thread", modelSelection },
        handoff: () =>
          Effect.fail({
            _tag: "CodeItLabServiceError",
            operation: "engagements.deliveryHandoff",
            message: "The model could not write the handoff.",
          } as never),
      });
      const handoff = yield* svc.deliveryHandoff({
        engagementId: "eng-1",
        threadId: "thread-1",
      });

      expect(handoff.generated).toBe(false);
      expect(handoff.reason).toContain("could not write the handoff");
      expect(handoff.body).toContain("What was NOT done");
    }),
  );

  it.effect("does not ask a model when the thread has no model selection", () =>
    Effect.gen(function* () {
      let asked = 0;
      const { service: svc } = service({
        workspace: { cwd: "/work/repo", title: "Checkout thread", modelSelection: null },
        handoff: () => {
          asked += 1;
          return Effect.succeed({ summary: "x", body: "y" });
        },
      });
      const handoff = yield* svc.deliveryHandoff({
        engagementId: "eng-1",
        threadId: "thread-1",
      });

      expect(asked).toBe(0);
      expect(handoff.generated).toBe(false);
      expect(handoff.reason).toContain("No model is selected");
    }),
  );

  it.effect("uses the composer's selection when it is passed", () =>
    Effect.gen(function* () {
      const seen: Array<{ readonly model: string }> = [];
      const { service: svc } = service({
        workspace: { cwd: "/work/repo", title: "Checkout thread", modelSelection: null },
        handoff: (input) => {
          seen.push({ model: input.modelSelection.model });
          return Effect.succeed({ summary: "s", body: "b" });
        },
      });
      yield* svc.deliveryHandoff({
        engagementId: "eng-1",
        threadId: "thread-1",
        modelSelection: { instanceId: "codex-main", model: "gpt-5" },
      });

      expect(seen).toEqual([{ model: "gpt-5" }]);
    }),
  );
});

describe("marketplace transport", () => {
  it.effect("gives up on a marketplace that never answers", () =>
    Effect.gen(function* () {
      const httpJson = makeHttpJson(HttpClient.make(() => Effect.never));
      const fiber = yield* httpJson({
        method: "GET",
        url: "https://acme.example/market/api/engagements",
        token: "mk_abc",
        timeoutMs: 10_000,
      }).pipe(Effect.flip, Effect.forkChild({ startImmediately: true }));
      // Let the forked request register its timer before the clock moves.
      yield* Effect.yieldNow;
      yield* TestClock.adjust("11 seconds");

      const error = yield* Fiber.join(fiber);
      expect(error.message).toBe("Could not reach the marketplace.");
    }),
  );
});
