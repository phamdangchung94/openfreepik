-- Migration 0020 — 2026-05-23
-- Track which customer API key created each /v1/* task.
--
-- Needed because finalizeUsageOnPoll fires customer webhook delivery
-- and needs to look up `api_keys.webhook_secret_encrypted` (migration
-- 0019) to sign the payload. Without this column we'd have to guess
-- among multiple keys sharing the same activation_code.
--
-- Populated at POST time from `auth.apiKeyId`. NULL for:
--   - Web UI requests (no API key, uses activation code bearer)
--   - Legacy rows before this migration
-- ON DELETE SET NULL so revoking a key doesn't cascade-delete past
-- usage rows — admin still needs the audit trail.

ALTER TABLE usage_logs
  ADD COLUMN IF NOT EXISTS api_key_id uuid REFERENCES api_keys(id) ON DELETE SET NULL;

-- Index for the JOIN finalizeUsageOnPoll runs to resolve the secret.
CREATE INDEX IF NOT EXISTS usage_logs_api_key_id_idx
  ON usage_logs(api_key_id)
  WHERE api_key_id IS NOT NULL;
