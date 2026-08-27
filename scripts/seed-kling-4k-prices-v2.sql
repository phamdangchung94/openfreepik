-- Kling 4K pricing — v2 rev. Updates the original tier=NULL rows to
-- tier='4k' AND adds the with_audio=true variants (originally only
-- with_audio=false existed because the Magnific OpenAPI didn't list
-- a generate_audio field). Per business rule both audio variants
-- price identically at 1.12 EUR/s × duration.
--
-- Apply: paste into Supabase SQL Editor on the production database. Safe
-- to re-run (idempotent via ON CONFLICT).

-- Step 1 — migrate existing rows from tier=NULL → tier='4k'.
-- DELETE the NULL-tier ones (they conflict on the lookup unique idx
-- once we re-insert with tier='4k'); the next INSERT recreates them.
DELETE FROM pricing_rules
WHERE endpoint IN ('kling-4k-t2v', 'kling-4k-i2v')
  AND tier IS NULL;

-- Step 2 — insert/refresh all 52 Kling-4K rows (2 endpoints × 13
-- durations × 2 audio variants).
INSERT INTO pricing_rules (endpoint, tier, duration_seconds, with_audio, cost_eur)
VALUES
  ('kling-4k-t2v', '4k',  3, false,  3.36), ('kling-4k-t2v', '4k',  3, true,  3.36),
  ('kling-4k-t2v', '4k',  4, false,  4.48), ('kling-4k-t2v', '4k',  4, true,  4.48),
  ('kling-4k-t2v', '4k',  5, false,  5.60), ('kling-4k-t2v', '4k',  5, true,  5.60),
  ('kling-4k-t2v', '4k',  6, false,  6.72), ('kling-4k-t2v', '4k',  6, true,  6.72),
  ('kling-4k-t2v', '4k',  7, false,  7.84), ('kling-4k-t2v', '4k',  7, true,  7.84),
  ('kling-4k-t2v', '4k',  8, false,  8.96), ('kling-4k-t2v', '4k',  8, true,  8.96),
  ('kling-4k-t2v', '4k',  9, false, 10.08), ('kling-4k-t2v', '4k',  9, true, 10.08),
  ('kling-4k-t2v', '4k', 10, false, 11.20), ('kling-4k-t2v', '4k', 10, true, 11.20),
  ('kling-4k-t2v', '4k', 11, false, 12.32), ('kling-4k-t2v', '4k', 11, true, 12.32),
  ('kling-4k-t2v', '4k', 12, false, 13.44), ('kling-4k-t2v', '4k', 12, true, 13.44),
  ('kling-4k-t2v', '4k', 13, false, 14.56), ('kling-4k-t2v', '4k', 13, true, 14.56),
  ('kling-4k-t2v', '4k', 14, false, 15.68), ('kling-4k-t2v', '4k', 14, true, 15.68),
  ('kling-4k-t2v', '4k', 15, false, 16.80), ('kling-4k-t2v', '4k', 15, true, 16.80),
  ('kling-4k-i2v', '4k',  3, false,  3.36), ('kling-4k-i2v', '4k',  3, true,  3.36),
  ('kling-4k-i2v', '4k',  4, false,  4.48), ('kling-4k-i2v', '4k',  4, true,  4.48),
  ('kling-4k-i2v', '4k',  5, false,  5.60), ('kling-4k-i2v', '4k',  5, true,  5.60),
  ('kling-4k-i2v', '4k',  6, false,  6.72), ('kling-4k-i2v', '4k',  6, true,  6.72),
  ('kling-4k-i2v', '4k',  7, false,  7.84), ('kling-4k-i2v', '4k',  7, true,  7.84),
  ('kling-4k-i2v', '4k',  8, false,  8.96), ('kling-4k-i2v', '4k',  8, true,  8.96),
  ('kling-4k-i2v', '4k',  9, false, 10.08), ('kling-4k-i2v', '4k',  9, true, 10.08),
  ('kling-4k-i2v', '4k', 10, false, 11.20), ('kling-4k-i2v', '4k', 10, true, 11.20),
  ('kling-4k-i2v', '4k', 11, false, 12.32), ('kling-4k-i2v', '4k', 11, true, 12.32),
  ('kling-4k-i2v', '4k', 12, false, 13.44), ('kling-4k-i2v', '4k', 12, true, 13.44),
  ('kling-4k-i2v', '4k', 13, false, 14.56), ('kling-4k-i2v', '4k', 13, true, 14.56),
  ('kling-4k-i2v', '4k', 14, false, 15.68), ('kling-4k-i2v', '4k', 14, true, 15.68),
  ('kling-4k-i2v', '4k', 15, false, 16.80), ('kling-4k-i2v', '4k', 15, true, 16.80)
ON CONFLICT (endpoint, tier, duration_seconds, with_audio)
DO UPDATE SET cost_eur = EXCLUDED.cost_eur, updated_at = now();

-- Verify (should return 52 rows):
SELECT endpoint, tier, duration_seconds, with_audio, cost_eur
FROM pricing_rules
WHERE endpoint LIKE 'kling-4k-%'
ORDER BY endpoint, duration_seconds, with_audio;
