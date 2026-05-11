-- One-off seed for Kling 4K pricing rules.
-- Rate: 1.12 EUR/s (= Kling V3 Pro 1080p with-audio × 20/7).
-- Both endpoints (kling-4k-t2v + kling-4k-i2v) priced identically.
-- Idempotent — re-running just refreshes cost_eur + updated_at.
--
-- Apply: paste into Neon SQL Editor on the production branch.

INSERT INTO pricing_rules (endpoint, tier, duration_seconds, with_audio, cost_eur)
VALUES
  ('kling-4k-t2v', NULL,  3, false,  3.36),
  ('kling-4k-t2v', NULL,  4, false,  4.48),
  ('kling-4k-t2v', NULL,  5, false,  5.60),
  ('kling-4k-t2v', NULL,  6, false,  6.72),
  ('kling-4k-t2v', NULL,  7, false,  7.84),
  ('kling-4k-t2v', NULL,  8, false,  8.96),
  ('kling-4k-t2v', NULL,  9, false, 10.08),
  ('kling-4k-t2v', NULL, 10, false, 11.20),
  ('kling-4k-t2v', NULL, 11, false, 12.32),
  ('kling-4k-t2v', NULL, 12, false, 13.44),
  ('kling-4k-t2v', NULL, 13, false, 14.56),
  ('kling-4k-t2v', NULL, 14, false, 15.68),
  ('kling-4k-t2v', NULL, 15, false, 16.80),
  ('kling-4k-i2v', NULL,  3, false,  3.36),
  ('kling-4k-i2v', NULL,  4, false,  4.48),
  ('kling-4k-i2v', NULL,  5, false,  5.60),
  ('kling-4k-i2v', NULL,  6, false,  6.72),
  ('kling-4k-i2v', NULL,  7, false,  7.84),
  ('kling-4k-i2v', NULL,  8, false,  8.96),
  ('kling-4k-i2v', NULL,  9, false, 10.08),
  ('kling-4k-i2v', NULL, 10, false, 11.20),
  ('kling-4k-i2v', NULL, 11, false, 12.32),
  ('kling-4k-i2v', NULL, 12, false, 13.44),
  ('kling-4k-i2v', NULL, 13, false, 14.56),
  ('kling-4k-i2v', NULL, 14, false, 15.68),
  ('kling-4k-i2v', NULL, 15, false, 16.80)
ON CONFLICT (endpoint, tier, duration_seconds, with_audio)
DO UPDATE SET
  cost_eur = EXCLUDED.cost_eur,
  updated_at = now();

-- Verify (should return 26 rows):
SELECT endpoint, duration_seconds, cost_eur
FROM pricing_rules
WHERE endpoint LIKE 'kling-4k-%'
ORDER BY endpoint, duration_seconds;
