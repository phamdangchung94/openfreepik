-- Migration 0016 — 2026-05-23
-- Customer-supplied webhook URL for /v1/* task completion notification.
--
-- When customer POSTs to /v1/video/* with `webhook_url` in body, we
-- persist it here. On task finalization (success/fail/refund via poll
-- OR Magnific webhook OR orphan-sweeper), we fire a POST to this URL
-- with the task status payload. Best-effort fire-and-forget — customer
-- can still poll /v1/tasks/{id} if delivery fails.
--
-- Nullable: web-UI requests + customers who don't want webhooks just
-- leave it unset and rely on polling.

ALTER TABLE usage_logs
  ADD COLUMN IF NOT EXISTS customer_webhook_url text;
