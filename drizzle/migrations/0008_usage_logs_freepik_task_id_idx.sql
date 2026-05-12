-- Partial index on usage_logs.freepik_task_id. Poll routes look up the
-- row by freepik_task_id to find the original creator-key (audit
-- 2026-05-12: polling was picking LRU keys and getting 200/404
-- alternation because tasks only exist on the account that posted them).
-- Without this index the lookup was a full-table seq-scan; 10k+ rows
-- expected this year.
--
-- Partial (WHERE NOT NULL) — most usage_log rows have a freepik_task_id
-- but improve-prompt rows can be null in some edge cases. Saving a few
-- pages.
--
-- Already applied to production via Neon MCP (CONCURRENTLY) on
-- 2026-05-12; this file is the source-of-truth copy for the migration
-- history.
CREATE INDEX IF NOT EXISTS "usage_logs_freepik_task_id_idx"
  ON "usage_logs" ("freepik_task_id")
  WHERE "freepik_task_id" IS NOT NULL;
