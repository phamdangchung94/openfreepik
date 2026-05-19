-- Migration 0014 — 2026-05-19
--
-- Programmatic API keys table. Public API (/api/v1/*) auth path,
-- separate from activation codes used by the web UI.
--
-- Plaintext shape: `sk_<32-byte url-safe random>`. Stored as
-- SHA-256(plaintext); plaintext shown ONCE at creation in the admin
-- dashboard. Lookup via `key_hash` index.
--
-- Billing: each api_keys row links to an activation_codes row
-- (`code_id` FK). Charge/refund flows reuse existing pipeline —
-- API key auth resolves to a `codeId` then everything downstream
-- (orchestrator, rate-limit scope, balance update) is unchanged.

CREATE TABLE IF NOT EXISTS "api_keys" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "key_hash" text NOT NULL,
  "label" text NOT NULL,
  "code_id" uuid NOT NULL REFERENCES "activation_codes"("id") ON DELETE CASCADE,
  "rate_limit_per_min" integer,
  "is_active" boolean NOT NULL DEFAULT true,
  "last_used_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS "api_keys_key_hash_uniq"
  ON "api_keys" ("key_hash");

-- Lookup index for admin dashboard listing per-customer API keys.
CREATE INDEX IF NOT EXISTS "api_keys_code_id_idx"
  ON "api_keys" ("code_id");
