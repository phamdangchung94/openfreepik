-- Kling Motion Control pricing — 4 endpoints × 4 durations = 16 rows.
-- Final retail rates (2026-05-19 v2, anh confirmed): base price table
-- shared by anh + 10% markup as standard customer-facing pricing.
--
--   Base (Magnific cost equivalent at 1 EUR = 1000 VND):
--     2.6 Std: 126 đ/s · 2.6 Pro: 251 đ/s · V3 Std: 268 đ/s · V3 Pro: 358 đ/s
--   Retail (+10%) seeded here:
--     kling-motion-v2-6-std: 0.1386 EUR/s (138.6 đ/s)
--     kling-motion-v2-6-pro: 0.2761 EUR/s (276.1 đ/s)
--     kling-motion-v3-std:   0.2948 EUR/s (294.8 đ/s)
--     kling-motion-v3-pro:   0.3938 EUR/s (393.8 đ/s)
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
  -- Kling Motion 2.6 Standard @ 0.1386 EUR/s (138.6 đ/s)
  ('kling-motion-v2-6-std', NULL,  5, false, 0.69),
  ('kling-motion-v2-6-std', NULL, 10, false, 1.39),
  ('kling-motion-v2-6-std', NULL, 15, false, 2.08),
  ('kling-motion-v2-6-std', NULL, 30, false, 4.16),
  -- Kling Motion 2.6 Pro @ 0.2761 EUR/s (276.1 đ/s)
  ('kling-motion-v2-6-pro', NULL,  5, false, 1.38),
  ('kling-motion-v2-6-pro', NULL, 10, false, 2.76),
  ('kling-motion-v2-6-pro', NULL, 15, false, 4.14),
  ('kling-motion-v2-6-pro', NULL, 30, false, 8.28),
  -- Kling Motion 3.0 Standard @ 0.2948 EUR/s (294.8 đ/s)
  ('kling-motion-v3-std',   NULL,  5, false, 1.47),
  ('kling-motion-v3-std',   NULL, 10, false, 2.95),
  ('kling-motion-v3-std',   NULL, 15, false, 4.42),
  ('kling-motion-v3-std',   NULL, 30, false, 8.84),
  -- Kling Motion 3.0 Pro @ 0.3938 EUR/s (393.8 đ/s)
  ('kling-motion-v3-pro',   NULL,  5, false, 1.97),
  ('kling-motion-v3-pro',   NULL, 10, false, 3.94),
  ('kling-motion-v3-pro',   NULL, 15, false, 5.91),
  ('kling-motion-v3-pro',   NULL, 30, false, 11.81);

-- Verify (should return 16 rows):
SELECT endpoint, duration_seconds, cost_eur
FROM pricing_rules
WHERE endpoint LIKE 'kling-motion-%'
ORDER BY endpoint, duration_seconds;
