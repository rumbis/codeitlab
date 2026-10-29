/**
 * Fills a local marketplace database with readable demo data so the local
 * website can be clicked through: approved vibe-coder studios, business
 * accounts and open jobs. Development only; it refuses to touch a database
 * that already has approved coders unless --force is passed.
 */
import { openDatabase } from "../src/server/db.ts";

const dbPath = process.env.MARKETPLACE_DB ?? "/tmp/mkt-local.sqlite";
const force = process.argv.includes("--force");
// Going through openDatabase applies the migrations, so seeding works on a
// fresh checkout without starting the server first just to create the schema.
const db = openDatabase(dbPath);
const now = new Date("2026-10-29T00:00:00.000Z");
const iso = (offsetDays: number) => new Date(now.getTime() - offsetDays * 86_400_000).toISOString();

const existing = db.prepare("SELECT COUNT(*) AS n FROM coder_profiles").get() as { n: number };
if (existing.n > 0 && !force) {
  console.log("[seed] already has " + existing.n + " coder profiles; pass --force to add anyway");
  process.exit(0);
}

const insertAccount = db.prepare(
  "INSERT INTO accounts (id, email, role, created_at) VALUES (?, ?, ?, ?)",
);
const insertCoder = db.prepare(
  "INSERT INTO coder_profiles (id, account_id, display_name, headline, bio, skills, availability, rate_min_cents, rate_max_cents, currency, timezone, links, approved, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)",
);
const insertBusiness = db.prepare(
  "INSERT INTO business_profiles (id, account_id, company_name, website, about, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
);
const insertJob = db.prepare(
  "INSERT INTO jobs (id, business_id, title, description, skills, budget_min_cents, budget_max_cents, currency, timeline, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
);

const studios = [
  [
    "001",
    "Aegean Vibe Studio",
    "Two-person studio shipping AI-built web apps",
    "We take an idea to a working product in two weeks: React, TypeScript, Effect on the server. We work in the open and hand over the repository.",
    "TypeScript, React, Effect, Node",
    "full_time",
    6000,
    12000,
    "Europe/Nicosia",
  ],
  [
    "002",
    "Kyrenia Digital",
    "Small agency for shops and restaurants",
    "Websites, booking flows and payment integration for small local businesses. We keep the stack boring so the owner can maintain it.",
    "Astro, WordPress, Stripe, SEO",
    "part_time",
    4000,
    9000,
    "Europe/Nicosia",
  ],
  [
    "003",
    "Larnaca Mobile Lab",
    "React Native apps for field teams",
    "Offline-first mobile apps for delivery and field-service teams, with a small admin web app behind them.",
    "React Native, Expo, SQLite, TypeScript",
    "full_time",
    7000,
    15000,
    "Europe/Nicosia",
  ],
  [
    "004",
    "Troodos Automation",
    "Automation and internal tools",
    "We replace spreadsheets with small tools: scripts, dashboards, and scheduled jobs. Fast turnaround, fixed scope.",
    "Python, TypeScript, SQLite, Docker",
    "weekends",
    3500,
    8000,
    "Europe/Nicosia",
  ],
  [
    "005",
    "Limassol Product Co",
    "Product design and frontend",
    "Design systems and frontend work for funded startups. We build with coding agents and review every diff ourselves.",
    "React, Tailwind, Design systems, Figma",
    "part_time",
    5500,
    11000,
    "Europe/Nicosia",
  ],
  [
    "006",
    "Paphos Data Works",
    "Data pipelines and reporting",
    "ETL, reporting and small analytics stacks for companies that outgrew their spreadsheets.",
    "Python, dbt, Postgres, BI",
    "full_time",
    8000,
    16000,
    "Europe/Nicosia",
  ],
] as const;

for (const [n, name, headline, bio, skills, availability, minC, maxC, tz] of studios) {
  const accountId = "acc_studio_" + n;
  const coderId = "cod_studio_" + n;
  insertAccount.run(accountId, "studio" + n + "@example.test", "coder", iso(30));
  insertCoder.run(
    coderId,
    accountId,
    name,
    headline,
    bio,
    skills,
    availability,
    minC,
    maxC,
    "EUR",
    tz,
    "",
    iso(30),
    iso(3),
  );
}

const companies = [
  [
    "001",
    "Harbour Books",
    "https://example.test/harbour",
    "Independent bookshop chain with five stores.",
  ],
  [
    "002",
    "Nicosia Dental Group",
    "https://example.test/dental",
    "Three dental clinics that need online booking.",
  ],
  [
    "003",
    "Blue Coast Rentals",
    "https://example.test/bluecoast",
    "Car and apartment rentals along the coast.",
  ],
] as const;

for (const [n, company, website, about] of companies) {
  const accountId = "acc_biz_" + n;
  insertAccount.run(accountId, "business" + n + "@example.test", "business", iso(20));
  insertBusiness.run("biz_" + n, accountId, company, website, about, iso(20), iso(5));
}

const jobs = [
  [
    "001",
    "Online booking for three dental clinics",
    "We need a booking flow with availability per clinic, reminders by email, and a simple admin view for the reception staff.",
    "TypeScript, React, Postgres",
    300000,
    700000,
    "4-6 weeks",
  ],
  [
    "002",
    "Bookshop stock lookup on the website",
    "Show stock levels per store on our WordPress site, refreshed every 15 minutes from the till system.",
    "WordPress, PHP, REST",
    120000,
    250000,
    "2-3 weeks",
  ],
  [
    "003",
    "Rental fleet dashboard",
    "An internal dashboard showing which car is where, what is due back, and which booking needs attention.",
    "React, TypeScript, SQLite",
    250000,
    500000,
    "3-4 weeks",
  ],
  [
    "002",
    "Automated patient reminders",
    "A scheduled job that sends reminder emails and an SMS the day before an appointment.",
    "Python, Cron, Email",
    80000,
    180000,
    "2 weeks",
  ],
] as const;

let jobIndex = 0;
for (const [biz, title, description, skills, minC, maxC, timeline] of jobs) {
  jobIndex += 1;
  insertJob.run(
    "job_" + String(jobIndex).padStart(3, "0"),
    "acc_biz_" + biz,
    title,
    description,
    skills,
    minC,
    maxC,
    "EUR",
    timeline,
    "open",
    iso(10 - jobIndex),
  );
}

console.log(
  "[seed] wrote " +
    studios.length +
    " coder studios, " +
    companies.length +
    " companies, " +
    jobs.length +
    " open jobs",
);
