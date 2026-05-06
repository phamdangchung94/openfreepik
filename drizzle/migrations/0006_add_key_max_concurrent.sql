-- Per-key cap on concurrent in-flight generations. Customer requested
-- 8 simultaneous threads per Magnific account; this column lets admin
-- override per-key (some accounts may negotiate higher caps).
ALTER TABLE "freepik_keys"
  ADD COLUMN "max_concurrent" integer NOT NULL DEFAULT 8;
--> statement-breakpoint
-- Speeds up the in-flight count subquery in pickActiveKey:
--   "rows for this key, status=succeeded, video_url IS NULL, last 5 min".
-- Without this the orchestrator would scan usage_logs on every pick.
CREATE INDEX IF NOT EXISTS "usage_logs_key_inflight_idx"
  ON "usage_logs" ("key_id", "status", "created_at")
  WHERE "video_url" IS NULL;
