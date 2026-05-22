-- Migration 0015 — 2026-05-23
-- Top-up voucher codes (Mã nạp tiền).
--
-- Single-use codes issued by admin (bulk-mint) and redeemed by
-- customers to add EUR balance to their activation code. Three
-- denominations: 100k/200k/500k VND → +100/200/500 EUR.
--
-- Lifecycle: created → (revoked | redeemed → (refunded)).
--
-- Atomic redemption invariant:
--   UPDATE vouchers SET redeemed_at = NOW(), redeemed_by_code_id = $1
--   WHERE code = $2 AND redeemed_at IS NULL AND revoked_at IS NULL
--   RETURNING eur_value;
-- Returns 0 rows = already redeemed/revoked → reject without leaking which.

CREATE TABLE IF NOT EXISTS vouchers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Customer-typed redemption code, e.g. "CODE-100-X4K9MPQR".
  -- Globally unique to support direct-lookup redemption.
  code             text NOT NULL,
  -- Denomination label. Keep as text (not enum) so a future "1M" tier
  -- doesn't require a migration. Validated in app code.
  tier             text NOT NULL CHECK (tier IN ('100k', '200k', '500k')),
  -- VND retail price for display/audit (100000 / 200000 / 500000).
  vnd_value        integer NOT NULL,
  -- EUR credit added to activation code's quota_eur on redemption.
  eur_value        numeric(10, 2) NOT NULL,
  -- Optional admin grouping label so a bulk-mint can be filtered later
  -- (e.g. "T11-2026-AnhA"). Free-form text.
  batch_label      text,
  created_at       timestamptz NOT NULL DEFAULT NOW(),
  -- Soft-delete: setting revoked_at blocks redemption forever. Used
  -- when admin mis-mints or a physical voucher is lost in distribution.
  revoked_at       timestamptz,
  revoke_reason    text,
  -- Set atomically when customer redeems. NULL = still claimable.
  redeemed_at      timestamptz,
  redeemed_by_code_id uuid REFERENCES activation_codes(id) ON DELETE SET NULL,
  -- Admin-driven post-redeem refund. eur_value gets deducted from the
  -- activation code's used_eur back-balance and voucher is flagged here
  -- so it cannot be re-redeemed.
  refunded_at      timestamptz,
  refund_reason    text
);

-- Lookup index for redemption (always hits the WHERE code = $1 path).
-- Voucher count stays small (1K-10K rows) so a plain unique index on
-- code is fine — no need for partial.
CREATE UNIQUE INDEX IF NOT EXISTS vouchers_code_uniq ON vouchers(code);

-- Admin filter "all vouchers redeemed by code X" + per-code audit.
CREATE INDEX IF NOT EXISTS vouchers_redeemed_by_code_id_idx
  ON vouchers(redeemed_by_code_id)
  WHERE redeemed_by_code_id IS NOT NULL;

-- Admin filter by batch (UI dropdown lists distinct batch_label values).
CREATE INDEX IF NOT EXISTS vouchers_batch_label_idx
  ON vouchers(batch_label)
  WHERE batch_label IS NOT NULL;

-- Admin list page sorts by created_at DESC. Partial index keeps it
-- compact (most rows accumulate but cheap to index this side).
CREATE INDEX IF NOT EXISTS vouchers_created_at_idx ON vouchers(created_at DESC);
