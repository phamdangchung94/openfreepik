-- Migration 0018 — 2026-05-23
-- Store the plaintext sk_* encrypted alongside the hash so admin can
-- reveal it to a customer who lost their copy.
--
-- Trade-off: traditional "hash-only" API key storage means a leaked
-- DB doesn't expose live keys, but customers who lose the plaintext
-- need a fresh key. Admin operational reality (anh on 2026-05-23):
-- "khách quên thì tôi sẽ cung cấp lại" — chose recoverability over
-- the marginal security gain.
--
-- Mitigation: encryption uses the same AES-GCM + KEY_ENCRYPTION_SECRET
-- as freepik_keys.key_encrypted. Compromising the DB without also
-- compromising the secret yields nothing.
--
-- Existing rows: cannot be backfilled (we only have the hash, never
-- stored the plaintext). UI shows "Mint lại để có plaintext" cho
-- legacy keys.

ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS key_encrypted text;
