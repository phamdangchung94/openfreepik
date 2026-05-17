-- Broadcast announcements: admin posts a message visible to ALL
-- customers as a banner at top of page. Dismissals are tracked client-
-- side in localStorage by announcement id (per-device). severity
-- drives banner color; expires_at lets admin schedule auto-hide.
-- Migration 0012 — 2026-05-17.
CREATE TABLE IF NOT EXISTS "announcements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "title" text NOT NULL,
  "body" text NOT NULL,
  "cta_label" text,
  "cta_url" text,
  "severity" text NOT NULL DEFAULT 'info',
  "active" boolean NOT NULL DEFAULT true,
  "expires_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

-- Hot path: customer GET /api/announcements filters `active = true AND
-- (expires_at IS NULL OR expires_at > now())`. Index keeps that query
-- snappy as the table grows; we don't expect more than a few hundred
-- rows lifetime but partial-index pattern protects against future drift.
CREATE INDEX IF NOT EXISTS "announcements_active_idx"
  ON "announcements" ("active", "created_at" DESC);
