-- Migration 0019 — 2026-05-23
-- Customer-facing webhook signing secret, scoped per API token.
--
-- Pattern: Stripe-style. When the orchestrator finalizes a task and
-- needs to fire a customer webhook (because the POST body included
-- top-level `webhook_url`), it:
--   1. Looks up the api_key.webhook_secret_encrypted
--   2. Decrypts with KEY_ENCRYPTION_SECRET (AES-GCM)
--   3. Signs `<timestamp>.<body>` with HMAC-SHA256(secret, ...)
--   4. Sends X-Webhook-Signature: t=<unix>,v1=<hex>
--
-- Customer's receiver verifies the signature → drops requests that
-- didn't originate from us (replay attacker can't forge without secret).
--
-- Backward compat: NULL secret = legacy key. Webhook fires unsigned
-- and emits WEBHOOK_UNSIGNED_DELIVERY log. Admin can "Regenerate" via
-- dashboard to switch a legacy key onto signed delivery.

ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS webhook_secret_encrypted text;
