import { afterEach, describe, expect, it } from "vite-plus/test";

import type { Engagement } from "../src/shared/contracts.ts";
import {
  approveCoder,
  createCoderProfile,
  createJob,
  createTestApp,
  type SignedIn,
  type TestApp,
} from "./helpers.ts";

interface TokenPayload {
  readonly token: string;
  readonly id: string;
  readonly label: string;
  readonly createdAt: string;
}

interface TokenSummary {
  readonly id: string;
  readonly label: string;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
}

interface TokenList {
  readonly tokens: TokenSummary[];
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

async function createToken(app: TestApp, cookie: string, label?: string): Promise<TokenPayload> {
  const created = await app.json<TokenPayload>("/api/auth/tokens", {
    method: "POST",
    cookie,
    body: label === undefined ? {} : { label },
  });
  expect(created.response.status).toBe(201);
  return created.body;
}

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

/** A business with a funded engagement, so a bearer token has real data to read. */
async function world(app: TestApp): Promise<{
  readonly business: SignedIn;
  readonly coder: SignedIn;
  readonly engagementId: string;
}> {
  const business = await app.signIn("owner@tokens.test", "business");
  const coder = await app.signIn("coder@tokens.test", "coder");
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
  return { business, coder, engagementId: created.body.engagement.id };
}

describe("account API tokens", () => {
  it("returns the raw token once and only metadata afterwards", async () => {
    const app = newApp();
    const person = await app.signIn("person@tokens.test", "coder");

    const created = await createToken(app, person.cookie, "  Desktop app  ");
    expect(created.token).toMatch(/^mk_[A-Za-z0-9_-]{43}$/u);
    expect(created.label).toBe("Desktop app");
    expect(created.createdAt).toBe(app.now().toISOString());

    const listed = await app.json<TokenList>("/api/auth/tokens", { cookie: person.cookie });
    expect(listed.response.status).toBe(200);
    expect(listed.body.count).toBe(1);
    expect(listed.body.tokens[0]).toEqual({
      id: created.id,
      label: "Desktop app",
      createdAt: created.createdAt,
      lastUsedAt: null,
    });
    const serialized = JSON.stringify(listed.body);
    expect(serialized).not.toContain(created.token);
    expect(serialized).not.toContain("token_hash");

    const second = await createToken(app, person.cookie, "CLI");
    const newestFirst = await app.json<TokenList>("/api/auth/tokens", { cookie: person.cookie });
    expect(newestFirst.body.tokens.map((token) => token.label)).toEqual(["CLI", "Desktop app"]);
    expect(newestFirst.body.tokens[1]?.id).toBe(created.id);
    expect(newestFirst.body.tokens[0]?.id).toBe(second.id);
  });

  it("defaults the label and rejects an empty or over-long one", async () => {
    const app = newApp();
    const person = await app.signIn("person@tokens.test", "coder");

    const defaulted = await createToken(app, person.cookie);
    expect(defaulted.label).toBe("CodeItLab");

    for (const label of ["   ", "x".repeat(61)]) {
      const rejected = await app.json<{ error: string }>("/api/auth/tokens", {
        method: "POST",
        cookie: person.cookie,
        body: { label },
      });
      expect(rejected.response.status).toBe(400);
      expect(rejected.body.error).toBe("invalid_label");
    }
  });

  it("reads account endpoints with a bearer token instead of a cookie", async () => {
    const app = newApp();
    const { business, coder, engagementId } = await world(app);
    const token = await createToken(app, business.cookie, "Desktop app");

    const engagements = await app.json<{ engagements: Engagement[]; count: number }>(
      "/api/engagements",
      { headers: bearer(token.token) },
    );
    expect(engagements.response.status).toBe(200);
    expect(engagements.body.engagements.map((engagement) => engagement.id)).toEqual([engagementId]);

    // The token's use is recorded, so the owner can see a credential still in use.
    const listed = await app.json<TokenList>("/api/auth/tokens", { cookie: business.cookie });
    expect(listed.body.tokens[0]?.lastUsedAt).toBe(app.now().toISOString());

    // The messages API accepts the same bearer token on either side.
    const coderToken = await createToken(app, coder.cookie);
    const posted = await app.json<{ message: { id: string; body: string } }>(
      `/api/engagements/${engagementId}/messages`,
      { method: "POST", headers: bearer(coderToken.token), body: { body: "Sent with a token." } },
    );
    expect(posted.response.status).toBe(201);
    expect(posted.body.message.body).toBe("Sent with a token.");
  });

  it("rejects a revoked token and stops listing it", async () => {
    const app = newApp();
    const person = await app.signIn("person@tokens.test", "coder");
    const token = await createToken(app, person.cookie);

    const revoked = await app.request(`/api/auth/tokens/${token.id}`, {
      method: "DELETE",
      cookie: person.cookie,
    });
    expect(revoked.status).toBe(200);
    expect(((await revoked.json()) as { revoked: boolean }).revoked).toBe(true);

    const denied = await app.request("/api/engagements", { headers: bearer(token.token) });
    expect(denied.status).toBe(401);
    expect(((await denied.json()) as { error: string }).error).toBe("unauthorized");

    const listed = await app.json<TokenList>("/api/auth/tokens", { cookie: person.cookie });
    expect(listed.body.count).toBe(0);

    const again = await app.request(`/api/auth/tokens/${token.id}`, {
      method: "DELETE",
      cookie: person.cookie,
    });
    expect(again.status).toBe(404);
    expect(((await again.json()) as { error: string }).error).toBe("token_not_found");
  });

  it("rejects an unknown bearer token and still requires auth without one", async () => {
    const app = newApp();
    for (const headers of [bearer("mk_not-a-real-token"), { authorization: "Bearer" }]) {
      const denied = await app.request("/api/engagements", { headers });
      expect(denied.status).toBe(401);
      expect(((await denied.json()) as { error: string }).error).toBe("unauthorized");
    }
    expect((await app.request("/api/engagements")).status).toBe(401);
  });

  it("cannot revoke another account's token", async () => {
    const app = newApp();
    const owner = await app.signIn("owner@tokens.test", "coder");
    const other = await app.signIn("other@tokens.test", "coder");
    const token = await createToken(app, owner.cookie);

    const attempt = await app.request(`/api/auth/tokens/${token.id}`, {
      method: "DELETE",
      cookie: other.cookie,
    });
    expect(attempt.status).toBe(404);
    expect(((await attempt.json()) as { error: string }).error).toBe("token_not_found");

    expect((await app.request("/api/engagements", { headers: bearer(token.token) })).status).toBe(
      200,
    );
  });

  it("revokes tokens when the account is deleted through the app", async () => {
    const app = newApp();
    const person = await app.signIn("delete@tokens.test", "coder");
    const token = await createToken(app, person.cookie);

    const deleted = await app.request("/api/me/delete", {
      method: "POST",
      cookie: person.cookie,
      body: { confirm: "delete" },
    });
    expect(deleted.status).toBe(200);

    const row = app.app.db.prepare("SELECT COUNT(*) AS n FROM api_tokens").get() as { n: number };
    expect(Number(row.n)).toBe(0);
    expect((await app.request("/api/engagements", { headers: bearer(token.token) })).status).toBe(
      401,
    );
  });

  it("deletes tokens with the account row (ON DELETE CASCADE)", async () => {
    const app = newApp();
    const person = await app.signIn("cascade@tokens.test", "coder");
    const token = await createToken(app, person.cookie);

    // The account-deletion flow anonymises the row rather than deleting it, so
    // the cascade is exercised against the row the foreign key points at.
    app.app.db.prepare("DELETE FROM accounts WHERE id = ?").run(person.account.id);

    const row = app.app.db.prepare("SELECT COUNT(*) AS n FROM api_tokens").get() as { n: number };
    expect(Number(row.n)).toBe(0);
    expect((await app.request("/api/engagements", { headers: bearer(token.token) })).status).toBe(
      401,
    );
  });

  // The app calls applying "apply"; the job page calls it "interests". Both
  // have to reach the same record or interest declared in the app is lost.
  it("lets a coder apply from the app with a bearer token", async () => {
    const app = newApp();
    const business = await app.signIn("poster@apply.test", "business");
    const coder = await app.signIn("applier@apply.test", "coder");
    const profile = await createCoderProfile(app, coder.cookie, {
      displayName: "Ada",
      skills: "TypeScript",
    });
    await approveCoder(app, profile.id);
    const job = await createJob(app, business.cookie, { skills: "TypeScript" });
    const token = await createToken(app, coder.cookie);

    const applied = await app.request(`/api/jobs/${job.id}/apply`, {
      method: "POST",
      headers: bearer(token.token),
      body: { message: "Interested, from the app." },
    });

    expect(applied.status).toBe(201);
    // Only the poster can read a job's applications, which is also how the
    // business sees interest the coder declared from the app.
    const listed = await app.json<{ count: number; interests: { message: string }[] }>(
      `/api/jobs/${job.id}/interests`,
      { cookie: business.cookie },
    );
    expect(listed.body.count).toBe(1);
    expect(listed.body.interests[0]?.message).toBe("Interested, from the app.");
  });
});
