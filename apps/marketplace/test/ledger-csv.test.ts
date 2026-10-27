import { afterEach, describe, expect, it } from "vite-plus/test";

import { csvCell, toCsv } from "../src/server/csv.ts";
import {
  approveCoder,
  createCoderProfile,
  createJob,
  createTestApp,
  TEST_ADMIN_TOKEN,
  type SignedIn,
  type TestApp,
} from "./helpers.ts";

let apps: TestApp[] = [];

afterEach(() => {
  for (const app of apps) app.close();
  apps = [];
});

function newApp(): TestApp {
  const app = createTestApp({ autoApprove: true });
  apps.push(app);
  return app;
}

async function paidEngagement(app: TestApp): Promise<void> {
  const business: SignedIn = await app.signIn("owner@csv.test", "business");
  const coder: SignedIn = await app.signIn("coder@csv.test", "coder");
  const profile = await createCoderProfile(app, coder.cookie, {
    displayName: "Ada",
    skills: "TypeScript",
  });
  await approveCoder(app, profile.id);
  const job = await createJob(app, business.cookie, { title: "Export me", skills: "TypeScript" });
  const created = await app.json<{ engagement: { id: string } }>("/api/engagements", {
    method: "POST",
    cookie: business.cookie,
    body: { jobId: job.id, coderId: profile.id, amountCents: 10_000 },
  });
  const id = created.body.engagement.id;
  for (const [action, cookie] of [
    ["accept", coder.cookie],
    ["start", coder.cookie],
  ] as const) {
    await app.request(`/api/engagements/${id}/${action}`, { method: "POST", cookie });
  }
  await app.request(`/api/engagements/${id}/deliver`, {
    method: "POST",
    cookie: coder.cookie,
    form: { deliveryNote: "Shipped.", deliveryEvidence: "https://ada.example/proof" },
  });
  await app.request(`/api/engagements/${id}/approve`, { method: "POST", cookie: business.cookie });
}

describe("ledger CSV export", () => {
  it("quotes cells and neutralises spreadsheet formulas", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell(1200)).toBe("1200");
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-1")).toBe("'-1");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell('a "quote", and a comma')).toBe('"a ""quote"", and a comma"');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
    expect(toCsv(["a", "b"], [["x", 1]])).toBe("a,b\r\nx,1\r\n");
  });

  it("exports every ledger row as an attachment, admin only", async () => {
    const app = newApp();
    await paidEngagement(app);

    expect((await app.request("/api/admin/ledger.csv")).status).toBe(401);
    const response = await app.request("/api/admin/ledger.csv", {
      headers: { authorization: `Bearer ${TEST_ADMIN_TOKEN}` },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="codeitlab-ledger.csv"',
    );
    const csv = await response.text();
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("entry_id,created_at,engagement_id,kind,amount_cents,currency,note");
    expect(lines).toHaveLength(4);
    expect(csv).toContain("charge,10000,EUR");
    expect(csv).toContain("platform_fee,1500,EUR");
    expect(csv).toContain("payout,8500,EUR");

    const page = await (await app.request(`/admin?token=${TEST_ADMIN_TOKEN}`)).text();
    expect(page).toContain("Download ledger (CSV)");
  });
});
