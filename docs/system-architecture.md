# OpenFreepik — System Architecture

> Companion to [`software-flows.md`](software-flows.md) — that file walks
> the codebase by *user flow*; this one explains the *technical layers*
> and the contracts between them.

## Overview

**OpenFreepik** is a SaaS wrapper around the Freepik/Magnific AI video
APIs. Customers authenticate with an admin-issued activation code; the
server pools multiple Freepik API keys behind the scenes, meters
per-customer EUR spend, and mirrors generated videos to Cloudflare R2
for cheap egress.

Three upstream video models are supported:

| Model       | Upstream path                              | Tiers     | Audio | Multi-shot |
|-------------|--------------------------------------------|-----------|-------|------------|
| Kling V3    | `/v1/ai/video/kling-v3-{pro\|std}`         | Pro / Std | Yes   | Up to 6    |
| Kling 4K    | `/v1/ai/video/kling-4k-{t2v\|i2v}`         | —         | No    | —          |
| WAN 2.7     | `/v1/ai/video/wan-v27-*`                   | 720P / 1080P | —  | —          |

Plus a free prompt-enhancement endpoint (`/v1/ai/improve-prompt`).

## Stack

| Layer    | Tech                                          |
|----------|-----------------------------------------------|
| Runtime  | Next.js 16.2 (App Router, Turbopack)          |
| Language | TypeScript 5 (strict, `noUncheckedIndexedAccess`) |
| UI       | React 19, Tailwind v4, shadcn/ui v4 (base-ui) |
| Forms    | react-hook-form 7 + Zod v4 (custom resolver)  |
| Client state | Zustand 5 (localStorage persist)          |
| Database | Neon Postgres + Drizzle ORM 0.45              |
| Storage  | Cloudflare R2 (video mirror, image upload)    |
| Hosting  | Vercel (Fluid runtime, sin1 region, cron)     |
| Upstream | Magnific / Freepik API                        |

## Authentication & Authorization

- **Customers**: bearer token = activation code, sent via
  `Authorization: Bearer <code>`. The code IS the credential; no JWT.
  Three modes — `unlimited`, `quota`, `topup` — recorded on
  `activation_codes`. Revoke = `is_active=false`.
- **Admin**: single-admin password model. Successful login mints a
  session token (SHA-256 in `admin_sessions`, 24h TTL) and sets a
  cookie. Per-IP brute-force lock at 5 failures / 15 min via
  `failed_logins`.
- **No per-user Freepik API key** — server pools admin-managed keys
  encrypted with AES-256-GCM (`KEY_ENCRYPTION_SECRET`).

## Core Flows

### Customer-side
1. **Activation** — `POST /api/activate` validates the code and seeds
   `auth-store` (Zustand + localStorage) with metadata.
2. **Generate** — form values → `POST /api/freepik/{model}` → server
   orchestrator (validate → charge → pick key → call → log pending) →
   client polls `GET /api/freepik/{model}/{taskId}`.
3. **Mirror & finalize** — poll route's `onSuccess` callback runs the
   R2 mirror on the first `COMPLETED` poll, then flips the usage log
   from `pending` → `succeeded`. `FAILED` flips to `refunded` +
   restores balance.
4. **Auxiliary** — batch queue (Kling V3 only today), multi-shot,
   prompt enhancement, history sidebar with orphan recovery,
   auto-download.

### Admin-side
1. **Login** → cookie-gated `/dashboard/(authed)` routes.
2. **Overview** — pool spend, code count, recent usage.
3. **Codes / Keys / Pricing / Usage** — CRUD with the same Drizzle
   tables the customer flow reads.

### Background
- **Cron** (`/api/cron/purge`, daily 02:00 UTC, sin1) — prunes
  `rate_limit_buckets`, expired `admin_sessions`, old `failed_logins`.
- **Reconcile** (`pnpm admin:reconcile`) — manual sweep for
  `usage_logs.status='pending'` orphans; probes Magnific and finalizes
  via the same `finalizeUsageOnPoll` helper.

## Billing Contract (charge / refund)

**Customer is charged only when they receive a working video URL.**

```
POST /api/freepik/{model}
  → validateCode
  → chargeCode (atomic SQL, returns 402 on insufficient balance)
  → pickActiveKey (per-key concurrency-aware LRU)
  → call Magnific
      success → recordKeyCost + insert usage_logs (status='pending')
      QUOTA_EXHAUSTED → markKeyExhausted + retry next key (≤3)
      PLAN_LIMIT / transient → retry next key, key stays active
      BAD_REQUEST / unknown → refund + status='failed'
  → all retries exhausted → refund + status='refunded'

GET /api/freepik/{model}/{taskId}
  status === COMPLETED + url → R2 mirror → finalize succeeded
  status === COMPLETED + no url → finalize failed → refund
  status === FAILED → finalize failed → refund
  status === IN_PROGRESS → no-op (next poll re-checks)

Cron-style sweep: scripts/reconcile-pending-charges.ts finds rows
stuck in 'pending' beyond a cutoff and runs the same finalize helper
against Magnific's current task state.
```

`finalizeUsageOnPoll` is idempotent — guarded by `WHERE status =
'pending'` so concurrent polls + reconcile script can't double-refund.

## Key Pool & Concurrency

`freepik_keys` rows store: encrypted key, `assigned_eur`, `used_eur`,
`max_concurrent` (default 8, per migration 0006), `is_active`,
`last_used_at`.

`pickActiveKey(costEur, excludeKeyIds)`:

1. `inflight` CTE counts in-flight tasks per key (`usage_logs`
   created in last 5 min with `status='succeeded'` and `video_url IS
   NULL`). Self-healing — crashed tasks stop counting after 5 min.
2. `picked` CTE selects the LRU active key where
   `assigned - used >= cost` AND `inflight < max_concurrent` AND
   `id NOT IN (excludeKeyIds)`.
3. `UPDATE` touches `last_used_at` so the next call picks a
   different key.

Uses plain `FOR UPDATE` (not `SKIP LOCKED`) — see audit #3 in
[`plans/audits/`](../plans/audits) for the rationale (`SKIP LOCKED`
caused spurious 503s under burst traffic with 1-key pools).

## Polling Strategy

Client side (`poll-task.ts`):
- Default `intervalMs = 2_000`, cap at 10s after backoff
- Default `maxTimeMs = 1_800_000` (30 min — bumped from 10 min in
  May 2026 for peak-hour Magnific rendering)
- Visibility-aware: hidden tab polls every 30s minimum
- Semaphore caps to 5 simultaneous polls across the whole tab

Server side (`createTaskGetHandler`):
- Per-code rate limit (60/min per resource) gates polls
- `authedFreepikCall` validates the bearer + picks a pool key
- `onSuccess` runs the R2 mirror + `finalizeUsageOnPoll`

## Data Model

```
freepik_keys         pool of upstream Freepik API keys (AES-GCM encrypted)
activation_codes     customer bearer codes (mode, quota_eur, used_eur)
usage_logs           one row per request (status, cost, video URLs, TTL)
pricing_rules        lookup matrix (endpoint, tier, duration, audio)
admin_sessions       SHA-256 cookie tokens (24h TTL)
rate_limit_buckets   fixed-window counters (cleaned by cron)
failed_logins        per-IP admin login throttle
```

Migrations live in [`drizzle/migrations/`](../drizzle/migrations); the
journal in `meta/_journal.json` is the source of truth for migration
order.

## Pricing

Per-second EUR rates seeded via `scripts/seed-pricing.ts`. Editable in
the admin dashboard.

| Endpoint        | Rate                                                   |
|-----------------|--------------------------------------------------------|
| `kling-v3` Std  | 0.168 / 0.308 EUR/s (no audio / audio) — calibrated 2026-05-06 |
| `kling-v3` Pro  | 0.224 / 0.392 EUR/s (no audio / audio) — calibrated 2026-05-06 |
| `kling-4k-t2v`  | 1.12 EUR/s (silent — no audio variant)                 |
| `kling-4k-i2v`  | 1.12 EUR/s (silent — no audio variant)                 |
| `wan-v27` 720P  | 0.20 EUR/s — uncalibrated placeholder                  |
| `wan-v27` 1080P | 0.30 EUR/s — uncalibrated placeholder                  |
| `improve-prompt`| 0.00 (free)                                            |

Kling 4K rate derivation: business rule pegs 4K at 2.857142857×
(=20/7) of the Kling V3 Pro 1080p with-audio rate. `0.392 × 20/7 = 1.12`
exactly.

## Storage

- **Source images (I2V)** — uploaded via `lib/upload/image-host.ts` →
  Cloudflare R2 → public URL passed to Magnific. Bucket lifecycle
  expires uploads after 24h.
- **Generated videos** — first `COMPLETED` poll downloads from
  Magnific and mirrors to R2 (`mirrorRemoteToR2` in `lib/storage/r2.ts`).
  Mirror URL is preferred (`usage_logs.video_url`); original Magnific
  URL kept in `magnific_video_url` for permanent record. R2 lifecycle
  expires the mirror after 6h, so `video_url_expires_at` tracks the
  client-facing TTL.

## Security Notes

- **Server-side activation only** — codes never leave the server unhashed.
- **API keys encrypted at rest** — AES-256-GCM, IV per row, key in
  `KEY_ENCRYPTION_SECRET` env. Decrypted only when picked by the
  orchestrator or when an admin views the keys page.
- **CRON_SECRET header** gates `/api/cron/purge` from public calls.
- **Per-code rate limits** on every paid POST (3/min default) and
  every GET poll (60/min). Counters live in `rate_limit_buckets`.
- **URL allowlist** (`lib/url-allowlist.ts`) blocks SSRF via
  `start_image_url` — Magnific fetches the URL server-side so an
  attacker could otherwise probe internal IPs.

## Vercel Deploy

- Region: `sin1` (singapore, closest to VN customers)
- Cron: `vercel.json` registers `/api/cron/purge` at `0 2 * * *` UTC
- Function timeout: `maxDuration = 60` on poll routes; default 10s
  on POST. The 10s ceiling is why the orchestrator emits
  `CHARGE_SLOW` at 5s and `CHARGE_INITIATED`/`CHARGE_COMMITTED`
  bookends — kills mid-flight are observable in logs.

## Local Dev Caveat

⚠️ Local + production currently share the same database and secrets
([open issue #2](https://github.com/phamdangchung94/openfreepik/issues/2)).
Every `pnpm dev` query hits production data; every
`pnpm db:seed-pricing` writes to production. The isolation playbook
lives in [`RUNBOOK.md`](RUNBOOK.md#required-env-vars). Until that
lands, treat dev as a production session.
