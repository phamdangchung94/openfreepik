-- Per-key Magnific webhook signing secret. Stored AES-GCM encrypted
-- (same secret as keyEncrypted) so a DB read can't lift it. Nullable
-- because not every key has webhook delivery configured — the
-- orchestrator only includes webhook_url in upstream requests for
-- keys that DO have a secret, and falls back to client polling
-- otherwise. Migration is additive — no data backfill required.
ALTER TABLE "freepik_keys"
  ADD COLUMN "webhook_secret_encrypted" text;
