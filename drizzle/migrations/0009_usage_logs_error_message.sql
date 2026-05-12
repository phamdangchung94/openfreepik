-- Capture the upstream failure reason on every refunded usage_log row.
-- Customers were retrying the same failing input 10+ times because the
-- only feedback they got was a generic "Failed" — admin couldn't tell
-- whether the reject was content policy, bad image, or upstream outage
-- either. Nullable text so legacy succeeded/refunded rows stay valid.
-- Already applied to production via Neon MCP on 2026-05-12; this file
-- is the source-of-truth copy for the migration history.
ALTER TABLE "usage_logs" ADD COLUMN IF NOT EXISTS "error_message" text;
