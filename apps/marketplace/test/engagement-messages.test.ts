import { afterEach, describe, expect, it } from "vite-plus/test";

import type { Engagement } from "../src/shared/contracts.ts";
import type { EngagementMessage } from "../src/server/engagementMessages.ts";
import {
  approveCoder,
  createCoderProfile,
  createJob,
  createTestApp,
  type SignedIn,
  type TestApp,
} from "./helpers.ts";

interface World {
  readonly business: SignedIn;
  readonly coder: SignedIn;
  readonly jobTitle: string;
  readonly engagementId: string;
}

interface MessagePayload {
  readonly message: EngagementMessage;
}

interface MessageList {
  readonly messages: EngagementMessage[];
  readonly count: number;
}

let apps: TestApp[] = [];

afterEach(() => {
  for (const app of apps) app.close();
  apps = [];
});

function newApp(overrides: Parameters<typeof createTestApp>[0] = {}): TestApp {
  const app = createTestApp({ autoApprove: true, ...overrides });
  apps.push(app);
  return app;
}

async function world(app: TestApp): Promise<World> {
  const business = await app.signIn("owner@messages.test", "business");
  const saved = await app.request("/api/business/profile", {
    method: "POST",
    cookie: business.cookie,
    body: { companyName: "Acme Studio" },
  });
  expect(saved.status).toBe(200);

  const coder = await app.signIn("coder@messages.test", "coder");
  const profile = await createCoderProfile(app, coder.cookie, {
    displayName: "Ada",
    skills: "TypeScript",
  });
  await approveCoder(app, profile.id);
  const job = await createJob(app, business.cookie, {
    skills: "TypeScript",
    budgetMaxCents: 20_000,
  });
  await app.request(`/api/jobs/${job.id}/interests`, {
    method: "POST",
    cookie: coder.cookie,
    body: { message: "I can ship this." },
  });
  const created = await app.json<{ engagement: Engagement }>("/api/engagements", {
    method: "POST",
    cookie: business.cookie,
    body: { jobId: job.id, coderId: profile.id, amountCents: 12_000 },
  });
  expect(created.response.status).toBe(201);
  return { business, coder, jobTitle: job.title, engagementId: created.body.engagement.id };
}

function postMessage(
  app: TestApp,
  cookie: string,
  engagementId: string,
  body: Record<string, unknown>,
): Promise<{ response: Response; body: MessagePayload }> {
  return app.json<MessagePayload>(`/api/engagements/${engagementId}/messages`, {
    method: "POST",
    cookie,
    body,
  });
}

function readMessages(
  app: TestApp,
  cookie: string,
  engagementId: string,
  after?: string,
): Promise<{ response: Response; body: MessageList }> {
  const query = after === undefined ? "" : `?after=${encodeURIComponent(after)}`;
  return app.json<MessageList>(`/api/engagements/${engagementId}/messages${query}`, { cookie });
}

async function postError(
  app: TestApp,
  cookie: string,
  engagementId: string,
  body: Record<string, unknown>,
): Promise<{ status: number; error: string }> {
  const response = await app.request(`/api/engagements/${engagementId}/messages`, {
    method: "POST",
    cookie,
    body,
  });
  const payload = (await response.json()) as { error: string };
  return { status: response.status, error: payload.error };
}

describe("engagement messages", () => {
  it("lets both sides post and read in order, before the work starts", async () => {
    const app = newApp();
    const { business, coder, engagementId } = await world(app);

    const first = await postMessage(app, coder.cookie, engagementId, {
      body: "  Hello — I can start Monday.  ",
    });
    expect(first.response.status).toBe(201);
    expect(first.body.message.engagementId).toBe(engagementId);
    expect(first.body.message.authorRole).toBe("coder");
    expect(first.body.message.authorName).toBe("Ada");
    expect(first.body.message.body).toBe("Hello — I can start Monday.");
    expect(first.body.message.evidence).toEqual([]);
    expect(first.body.message.createdAt).toBe(app.now().toISOString());

    const second = await postMessage(app, business.cookie, engagementId, {
      body: "Great. The repo is ready for you.",
    });
    expect(second.response.status).toBe(201);
    expect(second.body.message.authorRole).toBe("business");
    expect(second.body.message.authorName).toBe("Acme Studio");

    for (const cookie of [coder.cookie, business.cookie]) {
      const listed = await readMessages(app, cookie, engagementId);
      expect(listed.response.status).toBe(200);
      expect(listed.body.count).toBe(2);
      expect(listed.body.messages.map((message) => message.id)).toEqual([
        first.body.message.id,
        second.body.message.id,
      ]);
      expect(listed.body.messages.map((message) => message.body)).toEqual([
        "Hello — I can start Monday.",
        "Great. The repo is ready for you.",
      ]);
    }
  });

  it("hides the thread from a third account and from unknown ids", async () => {
    const app = newApp();
    const { coder, engagementId } = await world(app);
    const third = await app.signIn("third@messages.test", "coder");

    const read = await app.request(`/api/engagements/${engagementId}/messages`, {
      cookie: third.cookie,
    });
    expect(read.status).toBe(404);
    expect(((await read.json()) as { error: string }).error).toBe("engagement_not_found");

    const written = await app.request(`/api/engagements/${engagementId}/messages`, {
      method: "POST",
      cookie: third.cookie,
      body: { body: "Let me in." },
    });
    expect(written.status).toBe(404);

    const unknown = await app.request("/api/engagements/not-a-real-id/messages", {
      cookie: coder.cookie,
    });
    expect(unknown.status).toBe(404);
    expect(((await unknown.json()) as { error: string }).error).toBe("engagement_not_found");

    expect((await app.request(`/api/engagements/${engagementId}/messages`)).status).toBe(401);
  });

  it("rejects an empty or over-long message body", async () => {
    const app = newApp();
    const { coder, engagementId } = await world(app);

    for (const body of ["", "   ", "x".repeat(4_001)]) {
      const rejected = await postError(app, coder.cookie, engagementId, { body });
      expect(rejected.status).toBe(400);
      expect(rejected.error).toBe("invalid_body");
    }
  });

  it("round-trips evidence links and rejects non-http(s) or too many", async () => {
    const app = newApp();
    const { coder, business, engagementId } = await world(app);

    const posted = await postMessage(app, coder.cookie, engagementId, {
      body: "Proof attached.",
      evidence: ["https://github.com/example/repo/pull/12", "https://staging.example.com"],
    });
    expect(posted.response.status).toBe(201);
    expect(posted.body.message.evidence).toEqual([
      "https://github.com/example/repo/pull/12",
      "https://staging.example.com/",
    ]);

    const listed = await readMessages(app, business.cookie, engagementId);
    expect(listed.body.messages[0]?.evidence).toEqual(posted.body.message.evidence);

    const fromForm = await app.request(`/api/engagements/${engagementId}/messages`, {
      method: "POST",
      cookie: business.cookie,
      form: {
        body: "Two links from the no-JS form.",
        evidence: "https://example.com/a\nhttps://example.com/b",
      },
    });
    expect(fromForm.status).toBe(303);
    const afterForm = await readMessages(app, coder.cookie, engagementId);
    expect(afterForm.body.messages[1]?.evidence).toEqual([
      "https://example.com/a",
      "https://example.com/b",
    ]);

    const tooMany = Array.from({ length: 11 }, (_, index) => `https://example.com/${index}`);
    for (const evidence of [["ftp://example.com/file"], tooMany]) {
      const rejected = await postError(app, coder.cookie, engagementId, {
        body: "Bad links.",
        evidence,
      });
      expect(rejected.status).toBe(400);
      expect(rejected.error).toBe("invalid_evidence");
    }
  });

  it("returns only messages newer than the cursor", async () => {
    const app = newApp();
    const { coder, engagementId } = await world(app);

    const ids: string[] = [];
    for (const body of ["One", "Two", "Three"]) {
      const posted = await postMessage(app, coder.cookie, engagementId, { body });
      expect(posted.response.status).toBe(201);
      ids.push(posted.body.message.id);
    }

    const firstId = ids[0];
    const lastId = ids[2];
    if (firstId === undefined || lastId === undefined) throw new Error("missing message ids");

    const afterFirst = await readMessages(app, coder.cookie, engagementId, firstId);
    expect(afterFirst.body.messages.map((message) => message.body)).toEqual(["Two", "Three"]);
    const afterLast = await readMessages(app, coder.cookie, engagementId, lastId);
    expect(afterLast.body.messages).toEqual([]);

    const unknownCursor = await readMessages(app, coder.cookie, engagementId, "not-a-message");
    expect(unknownCursor.response.status).toBe(400);
    expect((unknownCursor.body as unknown as { error: string }).error).toBe("invalid_cursor");
  });

  it("keeps the conversation open after delivery", async () => {
    const app = newApp();
    const { coder, business, engagementId } = await world(app);

    for (const action of ["accept", "start", "deliver"] as const) {
      const moved = await app.request(`/api/engagements/${engagementId}/${action}`, {
        method: "POST",
        cookie: coder.cookie,
      });
      expect(moved.status).toBe(200);
    }

    const delivered = await postMessage(app, coder.cookie, engagementId, {
      body: "Delivered — here is the handover.",
    });
    expect(delivered.response.status).toBe(201);
    const reply = await postMessage(app, business.cookie, engagementId, {
      body: "Thanks, reviewing now.",
    });
    expect(reply.response.status).toBe(201);

    const listed = await readMessages(app, business.cookie, engagementId);
    expect(listed.body.count).toBe(2);
    expect(listed.body.messages.map((message) => message.authorRole)).toEqual([
      "coder",
      "business",
    ]);
  });

  it("adds role, job title and counterpart to the engagement list", async () => {
    const app = newApp();
    const { business, coder, jobTitle, engagementId } = await world(app);

    const asBusiness = await app.json<{
      engagements: (Engagement & { role: string; jobTitle: string; counterpartName: string })[];
    }>("/api/engagements", { cookie: business.cookie });
    const businessItem = asBusiness.body.engagements.find(
      (engagement) => engagement.id === engagementId,
    );
    expect(businessItem?.role).toBe("business");
    expect(businessItem?.jobTitle).toBe(jobTitle);
    expect(businessItem?.counterpartName).toBe("Ada");

    const asCoder = await app.json<{
      engagements: (Engagement & { role: string; jobTitle: string; counterpartName: string })[];
    }>("/api/engagements", { cookie: coder.cookie });
    const coderItem = asCoder.body.engagements.find((engagement) => engagement.id === engagementId);
    expect(coderItem?.role).toBe("coder");
    expect(coderItem?.jobTitle).toBe(jobTitle);
    expect(coderItem?.counterpartName).toBe("Acme Studio");
  });
});
