-- Capture the customer's prompt verbatim on every usage_log row.
-- 2026-05-13 incident: customer '5-XuanHuy' retried 15 identical
-- inputs in 35 min and we couldn't tell from server-side data whether
-- it was the same prompt or different — usage_logs only had task_id
-- + cost. Admin support + repeat-failure analysis needs the prompt
-- text. Nullable so improve-prompt rows (which don't carry a customer
-- prompt) and legacy rows stay valid.
-- Already applied to production via Neon MCP on 2026-05-13.
ALTER TABLE "usage_logs" ADD COLUMN IF NOT EXISTS "prompt" text;
