-- Migration 0013 — 2026-05-18
--
-- 1. freepik_keys.paused_until — temporary auto-pause set by the
--    healthcheck cron when a key hits rate-limit burst (429). Different
--    from `is_active=false` (admin manual deactivate or auto-deactivate
--    for 401/403). Paused keys re-enter rotation silently when the
--    timestamp passes; pickActiveKey filters them via
--    `paused_until IS NULL OR paused_until < now()`.
--
-- 2. usage_logs.key_id index — needed by Phase 3 per-key health
--    dashboard (GROUP BY key_id, status) and orphan sweeper. FK
--    constraint exists but no index → seq-scan on 10K+ rows.
--    (code_id index already exists from 0000_init.sql; skipped.)
--
-- Both are pure ADD COLUMN / CREATE INDEX with IF NOT EXISTS — safe
-- to apply multiple times. Rollback by `DROP COLUMN` / `DROP INDEX`
-- but leaving them is also safe (orphan does no harm).

ALTER TABLE "freepik_keys" ADD COLUMN IF NOT EXISTS "paused_until" timestamptz;

CREATE INDEX IF NOT EXISTS "usage_logs_key_id_idx" ON "usage_logs" ("key_id");
