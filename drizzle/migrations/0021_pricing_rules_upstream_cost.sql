-- Migration 0021 — 2026-05-24
-- 2-layer pricing model: split actual upstream cost from customer retail.
--
-- Background: the word "EUR" was overloaded with 2 meanings:
--   - Magnific real EUR (tracked in freepik_keys.assigned/used_eur)
--   - Internal credit EUR (1 EUR ≈ 1000 VND, tracked in activation_codes
--     + pricing_rules)
-- Admin had no per-request visibility into margin, so couldn't tell
-- which models were profitable vs running at cost.
--
-- This migration adds an explicit `upstream_cost_eur` column to:
--   - pricing_rules: what Magnific charges us per request (for margin
--     math + admin tuning)
--   - usage_logs:    snapshot at charge time (for historical P&L)
--
-- Backfill: copy existing cost_eur → upstream_cost_eur so the system
-- starts in a "margin = 0%" state. Admin then tunes upstream_cost_eur
-- per row to reflect actual Magnific rates and adjusts customer
-- cost_eur for desired margin (UI handles inline edit).
--
-- usage_logs.upstream_cost_eur stays NULL for legacy rows (we never
-- knew the upstream cost back then). Going forward, every new row
-- captures the snapshot.

ALTER TABLE pricing_rules
  ADD COLUMN IF NOT EXISTS upstream_cost_eur numeric(10, 4);

ALTER TABLE usage_logs
  ADD COLUMN IF NOT EXISTS upstream_cost_eur numeric(10, 4);

-- Backfill pricing_rules so admin sees the existing prices in BOTH
-- columns. They start as 1:1 (markup 0%); admin adjusts via UI.
UPDATE pricing_rules
SET upstream_cost_eur = cost_eur
WHERE upstream_cost_eur IS NULL;
