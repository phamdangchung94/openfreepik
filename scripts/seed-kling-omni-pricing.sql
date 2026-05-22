-- Kling 3 Omni pricing seed — 2026-05-22
--
-- Magnific list price (€/s) maps 1:1 to retail of regular Kling V3 in
-- our system (same UI tier price per their published rate card):
--   Omni Std no-audio: €0.168/s = 168 đ/s   (matches V3 Std retail)
--   Omni Std audio:    €0.308/s = 308 đ/s
--   Omni Pro no-audio: €0.224/s = 224 đ/s   (matches V3 Pro retail)
--   Omni Pro audio:    €0.392/s = 392 đ/s
--
-- 4 endpoint slugs × 2 audio variants = 8 rows. Reference (V2V) priced
-- same as video (T/I2V) per Magnific list — admin can split later if
-- upstream changes.
--
-- Per-second billing with ceiling rounding: calculateOmniCost reads 1
-- row per (endpoint, audio) and derives ratePerSec = costEur /
-- durationSeconds. Seeded with duration_seconds=5 as the reference row
-- so existing helper code works without changes.
--
-- Idempotent: DELETE-then-INSERT so re-running doesn't dupe.

BEGIN;

DELETE FROM pricing_rules
WHERE endpoint LIKE 'kling-omni-%';

INSERT INTO pricing_rules (endpoint, tier, duration_seconds, with_audio, cost_eur)
VALUES
  -- video namespace (T2V + I2V)
  ('kling-omni-std-video',     NULL, 5, false, 0.84),  -- 0.168 × 5
  ('kling-omni-std-video',     NULL, 5, true,  1.54),  -- 0.308 × 5
  ('kling-omni-pro-video',     NULL, 5, false, 1.12),  -- 0.224 × 5
  ('kling-omni-pro-video',     NULL, 5, true,  1.96),  -- 0.392 × 5

  -- reference-to-video namespace (V2V)
  ('kling-omni-std-reference', NULL, 5, false, 0.84),
  ('kling-omni-std-reference', NULL, 5, true,  1.54),
  ('kling-omni-pro-reference', NULL, 5, false, 1.12),
  ('kling-omni-pro-reference', NULL, 5, true,  1.96);

COMMIT;
