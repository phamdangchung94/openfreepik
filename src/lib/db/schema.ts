import {
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Freepik API keys pool — admin adds plaintext keys via dashboard,
 * server stores them AES-GCM encrypted with KEY_ENCRYPTION_SECRET.
 * Each Freepik account starts with 500 EUR free credit.
 */
export const freepikKeys = pgTable(
  "freepik_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    label: text("label").notNull(),
    keyEncrypted: text("key_encrypted").notNull(),
    assignedEur: numeric("assigned_eur", { precision: 10, scale: 2 })
      .notNull()
      .default("500.00"),
    usedEur: numeric("used_eur", { precision: 10, scale: 2 })
      .notNull()
      .default("0.00"),
    isActive: boolean("is_active").notNull().default(true),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  // Audit P2-7: prevent admin from accidentally creating two keys with
  // the same label (makes spend attribution ambiguous).
  (t) => [uniqueIndex("freepik_keys_label_uniq").on(t.label)],
);

/**
 * Activation codes issued to customers.
 *
 * For all modes, remaining = quota_eur - used_eur (or unbounded if unlimited).
 * Mode just describes admin behavior:
 *   - "unlimited": ignore quota_eur entirely; runs until is_active=false
 *   - "quota":     admin sets quota_eur once at issue time; never edited
 *   - "topup":     admin increments quota_eur over time as customer pays
 *
 * The code itself IS the bearer token (long random string, 32+ chars).
 * No JWT; revoke = set is_active=false.
 */
export const activationCodes = pgTable(
  "activation_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    customerLabel: text("customer_label"),
    mode: text("mode", { enum: ["unlimited", "quota", "topup"] }).notNull(),
    quotaEur: numeric("quota_eur", { precision: 10, scale: 2 }),
    usedEur: numeric("used_eur", { precision: 10, scale: 2 })
      .notNull()
      .default("0.00"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("activation_codes_code_uniq").on(t.code)],
);

/**
 * Per-request usage log. status="refunded" when Freepik call failed
 * after charging the code (balance restored). Video URL is the Freepik
 * URL returned at completion — we don't host the file.
 */
export const usageLogs = pgTable(
  "usage_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    codeId: uuid("code_id")
      .notNull()
      .references(() => activationCodes.id, { onDelete: "restrict" }),
    keyId: uuid("key_id").references(() => freepikKeys.id, {
      onDelete: "set null",
    }),
    endpoint: text("endpoint").notNull(),
    tier: text("tier", { enum: ["pro", "std"] }),
    durationSeconds: smallint("duration_seconds"),
    withAudio: boolean("with_audio").notNull().default(false),
    costEur: numeric("cost_eur", { precision: 10, scale: 2 })
      .notNull()
      .default("0.00"),
    freepikTaskId: text("freepik_task_id"),
    videoUrl: text("video_url"),
    /**
     * When the videoUrl is expected to stop working. Set by the poll endpoint
     * when COMPLETED is first observed (capturedAt + VIDEO_URL_TTL_HOURS).
     * Freepik doesn't publish a TTL; 24h is the conservative industry default
     * for AWS CloudFront signed URLs.
     */
    videoUrlExpiresAt: timestamp("video_url_expires_at", { withTimezone: true }),
    status: text("status", {
      enum: ["succeeded", "failed", "refunded", "pending"],
    })
      .notNull()
      .default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("usage_logs_code_id_idx").on(t.codeId),
    index("usage_logs_created_at_idx").on(t.createdAt),
    // Audit P1-12: covers the admin /api/admin/usage filter shape
    // `WHERE status=? ORDER BY created_at DESC`. Without this the
    // single-column created_at index forces a sort over status-matching
    // rows; with 10K+ usage rows that's measurably slow.
    index("usage_logs_status_created_at_idx").on(t.status, t.createdAt),
  ],
);

/**
 * Pricing matrix — admin editable. Lookup by (endpoint, tier, duration_seconds, with_audio).
 * Seeded with Freepik public defaults; admin adjusts when Freepik changes prices
 * or for promotional pricing.
 */
export const pricingRules = pgTable(
  "pricing_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    endpoint: text("endpoint").notNull(),
    tier: text("tier", { enum: ["pro", "std"] }),
    durationSeconds: smallint("duration_seconds"),
    withAudio: boolean("with_audio").notNull().default(false),
    costEur: numeric("cost_eur", { precision: 10, scale: 2 }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("pricing_rules_lookup_uniq").on(
      t.endpoint,
      t.tier,
      t.durationSeconds,
      t.withAudio,
    ),
  ],
);

/**
 * Admin sessions — token_hash = SHA-256 of the bearer token in the cookie.
 * 24h expiry by default. Single-admin model (no user_id needed).
 */
export const adminSessions = pgTable("admin_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Fixed-window rate-limit counters. bucket_key encodes the limited
 * resource AND the time bucket, e.g. "kling-v3:code:abc:30821412" where
 * 30821412 is the minute-since-epoch. Cron periodically deletes rows
 * with expires_at < now() (or just lets storage grow — cleanup is best-
 * effort since stale rows aren't returned by anything alive).
 */
export const rateLimitBuckets = pgTable("rate_limit_buckets", {
  bucketKey: text("bucket_key").primaryKey(),
  count: integer("count").notNull().default(1),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

/**
 * Per-IP failed admin login tracking. Lock for 15 minutes after 5
 * failures inside any 15-minute rolling window. Successful login or
 * `locked_until < now()` resets the counter.
 */
export const failedLogins = pgTable(
  "failed_logins",
  {
    ip: text("ip").primaryKey(),
    attempts: integer("attempts").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastAttempt: timestamp("last_attempt", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("failed_logins_locked_until_idx").on(t.lockedUntil)],
);

export type FreepikKey = typeof freepikKeys.$inferSelect;
export type NewFreepikKey = typeof freepikKeys.$inferInsert;
export type ActivationCode = typeof activationCodes.$inferSelect;
export type NewActivationCode = typeof activationCodes.$inferInsert;
export type UsageLog = typeof usageLogs.$inferSelect;
export type NewUsageLog = typeof usageLogs.$inferInsert;
export type PricingRule = typeof pricingRules.$inferSelect;
export type NewPricingRule = typeof pricingRules.$inferInsert;
