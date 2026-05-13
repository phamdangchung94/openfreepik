-- Bump freepik_keys.max_concurrent default 8 → 30 + raise every
-- existing row that's still on the old default. Probe of an active
-- upstream key on 2026-05-13 showed `x-ratelimit-limit: 300` (req/min)
-- — the previous cap of 8 simultaneous generations left a lot of
-- headroom on the table. At ~12 poll/min/task the 30-task cap stays
-- under the budget; orchestrator's 429 → KEY_TRANSIENT_FAILURE
-- rotation handles occasional spillover.
--
-- Two-part migration:
--   1) DEFAULT — applied to new rows going forward.
--   2) UPDATE  — rows that still carry the 0006-era default (8) move
--                up to 30. Admins who deliberately set a custom value
--                (any value != 8) keep their choice.
ALTER TABLE "freepik_keys"
  ALTER COLUMN "max_concurrent" SET DEFAULT 30;
--> statement-breakpoint
UPDATE "freepik_keys"
  SET "max_concurrent" = 30
  WHERE "max_concurrent" = 8;
