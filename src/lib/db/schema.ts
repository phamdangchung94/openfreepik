import {
  boolean,
  index,
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
export const freepikKeys = pgTable("freepik_keys", {
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
});

/**
 * Activation codes issued to customers.
 * Mode:
 *   - "unlimited": no quota check; runs until is_active=false
 *   - "quota":     quota_eur is the cap; reject when used_eur >= quota_eur
 *   - "topup":     quota_eur is current balance; admin tops up over time
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

export type FreepikKey = typeof freepikKeys.$inferSelect;
export type NewFreepikKey = typeof freepikKeys.$inferInsert;
export type ActivationCode = typeof activationCodes.$inferSelect;
export type NewActivationCode = typeof activationCodes.$inferInsert;
export type UsageLog = typeof usageLogs.$inferSelect;
export type NewUsageLog = typeof usageLogs.$inferInsert;
export type PricingRule = typeof pricingRules.$inferSelect;
export type NewPricingRule = typeof pricingRules.$inferInsert;
