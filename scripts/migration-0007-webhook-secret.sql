-- Migration 0007 — add per-key Magnific webhook signing secret.
-- Same payload as drizzle/migrations/0007_add_key_webhook_secret.sql;
-- shipped as a stand-alone file so admin can apply it via the Supabase
-- SQL Editor when DATABASE_URL isn't available locally (Vercel
-- Sensitive-env policy blocks `vercel env pull` from returning it).
--
-- Idempotent — re-running is a no-op once the column exists.

ALTER TABLE "freepik_keys"
  ADD COLUMN IF NOT EXISTS "webhook_secret_encrypted" text;

-- Mark the migration as applied so pnpm db:migrate skips it later.
INSERT INTO __drizzle_migrations (filename)
VALUES ('0007_add_key_webhook_secret.sql')
ON CONFLICT (filename) DO NOTHING;

-- Verify the column exists:
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'freepik_keys'
  AND column_name = 'webhook_secret_encrypted';
