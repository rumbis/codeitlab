import * as NodeSqlite from "node:sqlite";

export type Db = NodeSqlite.DatabaseSync;

/**
 * Schema history. Each migration runs once inside a transaction and the version
 * is recorded, so opening an existing file is a no-op and opening a new one
 * builds the current schema. Never edit a shipped migration: append a new one.
 */
const MIGRATIONS: readonly { readonly version: number; readonly sql: string }[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE accounts (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        role TEXT NOT NULL CHECK (role IN ('coder', 'business')),
        created_at TEXT NOT NULL
      );

      CREATE TABLE auth_codes (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        code_salt TEXT NOT NULL,
        code_hash TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        consumed_at TEXT,
        expires_at TEXT NOT NULL,
        request_ip TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX auth_codes_account_idx ON auth_codes (account_id, created_at);
      CREATE INDEX auth_codes_ip_idx ON auth_codes (request_ip, created_at);

      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE INDEX sessions_account_idx ON sessions (account_id);

      CREATE TABLE coder_profiles (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
        display_name TEXT NOT NULL,
        headline TEXT NOT NULL,
        bio TEXT NOT NULL,
        skills TEXT NOT NULL,
        availability TEXT NOT NULL CHECK (
          availability IN ('full_time', 'part_time', 'weekends', 'not_available')
        ),
        rate_min_cents INTEGER NOT NULL CHECK (rate_min_cents >= 0),
        rate_max_cents INTEGER NOT NULL CHECK (rate_max_cents >= rate_min_cents),
        currency TEXT NOT NULL,
        timezone TEXT NOT NULL,
        links TEXT NOT NULL,
        approved INTEGER NOT NULL DEFAULT 0 CHECK (approved IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE business_profiles (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
        company_name TEXT NOT NULL,
        website TEXT NOT NULL,
        about TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE jobs (
        id TEXT PRIMARY KEY,
        business_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        skills TEXT NOT NULL,
        budget_min_cents INTEGER NOT NULL CHECK (budget_min_cents >= 0),
        budget_max_cents INTEGER NOT NULL CHECK (budget_max_cents >= budget_min_cents),
        currency TEXT NOT NULL,
        timeline TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('open', 'matched', 'closed')),
        created_at TEXT NOT NULL
      );
      CREATE INDEX jobs_business_idx ON jobs (business_id, created_at);
      CREATE INDEX jobs_status_idx ON jobs (status, created_at);

      CREATE TABLE interests (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        coder_id TEXT NOT NULL REFERENCES coder_profiles(id) ON DELETE CASCADE,
        message TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (job_id, coder_id)
      );
      CREATE INDEX interests_job_idx ON interests (job_id, created_at);

      CREATE TABLE engagements (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id),
        coder_id TEXT NOT NULL REFERENCES coder_profiles(id),
        business_id TEXT NOT NULL REFERENCES accounts(id),
        amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
        fee_cents INTEGER NOT NULL CHECK (fee_cents >= 0),
        payout_cents INTEGER NOT NULL CHECK (payout_cents >= 0),
        currency TEXT NOT NULL,
        status TEXT NOT NULL CHECK (
          status IN ('requested', 'accepted', 'in_progress', 'delivered', 'approved', 'paid_out', 'cancelled', 'disputed')
        ),
        payment_ref TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX engagements_job_idx ON engagements (job_id);
      CREATE INDEX engagements_coder_idx ON engagements (coder_id, created_at);
      CREATE INDEX engagements_business_idx ON engagements (business_id, created_at);

      CREATE TABLE ledger_entries (
        id TEXT PRIMARY KEY,
        engagement_id TEXT NOT NULL REFERENCES engagements(id),
        kind TEXT NOT NULL CHECK (kind IN ('charge', 'platform_fee', 'payout', 'refund')),
        amount_cents INTEGER NOT NULL,
        currency TEXT NOT NULL,
        note TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX ledger_engagement_idx ON ledger_entries (engagement_id, created_at);
      CREATE INDEX ledger_kind_idx ON ledger_entries (kind);
    `,
  },
  {
    // A job may only ever have one live engagement. Before this index the
    // "already engaged" check was a read-then-write race: two concurrent
    // creates both passed the SELECT and both charged the business. The
    // partial index makes the database the arbiter.
    version: 2,
    sql: `
      CREATE UNIQUE INDEX engagements_active_job_idx
        ON engagements (job_id)
        WHERE status <> 'cancelled';
    `,
  },
  {
    // Interests + declared skill depth turn "I can do it" into "I want it and I
    // am good at it". Jobs gain the field so the two can be compared.
    version: 3,
    sql: `
      ALTER TABLE coder_profiles ADD COLUMN interests TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE coder_profiles ADD COLUMN skill_levels TEXT NOT NULL DEFAULT '{}';
      ALTER TABLE coder_profiles ADD COLUMN evidence TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE jobs ADD COLUMN category TEXT NOT NULL DEFAULT 'other';
    `,
  },
  {
    // Fee tiers per engagement (15% standard, 20% assisted) and an idempotent
    // inbox for payment-provider webhooks. The bps is stored on the row so a
    // later default change never rewrites an existing engagement.
    version: 4,
    sql: `
      ALTER TABLE engagements ADD COLUMN fee_bps INTEGER NOT NULL DEFAULT 1500;

      CREATE TABLE payment_events (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        event_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        payload TEXT NOT NULL,
        received_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX payment_events_provider_event_idx
        ON payment_events (provider, event_id);
    `,
  },
  {
    // Delivery evidence: the coder's note and proof links are stored with the
    // engagement, so the business approves what was actually delivered instead
    // of trusting a bare "done" flag.
    version: 5,
    sql: `
      ALTER TABLE engagements ADD COLUMN delivery_note TEXT NOT NULL DEFAULT '';
      ALTER TABLE engagements ADD COLUMN delivery_evidence TEXT NOT NULL DEFAULT '[]';
    `,
  },
  {
    // Dispute resolution is an audited operator action, not a silent status
    // edit: the outcome and the reason stay on the engagement forever.
    version: 6,
    sql: `
      ALTER TABLE engagements ADD COLUMN resolution_outcome TEXT NOT NULL DEFAULT '';
      ALTER TABLE engagements ADD COLUMN resolution_note TEXT NOT NULL DEFAULT '';
    `,
  },
  {
    // Every operator action that moves money or changes who can be hired gets
    // an append-only row. The admin token identifies the role, not a person, so
    // the row records what was done, to what, and why.
    version: 7,
    sql: `
      CREATE TABLE admin_audit (
        id TEXT PRIMARY KEY,
        action TEXT NOT NULL,
        target_id TEXT NOT NULL,
        detail TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX admin_audit_created_idx ON admin_audit (created_at DESC);
    `,
  },
  {
    // In-app activity feed: one row per event the other party must act on.
    // Written in the same transaction as the state change it describes.
    version: 8,
    sql: `
      CREATE TABLE notifications (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id),
        kind TEXT NOT NULL,
        message TEXT NOT NULL,
        href TEXT NOT NULL,
        engagement_id TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        read_at TEXT
      );
      CREATE INDEX notifications_account_idx ON notifications (account_id, created_at DESC);
    `,
  },
  {
    // Durable outbox for pushing activity to an external channel (email gateway,
    // Slack, an internal bot). The webhook is attempted by an operator/cron
    // drain, never on the money path, and every attempt is recorded.
    version: 9,
    sql: `
      CREATE TABLE notification_outbox (
        id TEXT PRIMARY KEY,
        notification_id TEXT NOT NULL,
        url TEXT NOT NULL,
        payload TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT NOT NULL,
        delivered_at TEXT,
        last_error TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
      CREATE INDEX notification_outbox_pending_idx
        ON notification_outbox (delivered_at, next_attempt_at);
    `,
  },
  {
    // Durable mail outbox: a login code must arrive even if the gateway is down.
    version: 10,
    sql: `
      CREATE TABLE email_outbox (
        id TEXT PRIMARY KEY,
        to_email TEXT NOT NULL,
        subject TEXT NOT NULL,
        body TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT NOT NULL,
        delivered_at TEXT,
        last_error TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
      CREATE INDEX email_outbox_pending_idx ON email_outbox (delivered_at, next_attempt_at);
    `,
  },
  {
    // Sliding-window counters for money-path actions (charges, transitions).
    version: 11,
    sql: `
      CREATE TABLE rate_events (
        bucket TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX rate_events_bucket_idx ON rate_events (bucket, created_at);
    `,
  },
  {
    // One verdict per paid engagement, written only by the paying business.
    version: 12,
    sql: `
      CREATE TABLE ratings (
        id TEXT PRIMARY KEY,
        engagement_id TEXT NOT NULL UNIQUE REFERENCES engagements(id),
        coder_id TEXT NOT NULL REFERENCES coder_profiles(id),
        business_id TEXT NOT NULL REFERENCES accounts(id),
        score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
        comment TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
      CREATE INDEX ratings_coder_idx ON ratings (coder_id, created_at);
    `,
  },
  {
    // A business reaching out first: the job in front of a ranked coder.
    version: 13,
    sql: `
      CREATE TABLE job_invites (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id),
        coder_id TEXT NOT NULL REFERENCES coder_profiles(id),
        business_id TEXT NOT NULL REFERENCES accounts(id),
        message TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        UNIQUE (job_id, coder_id)
      );
      CREATE INDEX job_invites_coder_idx ON job_invites (coder_id, created_at);
    `,
  },
  {
    // Assisted jobs: the business asks CodeItLab to help scope and shortlist.
    version: 14,
    sql: `
      ALTER TABLE jobs ADD COLUMN assisted INTEGER NOT NULL DEFAULT 0;
      CREATE TABLE assisted_scopes (
        job_id TEXT PRIMARY KEY REFERENCES jobs(id),
        note TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE assisted_shortlist (
        job_id TEXT NOT NULL REFERENCES jobs(id),
        coder_id TEXT NOT NULL REFERENCES coder_profiles(id),
        created_at TEXT NOT NULL,
        PRIMARY KEY (job_id, coder_id)
      );
    `,
  },
  {
    // Web Push: browser subscriptions and a durable per-notification queue.
    version: 15,
    sql: `
      CREATE TABLE push_subscriptions (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        endpoint TEXT NOT NULL UNIQUE,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_success_at TEXT,
        last_error TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX push_subscriptions_account_idx ON push_subscriptions (account_id);
      CREATE TABLE push_outbox (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id),
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        href TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT NOT NULL,
        delivered_at TEXT,
        last_error TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
      CREATE INDEX push_outbox_pending_idx ON push_outbox (delivered_at, next_attempt_at);
    `,
  },
  {
    // Abuse reports: anyone signed in can flag a job or a coder; only an
    // operator resolves them, and the resolution is audited.
    version: 16,
    sql: `
      CREATE TABLE reports (
        id TEXT PRIMARY KEY,
        reporter_account_id TEXT NOT NULL REFERENCES accounts(id),
        target_kind TEXT NOT NULL CHECK (target_kind IN ('job', 'coder')),
        target_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        detail TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
        resolution TEXT NOT NULL DEFAULT '',
        resolved_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX reports_status_idx ON reports (status, created_at);
      CREATE UNIQUE INDEX reports_one_open_per_reporter_idx
        ON reports (reporter_account_id, target_kind, target_id) WHERE status = 'open';
    `,
  },
  {
    // Session list: a label the person recognises, so a stolen session can be
    // recognised and revoked from the dashboard.
    version: 17,
    sql: `ALTER TABLE sessions ADD COLUMN user_agent TEXT NOT NULL DEFAULT '';`,
  },
  {
    // Opt-in email notifications for the events a person must act on.
    version: 18,
    sql: `ALTER TABLE accounts ADD COLUMN email_notifications INTEGER NOT NULL DEFAULT 0;`,
  },
  {
    // Operator suspension: blocks login and kills live sessions.
    version: 19,
    sql: `
      ALTER TABLE accounts ADD COLUMN suspended_at TEXT;
      ALTER TABLE accounts ADD COLUMN suspended_reason TEXT NOT NULL DEFAULT '';
    `,
  },
  {
    // Saved job searches: the alert sweep notifies the coder about new matches.
    version: 20,
    sql: `
      CREATE TABLE saved_searches (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        query TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT '',
        min_budget_cents INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        last_checked_at TEXT NOT NULL
      );
      CREATE INDEX saved_searches_account_idx ON saved_searches (account_id, created_at);
    `,
  },
  {
    // Account deletion keeps the ledger but removes the personal data.
    version: 21,
    sql: `
      ALTER TABLE accounts ADD COLUMN deleted_at TEXT;
    `,
  },
  {
    // Coder alerts: the business-side mirror of a saved job search.
    version: 22,
    sql: `
      CREATE TABLE coder_alerts (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        skills TEXT NOT NULL DEFAULT '[]',
        interest TEXT NOT NULL DEFAULT '',
        max_rate_cents INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        last_checked_at TEXT NOT NULL
      );
      CREATE INDEX coder_alerts_account_idx ON coder_alerts (account_id, created_at);
    `,
  },
  {
    // A business declares the field it usually hires in; the job form starts
    // there instead of at a generic default.
    version: 23,
    sql: `
      ALTER TABLE business_profiles ADD COLUMN industry TEXT NOT NULL DEFAULT '';
    `,
  },
  {
    // The desktop app talks to the user's own deployment with a long-lived
    // token. Only the SHA-256 is stored, so a copy of the database cannot be
    // replayed as a credential, and deleting the account removes its tokens.
    version: 24,
    sql: `
      CREATE TABLE api_tokens (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_used_at TEXT
      );
      CREATE INDEX api_tokens_account_idx ON api_tokens (account_id);
      -- Account deletion anonymises the accounts row rather than deleting it, so
      -- the foreign key cascade never fires; the trigger is what revokes tokens.
      CREATE TRIGGER api_tokens_deleted_account
      AFTER UPDATE OF deleted_at ON accounts
      WHEN NEW.deleted_at IS NOT NULL
      BEGIN
        DELETE FROM api_tokens WHERE account_id = NEW.id;
      END;
    `,
  },
  {
    // Chat between the two sides of an engagement. It is deliberately not a
    // state transition: the conversation is allowed before, during and after
    // delivery, and a message never moves money.
    version: 25,
    sql: `
      CREATE TABLE engagement_messages (
        id TEXT PRIMARY KEY,
        engagement_id TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
        author_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        author_role TEXT NOT NULL CHECK (author_role IN ('coder', 'business')),
        body TEXT NOT NULL,
        evidence TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL
      );
      CREATE INDEX engagement_messages_engagement_idx
        ON engagement_messages (engagement_id, created_at);
    `,
  },
  {
    // What a person has actually worked on, one row per job. The app's profile
    // collects it step by step; a business needs it as structure, not as a
    // paragraph in the bio, so it is stored as a JSON array of entries rather
    // than folded into prose. Existing profiles start empty.
    version: 26,
    sql: `
      ALTER TABLE coder_profiles ADD COLUMN work_history TEXT NOT NULL DEFAULT '[]';
    `,
  },
];

export function openDatabase(dbPath: string): Db {
  const db = new NodeSqlite.DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  if (dbPath !== ":memory:") {
    // WAL keeps reads non-blocking while a form post is committing.
    db.exec("PRAGMA journal_mode = WAL");
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    db
      .prepare("SELECT version FROM schema_migrations")
      .all()
      .map((row) => Number(row.version)),
  );

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    db.exec("BEGIN");
    try {
      db.exec(migration.sql);
      db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(
        migration.version,
        new Date().toISOString(),
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  return db;
}

export function queryAll<T>(
  db: Db,
  sql: string,
  params: readonly NodeSqlite.SQLInputValue[] = [],
): T[] {
  return db.prepare(sql).all(...params) as unknown as T[];
}

export function queryOne<T>(
  db: Db,
  sql: string,
  params: readonly NodeSqlite.SQLInputValue[] = [],
): T | undefined {
  return db.prepare(sql).get(...params) as unknown as T | undefined;
}

export function execute(
  db: Db,
  sql: string,
  params: readonly NodeSqlite.SQLInputValue[] = [],
): void {
  db.prepare(sql).run(...params);
}

/**
 * Same as `execute`, but returns how many rows the statement changed. Used for
 * compare-and-set transitions: `changes === 1` means this caller won the race.
 */
export function executeChanges(
  db: Db,
  sql: string,
  params: readonly NodeSqlite.SQLInputValue[] = [],
): number {
  return Number(db.prepare(sql).run(...params).changes);
}

export function countRows(
  db: Db,
  sql: string,
  params: readonly NodeSqlite.SQLInputValue[] = [],
): number {
  const row = queryOne<{ count: number }>(db, sql, params);
  return row === undefined ? 0 : Number(row.count);
}

/**
 * Synchronous transaction helper. Callers must not await inside `fn`; the
 * payment provider call happens before the transaction opens for that reason.
 */
export function transaction<T>(db: Db, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
