-- Kling Motion Control pricing — 4 endpoints × 4 durations = 16 rows.
-- Rates confirmed by admin (Magnific dashboard 2026-05-19):
--   kling-motion-v2-6-std: 0.059 EUR/s
--   kling-motion-v2-6-pro: 0.118 EUR/s
--   kling-motion-v3-std:   0.126 EUR/s
--   kling-motion-v3-pro:   0.168 EUR/s
--
-- Allowed durations: 5, 10, 15, 30s. The route handler enforces that
-- 15 and 30 require character_orientation='video' (Magnific caps
-- orientation='image' output at 10s).
--
-- tier slot is NULL — version + tier already encoded in the endpoint
-- string so the second-axis discrimination would be redundant.
-- pricing_rules unique index treats NULLs as distinct in PostgreSQL
-- default; we DELETE existing motion rows first to keep this script
-- idempotent across re-runs.
--
-- Apply: paste into Neon SQL Editor on the production branch.

-- Step 1 — clear existing motion rows (idempotent).
DELETE FROM pricing_rules
WHERE endpoint LIKE 'kling-motion-%';

-- Step 2 — insert all 16 rows. cost = rate × duration, rounded to 2 dp.
INSERT INTO pricing_rules (endpoint, tier, duration_seconds, with_audio, cost_eur)
VALUES
  -- Kling Motion 2.6 Standard @ 0.059 EUR/s
  ('kling-motion-v2-6-std', NULL,  5, false, 0.30),
  ('kling-motion-v2-6-std', NULL, 10, false, 0.59),
  ('kling-motion-v2-6-std', NULL, 15, false, 0.89),
  ('kling-motion-v2-6-std', NULL, 30, false, 1.77),
  -- Kling Motion 2.6 Pro @ 0.118 EUR/s
  ('kling-motion-v2-6-pro', NULL,  5, false, 0.59),
  ('kling-motion-v2-6-pro', NULL, 10, false, 1.18),
  ('kling-motion-v2-6-pro', NULL, 15, false, 1.77),
  ('kling-motion-v2-6-pro', NULL, 30, false, 3.54),
  -- Kling Motion 3.0 Standard @ 0.126 EUR/s
  ('kling-motion-v3-std',   NULL,  5, false, 0.63),
  ('kling-motion-v3-std',   NULL, 10, false, 1.26),
  ('kling-motion-v3-std',   NULL, 15, false, 1.89),
  ('kling-motion-v3-std',   NULL, 30, false, 3.78),
  -- Kling Motion 3.0 Pro @ 0.168 EUR/s
  ('kling-motion-v3-pro',   NULL,  5, false, 0.84),
  ('kling-motion-v3-pro',   NULL, 10, false, 1.68),
  ('kling-motion-v3-pro',   NULL, 15, false, 2.52),
  ('kling-motion-v3-pro',   NULL, 30, false, 5.04);

-- Verify (should return 16 rows):
SELECT endpoint, duration_seconds, cost_eur
FROM pricing_rules
WHERE endpoint LIKE 'kling-motion-%'
ORDER BY endpoint, duration_seconds;
