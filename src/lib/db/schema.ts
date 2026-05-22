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
    /**
     * Magnific webhook signing secret (AES-GCM). When set, the
     * orchestrator includes a webhook_url in upstream requests so
     * Magnific posts task completions back to /api/freepik/webhook.
     * Null = legacy key, fall back to client polling. Migration 0007.
     */
    webhookSecretEncrypted: text("webhook_secret_encrypted"),
    assignedEur: numeric("assigned_eur", { precision: 10, scale: 2 })
      .notNull()
      .default("500.00"),
    usedEur: numeric("used_eur", { precision: 10, scale: 2 })
      .notNull()
      .default("0.00"),
    isActive: boolean("is_active").notNull().default(true),
    /**
     * Max simultaneous in-flight generations the orchestrator will
     * route to this key. Default raised from 8 → 30 in migration 0010
     * after a 2026-05-13 probe showed the upstream allows 300 req/min
     * per key (rate-limit-limit header). At ~12 polls/min/task the
     * 30-task cap stays comfortably under that budget (~360/min peak;
     * orchestrator's 429 → KEY_TRANSIENT_FAILURE rotation handles
     * occasional spikes). Admin can raise/lower per-key. pickActiveKey
     * filters by `inflight < max_concurrent` so a single key can't be
     * hammered past the upstream's concurrency tolerance.
     */
    maxConcurrent: integer("max_concurrent").notNull().default(30),
    /**
     * Temporary auto-pause set by the healthcheck cron when the key
     * hits a rate-limit burst (>5 hits within 5min) or sustained
     * latency degradation. While `paused_until > now()`, `pickActiveKey`
     * skips this key but does NOT deactivate it — admin sees a "Paused"
     * badge in the dashboard. After the timestamp passes, the key
     * silently re-enters rotation. Migration 0013.
     */
    pausedUntil: timestamp("paused_until", { withTimezone: true }),
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
 * Programmatic API keys — separate auth path from activation codes.
 * Activation codes serve the web UI (one per customer, bearer-style);
 * API keys are for headless callers (third-party integrations,
 * AI agents calling /api/v1/*).
 *
 * Key shape: `sk_<32-byte url-safe random>`. We store only a SHA-256
 * digest (`key_hash`); the plaintext is shown ONCE at creation time
 * via the admin dashboard. Lookup is by hash so a leaked DB doesn't
 * expose live keys.
 *
 * Quota model: each API key links to an activation code (`code_id`)
 * so billing flows through the existing balance + refund pipeline
 * unchanged. Per-key rate-limit overrides via `rate_limit_per_min`
 * (null = inherit from default for endpoint).
 *
 * Migration 0014.
 */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** SHA-256(plaintext_key). Lookup index. Plaintext never stored. */
    keyHash: text("key_hash").notNull(),
    /** Customer-readable name. Admin sees this in the dashboard. */
    label: text("label").notNull(),
    /** Links the key to an activation code that owns billing. */
    codeId: uuid("code_id")
      .notNull()
      .references(() => activationCodes.id, { onDelete: "cascade" }),
    /** null = inherit endpoint default; otherwise override req/min. */
    rateLimitPerMin: integer("rate_limit_per_min"),
    isActive: boolean("is_active").notNull().default(true),
    /** Stamped on every successful auth — drives "Last used" admin column. */
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("api_keys_key_hash_uniq").on(t.keyHash),
    index("api_keys_code_id_idx").on(t.codeId),
  ],
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
    tier: text("tier", { enum: ["pro", "std", "4k"] }),
    durationSeconds: smallint("duration_seconds"),
    withAudio: boolean("with_audio").notNull().default(false),
    costEur: numeric("cost_eur", { precision: 10, scale: 2 })
      .notNull()
      .default("0.00"),
    freepikTaskId: text("freepik_task_id"),
    /**
     * Customer-facing URL — preferred to be the R2 mirror (cheaper egress,
     * Cloudflare CDN, 24h lifecycle on the bucket). Falls back to the
     * original Magnific URL when the mirror upload fails so customers
     * still get a working link.
     */
    videoUrl: text("video_url"),
    /**
     * Original Magnific signed URL, kept even after R2 lifecycle expires
     * the mirrored copy. Permanent record per audit + admin re-mirror flow.
     * Migration 0005.
     */
    magnificVideoUrl: text("magnific_video_url"),
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
    /**
     * Upstream-reported failure reason captured at finalize time. Null
     * for succeeded / pending rows. Surfaced verbatim to admin in the
     * usage logs page; sanitized via `error-messages.friendlyError`
     * before display to customers. Migration 0009.
     */
    errorMessage: text("error_message"),
    /**
     * Customer prompt verbatim at POST time. Persisted for admin
     * support + repeat-failure analysis (audit 2026-05-13: customer
     * '5-XuanHuy' retried 15 identical inputs and we had no way to
     * tell from server-side data whether the prompt was the same or
     * different). Nullable — improve-prompt rows and legacy data
     * stay valid. Migration 0011.
     */
    prompt: text("prompt"),
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
    // Migration 0013: needed by Phase 3 per-key health dashboard
    // (GROUP BY key_id, status) and orphan sweeper (filter by keyId
    // when scoping to a single key). FK constraint exists but no
    // index → seq-scan on 10K+ rows.
    index("usage_logs_key_id_idx").on(t.keyId),
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
    tier: text("tier", { enum: ["pro", "std", "4k"] }),
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

/**
 * Broadcast announcements shown to all customers — admin posts a
 * message (maintenance window, new feature, price change, etc.) and
 * every customer sees a banner at the top of the page. Per-customer
 * dismissal is tracked client-side in localStorage by announcement
 * id, so dismissing on one device doesn't dismiss on another (intent:
 * if you log in from a new phone, you still see the recent notice).
 *
 * `severity` drives banner color: info=neutral, warn=amber, critical
 * =red. `expiresAt` lets admin schedule auto-hide (null = never).
 * `active=false` is a soft-hide for drafts or deprecated announcements
 * without losing the record.
 */
export const announcements = pgTable(
  "announcements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    /**
     * Optional CTA — when set, the banner renders a link button next
     * to the body text. e.g. {label: "Xem giá mới", url: "/pricing"}.
     */
    ctaLabel: text("cta_label"),
    ctaUrl: text("cta_url"),
    severity: text("severity").notNull().default("info"), // info | warn | critical
    active: boolean("active").notNull().default(true),
    /** Null = no expiry, banner shows until admin deactivates. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("announcements_active_idx").on(t.active, t.createdAt)],
);

/**
 * Top-up vouchers (Mã nạp tiền) — single-use codes that add EUR balance
 * to an activation code's `quota_eur` when redeemed. Migration 0015.
 *
 * Three denominations: 100k/200k/500k VND → +100/200/500 EUR. Admin
 * bulk-mints, sends codes to customer via Zalo, customer redeems via
 * homepage Claim Code form.
 *
 * Lifecycle: created → (revoked | redeemed → (refunded)). Atomic
 * redeem via `UPDATE ... WHERE redeemed_at IS NULL AND revoked_at IS NULL`
 * guarantees single-use even under concurrent redemption attempts.
 */
export const vouchers = pgTable(
  "vouchers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Customer-typed code, e.g. "CODE-100-X4K9MPQR". Unique. */
    code: text("code").notNull(),
    /** Denomination label — "100k" | "200k" | "500k". */
    tier: text("tier", { enum: ["100k", "200k", "500k"] }).notNull(),
    /** VND retail price (100000 / 200000 / 500000). Audit + display. */
    vndValue: integer("vnd_value").notNull(),
    /** EUR credit added to activation code's `quota_eur` on redemption. */
    eurValue: numeric("eur_value", { precision: 10, scale: 2 }).notNull(),
    /** Optional admin grouping ("T11-2026-AnhA") for batch filtering. */
    batchLabel: text("batch_label"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Set by admin to block redemption (lost/mis-minted). Soft-delete. */
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokeReason: text("revoke_reason"),
    /** Set atomically on successful redeem. Null = still claimable. */
    redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
    redeemedByCodeId: uuid("redeemed_by_code_id").references(
      () => activationCodes.id,
      { onDelete: "set null" },
    ),
    /** Set when admin refunds a redeemed voucher; eur_value deducted back. */
    refundedAt: timestamp("refunded_at", { withTimezone: true }),
    refundReason: text("refund_reason"),
  },
  (t) => [
    uniqueIndex("vouchers_code_uniq").on(t.code),
    index("vouchers_redeemed_by_code_id_idx").on(t.redeemedByCodeId),
    index("vouchers_batch_label_idx").on(t.batchLabel),
    index("vouchers_created_at_idx").on(t.createdAt),
  ],
);

export type FreepikKey = typeof freepikKeys.$inferSelect;
export type NewFreepikKey = typeof freepikKeys.$inferInsert;
export type ActivationCode = typeof activationCodes.$inferSelect;
export type NewActivationCode = typeof activationCodes.$inferInsert;
export type UsageLog = typeof usageLogs.$inferSelect;
export type NewUsageLog = typeof usageLogs.$inferInsert;
export type PricingRule = typeof pricingRules.$inferSelect;
export type NewPricingRule = typeof pricingRules.$inferInsert;
export type Announcement = typeof announcements.$inferSelect;
export type NewAnnouncement = typeof announcements.$inferInsert;
export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;
export type Voucher = typeof vouchers.$inferSelect;
export type NewVoucher = typeof vouchers.$inferInsert;
