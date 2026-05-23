-- Migration 0017 — 2026-05-23
-- Idempotency-Key cache for /v1/* POST endpoints.
--
-- Stripe-style: customer sends `Idempotency-Key: <unique-string>`,
-- server caches the response. Same key + same body within 24h returns
-- the cached response without re-processing. Different body for the
-- same key returns 409 (key was reused with different intent).
--
-- The PK is the (api_key_id, idempotency_key) pair so two different
-- customers using the same idempotency string don't collide.
--
-- Storage shape:
--   - request_body_hash: SHA-256 of the JSON body — compared on lookup
--     to detect "key reused with different body" (Stripe rule)
--   - response_status / response_body: replay verbatim on cache hit
--   - expires_at: 24h after creation; cron-purged with the other
--     buckets in sweep-uploads / sweep-orphan-charges

CREATE TABLE IF NOT EXISTS idempotency_keys (
  api_key_id        uuid NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  idempotency_key   text NOT NULL,
  request_body_hash text NOT NULL,
  response_status   integer NOT NULL,
  response_body     jsonb NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT NOW(),
  expires_at        timestamptz NOT NULL,
  PRIMARY KEY (api_key_id, idempotency_key)
);

-- Cleanup index for the cron sweeper (`DELETE WHERE expires_at < now()`).
CREATE INDEX IF NOT EXISTS idempotency_keys_expires_at_idx
  ON idempotency_keys(expires_at);
