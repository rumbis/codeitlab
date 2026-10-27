import { createApp, type AppHandler, type CreateAppOptions } from "../src/server/app.ts";
import type { AccountRole } from "../src/shared/contracts.ts";

export const TEST_ORIGIN = "http://marketplace.test";
export const TEST_ADMIN_TOKEN = "test-admin-token";
export const START_TIME = new Date("2026-01-01T00:00:00.000Z");

export interface SignedIn {
  readonly cookie: string;
  readonly account: { readonly id: string; readonly email: string; readonly role: AccountRole };
  readonly code: string;
}

export interface TestApp {
  readonly app: AppHandler;
  readonly codes: Map<string, string>;
  advance(milliseconds: number): void;
  now(): Date;
  request(path: string, options?: RequestOptions): Promise<Response>;
  json<T>(path: string, options?: RequestOptions): Promise<{ response: Response; body: T }>;
  signIn(email: string, role: AccountRole): Promise<SignedIn>;
  close(): void;
}

export interface RequestOptions {
  readonly method?: string;
  readonly body?: unknown;
  readonly form?: Record<string, string>;
  readonly cookie?: string;
  readonly headers?: Record<string, string>;
}

export function createTestApp(overrides: Partial<CreateAppOptions> = {}): TestApp {
  let current = new Date(START_TIME);
  const codes = new Map<string, string>();

  const app = createApp({
    dbPath: ":memory:",
    adminToken: TEST_ADMIN_TOKEN,
    devEmail: false,
    autoApprove: false,
    now: () => current,
    onDevCode: (email, code) => codes.set(email, code),
    ...overrides,
  });

  async function request(path: string, options: RequestOptions = {}): Promise<Response> {
    const headers = new Headers(options.headers);
    let body: string | undefined;
    if (options.form !== undefined) {
      headers.set("content-type", "application/x-www-form-urlencoded");
      body = new URLSearchParams(options.form).toString();
    } else if (options.body !== undefined) {
      headers.set("content-type", "application/json");
      body = JSON.stringify(options.body);
    }
    if (options.cookie !== undefined) headers.set("cookie", options.cookie);

    return app(
      new Request(`${TEST_ORIGIN}${path}`, {
        method: options.method ?? "GET",
        headers,
        body,
      }),
    );
  }

  return {
    app,
    codes,
    advance: (milliseconds) => {
      current = new Date(current.getTime() + milliseconds);
    },
    now: () => new Date(current),
    request,
    async json<T>(path: string, options: RequestOptions = {}) {
      const response = await request(path, options);
      const text = await response.text();
      return { response, body: (text === "" ? null : JSON.parse(text)) as T };
    },
    async signIn(email, role) {
      const requested = await request("/api/auth/request-code", {
        method: "POST",
        body: { email, role },
      });
      if (requested.status !== 200) {
        throw new Error(
          `request-code failed for ${email}: ${requested.status} ${await requested.text()}`,
        );
      }
      const code = codes.get(email);
      if (code === undefined) throw new Error(`no dev code captured for ${email}`);

      const verified = await request("/api/auth/verify", {
        method: "POST",
        body: { email, code },
      });
      const payload = (await verified.json()) as {
        account: { id: string; email: string; role: AccountRole };
      };
      if (verified.status !== 200)
        throw new Error(`verify failed for ${email}: ${verified.status}`);
      const cookie = cookieHeader(verified);
      if (cookie === "") throw new Error(`verify did not set a session cookie for ${email}`);
      return { cookie, account: payload.account, code };
    },
    close: () => app.close(),
  };
}

export function cookieHeader(response: Response): string {
  const cookies = setCookies(response);
  const first = cookies[0];
  if (first === undefined) return "";
  return first.split(";")[0] ?? "";
}

export function setCookies(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  const single = response.headers.get("set-cookie");
  return single === null ? [] : [single];
}

export interface CoderProfileInput {
  readonly displayName: string;
  readonly headline?: string;
  readonly bio?: string;
  readonly skills: string;
  readonly interests?: string;
  readonly skillLevels?: string;
  readonly evidence?: string;
  readonly availability?: string;
  readonly rateMinCents?: number;
  readonly rateMaxCents?: number;
  readonly currency?: string;
  readonly timezone?: string;
  readonly links?: string;
}

export async function createCoderProfile(
  testApp: TestApp,
  cookie: string,
  input: CoderProfileInput,
): Promise<{ id: string; approved: boolean; displayName: string }> {
  const { response, body } = await testApp.json<{
    coder: { id: string; approved: boolean; displayName: string };
  }>("/api/coders/profile", {
    method: "POST",
    cookie,
    body: {
      displayName: input.displayName,
      headline: input.headline ?? "Product engineer",
      bio:
        input.bio ??
        "I build small, reliable web products end to end, from schema to interface, and ship them.",
      skills: input.skills,
      interests: input.interests ?? "",
      skillLevels: input.skillLevels ?? "",
      evidence: input.evidence ?? "",
      availability: input.availability ?? "full_time",
      rateMinCents: input.rateMinCents ?? 5000,
      rateMaxCents: input.rateMaxCents ?? 8000,
      currency: input.currency ?? "EUR",
      timezone: input.timezone ?? "Europe/Berlin",
      links: input.links ?? "",
    },
  });
  if (response.status !== 200) {
    throw new Error(`coder profile failed: ${response.status} ${JSON.stringify(body)}`);
  }
  return body.coder;
}

export async function approveCoder(testApp: TestApp, coderId: string): Promise<void> {
  const response = await testApp.request(`/api/admin/coders/${coderId}/approve`, {
    method: "POST",
    headers: { authorization: `Bearer ${TEST_ADMIN_TOKEN}` },
  });
  if (response.status !== 200) {
    throw new Error(`approve coder failed: ${response.status} ${await response.text()}`);
  }
}

export interface JobInput {
  readonly title?: string;
  readonly description?: string;
  readonly skills: string;
  readonly category?: string;
  readonly budgetMinCents?: number;
  readonly budgetMaxCents?: number;
  readonly currency?: string;
  readonly timeline?: string;
  readonly assisted?: boolean;
}

export async function createJob(
  testApp: TestApp,
  cookie: string,
  input: JobInput,
): Promise<{ id: string; title: string; status: string; budgetMaxCents: number }> {
  const { response, body } = await testApp.json<{
    job: { id: string; title: string; status: string; budgetMaxCents: number };
  }>("/api/jobs", {
    method: "POST",
    cookie,
    body: {
      title: input.title ?? "Build a booking flow",
      description:
        input.description ??
        "Build a booking flow with availability, payments and a confirmation email for a small studio.",
      skills: input.skills,
      category: input.category ?? "other",
      budgetMinCents: input.budgetMinCents ?? 5000,
      budgetMaxCents: input.budgetMaxCents ?? 10_000,
      currency: input.currency ?? "EUR",
      timeline: input.timeline ?? "2–3 weeks",
      ...(input.assisted === true ? { assisted: "on" } : {}),
    },
  });
  if (response.status !== 201) {
    throw new Error(`create job failed: ${response.status} ${JSON.stringify(body)}`);
  }
  return body.job;
}
