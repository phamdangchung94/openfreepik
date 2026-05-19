# OpenFreepik Operations Runbook

Production: **https://openfreepik.vercel.app**
Admin dashboard: **https://openfreepik.vercel.app/dashboard**
Customer-facing: same URL, no `/dashboard`.

> **Read first**: this is the guide you reach for when something is broken at 2 AM. Linear, command-first, no narrative.

---

## Quick links

| Resource | URL |
|----------|-----|
| Vercel project | https://vercel.com/chugaxs-projects/openfreepik |
| Vercel deployments | https://vercel.com/chugaxs-projects/openfreepik/deployments |
| Vercel logs (live) | https://vercel.com/chugaxs-projects/openfreepik/logs |
| Vercel env vars | https://vercel.com/chugaxs-projects/openfreepik/settings/environment-variables |
| Neon project | https://console.neon.tech (Project: openfreepik / db: neondb) |
| GitHub repo | https://github.com/phamdangchung94/openfreepik |
| Open audit reports | [`plans/audits/`](../plans/audits/) |
| Schema | [`src/lib/db/schema.ts`](../src/lib/db/schema.ts) |

## Required env vars

All of these are set in Vercel production AND mirrored in `.env.local` for development. `DATABASE_URL` in `.env.local` points to the Neon `dev` branch (split landed 2026-05-12 — audit #2 closed). Other secrets currently mirror production values; rotate the dev branch's `KEY_ENCRYPTION_SECRET` later if you need full isolation of the encrypted key blobs too.

| Var | Purpose | Rotation impact |
|-----|---------|-----------------|
| `DATABASE_URL` | Neon pooled connection | Redeploy needed; new conn string takes effect on next request |
| `KEY_ENCRYPTION_SECRET` | AES-GCM key for Freepik keys at rest | **All existing Freepik keys decrypt fail** — must re-encrypt every row before swap |
| `ADMIN_PASSWORD` | Login to `/dashboard` | Active admin sessions still valid until cookie expires (24h) |
| `ADMIN_SESSION_SECRET` | Cookie session validation | All admin sessions invalidated immediately on rotation |
| `CRON_SECRET` | Bearer for all `/api/cron/*` routes: `purge` (daily), `sweep-orphan-charges` (15min), `sweep-expired-urls` (6h) | Vercel Cron auto-uses the new value on next scheduled run |
| `WEBHOOK_BASE_URL` | Optional override for Magnific webhook callback (e.g. custom domain). Falls back to `https://${VERCEL_PROJECT_PRODUCTION_URL}` when `VERCEL_ENV=production`. | None — read fresh on every POST to `/api/freepik/*` |
| `TELEGRAM_BOT_TOKEN` | Optional. Bot token from @BotFather. When set together with `TELEGRAM_CHAT_ID`, critical events (`ALL_KEYS_EXHAUSTED`, `KEY_AUTO_DEACTIVATED`, `ORPHAN_CHARGE_REFUNDED`, etc.) send a Telegram DM to admin. When unset, alerts are silently no-op (still logged). | None — read fresh on every alert |
| `TELEGRAM_CHAT_ID` | Optional. Numeric chat id for the bot to message. Get from `https://api.telegram.org/bot<TOKEN>/getUpdates` after `/start`-ing the bot. | None |

---

## Incident response

### 1. Production rollback

When the latest deploy broke something:

```bash
# List recent deploys (latest first)
pnpm dlx vercel deployments ls --token $VERCEL_TOKEN

# Promote the previous good deploy
pnpm dlx vercel promote <deployment-id> --token $VERCEL_TOKEN
```

Verify rollback: `curl -sI https://openfreepik.vercel.app/` returns 200 + the security headers from `next.config.ts`.

### 2. Hotfix without rolling back

Push a commit to the production branch (currently `main` after merge, or `claude/confident-blackburn-2db440` before). Vercel auto-deploys. If you need a faster path, use CLI:

```bash
pnpm dlx vercel deploy --prod --token $VERCEL_TOKEN --yes
```

---

## Routine operations

### Add a new Freepik API key (when current one is exhausted)

1. Go to https://openfreepik.vercel.app/dashboard → **Freepik keys** → **Add key**
2. Paste plaintext API key (starts with `FPSX...`)
3. **Webhook secret (optional)** — if you've registered the OpenFreepik webhook URL on this Magnific account, paste its signing secret here. Without it, Magnific won't deliver push callbacks for tasks served by this key and the client polls drive finalization. Either path is fine — webhook just trims polling latency.
4. Set `assignedEur` to whatever Freepik gave you (default 500 EUR free tier)
5. Submit — both secrets are AES-GCM encrypted before insert
6. New requests pick the LRU active key, so the new one starts taking traffic immediately
7. Optional: deactivate the exhausted key to remove from rotation: dashboard → key card → **Deactivate**

> ⚠️ **Single-key risk** (audit `$4`): production currently runs with exactly 1 key. A 5-second outage of that key = full service outage. Add a 2nd Freepik account and provision a backup key.

### Configure webhook delivery for a Magnific account

Magnific's push delivery cuts customer wait time from "poll every 2-10s" to "instant fan-out". One-time setup per Freepik key:

1. Log into the Magnific dashboard for that account → API → Webhooks.
2. Register endpoint `https://openfreepik.vercel.app/api/freepik/webhook` (or your custom domain → same path).
3. Magnific shows a signing secret (often hex-encoded). Copy it.
4. Open the OpenFreepik admin dashboard → **Freepik keys** → edit the matching key → paste the secret.
5. Verify: trigger a small generation, watch logs for `WEBHOOK_RECEIVED`. The companion poll route still runs as a safety net.

Signature verification uses HMAC-SHA256 over `${webhook-id}.${webhook-timestamp}.${raw-body}`. We try the secret as UTF-8 raw bytes, hex-decoded, and base64-decoded so different Magnific surface formats all work. Replay window is 5 min.

### Dev / production database split (audit #2 — DONE 2026-05-12)

Neon project has two branches now:
- **`production`** — primary, default. Used by Vercel prod + preview deploys via `DATABASE_URL`.
- **`dev`** — copy-on-write snapshot. Used by local `pnpm dev` / `db:*` scripts via the `DATABASE_URL` in `.env.local`.

Operations:

- **Apply a schema migration to dev first**: `pnpm db:migrate` (runs against dev). Once it works, paste the SQL into the Neon Console SQL editor under the `production` branch — or wait for the next prod deploy to run migrations as part of build.
- **Reset dev from prod** (e.g. before testing a destructive change against fresh data): Neon Console → `dev` branch → **Reset from parent**. Instant.
- **Pull a fresh dev snapshot after a major prod write** (e.g. customer support manually fixed something on prod): same Reset from parent.
- **Promote a dev change to prod** (e.g. you tested a migration on dev and want it live): Neon doesn't auto-promote — apply the migration to `production` separately, either via the SQL editor or `pnpm db:migrate` against a temporary `.env.local` pointed at prod.

Caveats:
- `KEY_ENCRYPTION_SECRET` still mirrors prod (so dev can decrypt the snapshot's `freepik_keys`). If you want full isolation of the encrypted-key blob — useful for testing key-rotation — generate a separate dev secret and re-encrypt the dev branch's `freepik_keys` rows.
- Webhook delivery currently points at prod URL; webhooks from your dev tasks will hit prod's `/api/freepik/webhook` (signature mismatch → ignored). Acceptable today; add a separate `WEBHOOK_BASE_URL` once you start regular dev-side video testing.

### Mint an activation code for a new customer

```bash
# CLI (preferred for scripting)
pnpm admin:create-code -- --mode=quota --quota=200 --label="Customer name"

# OR via dashboard: /dashboard/codes → Create code
```

Copy the `FK-XXXXX-XXXXX-...` string and send to customer over a secure channel (email/Signal). They paste it into the activation input on the homepage.

### Bulk-mint N codes with auto-numbered labels (Phase 2.1)

Dashboard → **Codes** → **Bulk create**. Fill:
- **Prefix**: e.g. `ABC` or `5-XuanHuy`
- **Số bắt đầu**: usually 1
- **Số lượng**: 1-200 (capped server-side)
- **Mode** + **Quota EUR** + optional **Hết hạn**: applied to every code

Codes get labels `ABC-001`…`ABC-050` (auto-padded to constant width).
Code values stay random (still `FK-XXX...`) so they can't be guessed
from the label. After mint: "Copy all (TSV)" pastes into any sheet,
"Download .txt" exports a flat list. Codes shown ONCE — save before
closing the dialog.

### Bulk revoke / reactivate / topup (Phase 2.2)

Dashboard → **Codes** → tick checkboxes (or the header checkbox for
all-on-page) → floating action bar:
- **Revoke** / **Reactivate**: flip `is_active`
- **Top up**: dialog asks EUR; applies to every selected code BUT
  silently skips non-`topup`-mode codes (server-side filter). Response
  reports `requested vs updated vs skipped`.

Cap 200 ids per call.

### Drill into one code's usage (Phase 2.3)

Dashboard → **Codes** → click the **label** of any row → opens
`/dashboard/codes/[id]`. Shows:
- 4 status-rollup cards (succeeded / failed / refunded / pending)
- 30-day daily spend bars (text sparkline, no chart library)
- Last 50 tasks with prompts + error messages
- **Export CSV**: full task history up to 5000 rows, UTF-8 BOM (opens
  cleanly in Excel)

Use this when a customer asks "where did my money go". Email them the
CSV.

### Impersonate a customer to reproduce a bug (Phase 2.4)

Drilldown page → **Impersonate** button. Two-step confirm, then:
1. Customer's activation code is copied to your clipboard
2. New tab opens at `/`
3. Paste code into the activation input

Audit log `ADMIN_IMPERSONATE_CODE` fires every call. Code is bearer-
equivalent — DON'T leave the tab open on a shared screen. Refused if
code is inactive (reactivate first).

### Revoke an activation code (lost / shared)

Dashboard → **Codes** → row → **Revoke**. Customer's next request gets HTTP 401 immediately. No grace period.

### Top up a `topup`-mode code

Dashboard → **Codes** → row → **Top-up** → enter EUR to add. Atomic SQL increment, race-safe under concurrent customer charges.

### Manage Freepik keys (Phase 1.1)

Dashboard → **Keys**. Default filter shows only keys with `is_active=true` AND `used_eur < assigned_eur` (i.e. actually usable). Hidden keys count appears in header; toggle **Hiện tất cả** to surface inactive/exhausted.

Each key card has:
- **Deactivate** / **Reactivate**: flip `is_active`. Logs `KEY_DEACTIVATED_BY_ADMIN` (distinguishes from `KEY_EXHAUSTED` auto-deactivate)
- **Xoá** (trash icon): two-step confirm (yes/no + type the key label). API refuses 409 if key has pending tasks.
- **Probe** (lightning): forces a healthcheck against Magnific; updates `paused_until` if 429, deactivates if 401

Auto-pause behavior (cron `/api/cron/purge` daily): probe → 401 = auto-deactivate (Telegram critical), 429 = `paused_until = now+1h` (Telegram warn, key skipped by `pickActiveKey` during window, auto-resumes).

### Post an announcement to all customers

Dashboard → **Announcements** → **+ Mới**:

- **Tiêu đề** + **Nội dung**: shown verbatim on the customer banner. Plain text, max 200 / 2000 chars.
- **Mức độ**: `info` (xanh, neutral) · `warn` (cam, attention) · `critical` (đỏ, urgent — maintenance, outage).
- **CTA label + URL** (optional): renders a link in the banner. URL must start with `http(s)://` or `/` (internal path); other schemes silently rejected.
- **Hết hạn** (optional): admin schedules auto-hide. Leave empty → banner shows until you toggle `active=false` or delete it.
- **Bật ngay**: defaults on; toggling off keeps the draft hidden.

Customers see the banner within ~60s (client polls `/api/announcements` every 60s) — no reload needed for online users. Per-device dismiss tracked in localStorage by id; new banners surface on every device until dismissed there.

To hide a live announcement: row → **Bật** toggle off. To delete permanently: row → trash icon (irrecoverable).

Common patterns:
- Scheduled maintenance: `critical` severity, set `expiresAt` to end of window so it auto-hides.
- New feature: `info` severity, CTA to `/pricing` or feature page.
- Outage update: `critical` severity, no expiry, manually toggle off when resolved.

### Rotate `KEY_ENCRYPTION_SECRET` (only if compromised)

This is **destructive** if done wrong because all existing Freepik keys re-encrypt with the new secret. Procedure:

1. Generate new secret: `openssl rand -base64 32`
2. Write a one-shot migration script that decrypts every `freepik_keys.key_encrypted` with the OLD secret, re-encrypts with the NEW, updates each row in a transaction
3. Set new env var on Vercel (`vercel env rm KEY_ENCRYPTION_SECRET production && vercel env add ...`)
4. Redeploy
5. Verify by hitting `/api/freepik/kling-v3` with a real bearer — successful generation means decryption works

Keep the old secret for ~24h until you've confirmed end-to-end flow on the new one.

### Rotate `ADMIN_PASSWORD`

Trivial. `vercel env rm ADMIN_PASSWORD production`, then `vercel env add ADMIN_PASSWORD production` and paste the new value. Redeploy. Log out and log back in to verify.

### Rotate `ADMIN_SESSION_SECRET`

Anyone with an active admin cookie gets logged out immediately on next request. Schedule for low-traffic hours.

### Rotate `DATABASE_URL` (Neon password reset)

1. Neon console → Project → **Roles** → `neondb_owner` → **Reset password** → copy new pooled connection string
2. `vercel env rm DATABASE_URL production && vercel env add DATABASE_URL production` → paste
3. Redeploy
4. Verify: `curl https://openfreepik.vercel.app/api/admin/overview` (need a valid admin cookie)

---

## Database management

### Apply a new schema migration

```bash
# Generate migration SQL from drizzle/migrations/
pnpm db:generate    # Drizzle Kit watches src/lib/db/schema.ts diff

# Apply locally first
pnpm db:migrate

# Once verified locally, the SAME migration runs against production on
# the next `pnpm db:migrate` against the prod DATABASE_URL.
DATABASE_URL=<prod-pooled-url> pnpm db:migrate
```

### Rolling back a bad migration

Drizzle does NOT auto-generate down migrations. You write the inverse manually:

1. Identify the broken migration: `drizzle/migrations/<n>_<name>.sql`
2. Write `drizzle/migrations/<n+1>_revert_<name>.sql` with the inverse statements (e.g., `DROP TABLE` for `CREATE TABLE`)
3. Apply via `pnpm db:migrate`
4. Update `src/lib/db/schema.ts` to remove the bad changes
5. Run `pnpm db:generate` to confirm schema and migrations match

### Manual hot-fix on production data

Use Neon's web SQL console: https://console.neon.tech → Project → **SQL Editor**. Avoid running queries from your local terminal against prod (footgun).

Common queries:

```sql
-- See current state
SELECT * FROM activation_codes ORDER BY created_at DESC LIMIT 10;
SELECT * FROM freepik_keys WHERE is_active;
SELECT * FROM usage_logs ORDER BY created_at DESC LIMIT 20;

-- Manual refund (audit #4 fallback)
UPDATE activation_codes SET used_eur = used_eur - 0.50 WHERE id = '<code-uuid>';

-- Force-revoke a code
UPDATE activation_codes SET is_active = false WHERE code = 'FK-XXXXX-...';

-- Unlock a stuck IP
DELETE FROM failed_logins WHERE ip = '1.2.3.4';
```

---

## Monitoring & observability

### Where to look first when something's wrong

1. **Vercel logs**: https://vercel.com/chugaxs-projects/openfreepik/logs — live tail. Filter by:
   - `event="REFUND_FAILED"` — manual reconciliation needed
   - `event="ALL_KEYS_EXHAUSTED"` — pool fully drained, urgent
   - `event="ORCHESTRATOR_UNEXPECTED"` — uncaught error path
   - `event="CRON_PARTIAL"` — purge job had a failure
2. **Vercel functions tab**: error rate per route, p50/p99 latency
3. **Admin dashboard `/dashboard`**: code count, key budget remaining, today's usage
4. **Neon dashboard → Monitoring**: connection count, slow queries, storage size

### Structured log events worth alerting on

Events are emitted by `src/lib/logger.ts` as single-line JSON. Critical
ones also trigger a Telegram DM via `logAndAlert()` when bot is
configured (see Setup Telegram alerts below).

**Money / customer-facing**:

| Event | Severity | Source | Action |
|-------|----------|--------|--------|
| `REFUND_FAILED` | CRITICAL | orchestrator-helpers | Inspect `codeId` + `amountEur`; manual SQL refund via Neon console |
| `POLL_REFUND_FAILED` | CRITICAL | poll path finalize | Row marked refunded but balance not restored — manual SQL |
| `ALL_KEYS_EXHAUSTED` | HIGH | orchestrator | Add Freepik key OR reactivate paused ones; customers seeing 503. Telegram alert fires automatically. |
| `ORPHAN_CHARGE_REFUNDED` | INFO | sweep-orphan-charges cron | Auto-refund happened; no action needed unless frequent (then investigate root crash cause) |
| `ORPHAN_SWEEP_OVER_CAP` | CRITICAL | sweep-orphan-charges cron | Sweeper found 50+ orphans — likely system-wide outage. Investigate before re-enabling |
| `CHARGE_INITIATED` w/o matching `CHARGE_COMMITTED` | CRITICAL | orchestrator | Function crashed mid-call; sweep-orphan-charges (15min) will auto-refund |

**Key pool**:

| Event | Severity | Source | Action |
|-------|----------|--------|--------|
| `KEY_EXHAUSTED` | HIGH | markKeyExhausted (any caller) | Upstream account out of credit; topup Magnific OR add new key |
| `KEY_AUTO_DEACTIVATED` | CRITICAL | probe-quota healthcheck | Probe got 401/403 — Magnific revoked key; re-issue + re-add |
| `KEY_AUTO_PAUSED` | WARN | probe-quota healthcheck | Probe got 429; key auto-paused 1h (`paused_until` set), auto-resumes |
| `KEY_SLOW` | WARN | probe-quota healthcheck | Probe > 5s; upstream degraded — check Magnific status |
| `KEY_DEACTIVATED_BY_ADMIN` / `KEY_REACTIVATED_BY_ADMIN` | INFO | admin PATCH `/api/admin/keys/[id]` | Audit trail; admin manual action vs auto-deactivate |
| `KEY_PROBE_FAILED` | MED | probe-quota healthcheck | Network/5xx/timeout — don't auto-deactivate (transient) |

**Operational**:

| Event | Severity | Source | Action |
|-------|----------|--------|--------|
| `CRON_MISCONFIGURED` | HIGH | any cron route | `CRON_SECRET` not set on Vercel — re-add env var + redeploy |
| `CRON_PARTIAL` | LOW | purge cron | Tomorrow's run will retry; escalate if 3+ days |
| `EXPIRED_URLS_SWEPT` | INFO | sweep-expired-urls cron | Healthy clean-up; `cleared: N` = dead R2 URLs nulled |
| `ORPHAN_SWEEP_STARTED` / `ORPHAN_SWEEP_DONE` / `ORPHAN_SWEEP_CLEAN` | INFO | sweep-orphan-charges cron | Heartbeat; if absent for 1h+, cron stopped running |
| `ADMIN_IMPERSONATE_CODE` | INFO | impersonate endpoint | Audit; admin took a customer's bearer code |
| `ADMIN_R2_CLEANUP` | INFO | r2-cleanup endpoint | Audit; admin manually deleted R2 objects |

### Detecting orphan charges — automated via cron (Phase 1.5)

The orchestrator emits a `CHARGE_INITIATED` log right before charging
the activation code, then `CHARGE_COMMITTED` after the Freepik call
succeeds. If the function crashes between those two logs you get an
orphan — customer charged with no usage row.

**Automated detection + refund** (`/api/cron/sweep-orphan-charges`,
every 15min): scans `usage_logs` for rows stuck in `status='pending'`
for >10min, flips to `refunded`, calls `refundCode()`, fires
`ORPHAN_CHARGE_REFUNDED` log + Telegram alert with task IDs. Cap 50
orphans per sweep; over-cap = `ORPHAN_SWEEP_OVER_CAP` (critical alert,
no auto-action).

Manual sweep trigger (e.g. immediately after a known crash):
```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://openfreepik.vercel.app/api/cron/sweep-orphan-charges
```

If the customer was already refunded by the sweep but admin still
needs to confirm via SQL:
```sql
SELECT id, status, cost_eur, error_message, created_at
FROM usage_logs
WHERE freepik_task_id = '<task_id from log>';
-- Expected: status='refunded', error_message contains 'ORPHAN_CHARGE_AUTO_REFUNDED'
```

### Setup Vercel Log Drain (audit #14, optional 15min)

To persist logs beyond Vercel's 1h Hobby buffer:

1. Sign up for a free log destination: [Better Stack (recommended)](https://betterstack.com/), [Logtail](https://logtail.com/), or [Datadog](https://datadog.com/) free tier
2. Get the drain URL/token from your provider
3. Vercel project → **Settings** → **Log Drains** → **Add Drain**
4. Paste URL, set format = JSON, environments = Production
5. Test by hitting `/api/cron/purge` with the bearer; structured JSON appears in your destination within ~10s

### Setup Telegram alerts (Phase 1.3 — optional, 5min)

Pipes critical events directly to admin's Telegram DM so incidents don't wait for log inspection.

1. **Create the bot**: open Telegram → message `@BotFather` → `/newbot` → follow prompts. Save the token (`123456:ABC-DEF...`).
2. **Get your chat id**: start a chat with your new bot, send `/start`. Then visit `https://api.telegram.org/bot<TOKEN>/getUpdates` and copy `result[0].message.chat.id` (a number like `987654321`).
3. **Set Vercel env vars**:
   ```bash
   vercel env add TELEGRAM_BOT_TOKEN production
   # paste the token
   vercel env add TELEGRAM_CHAT_ID production
   # paste the chat id
   ```
4. **Redeploy** to pick up the env vars (or wait for next push).
5. **Test**: trigger any handler that calls `logAndAlert()`. Easiest = temporarily call `sendAlert({severity:"info", event:"TEST", title:"alerts working"})` from a dev route.

**Without these vars**: `src/lib/alerts/telegram.ts` becomes a no-op. Alerts still write to logs; just no Telegram delivery. Safe to ship code that uses `logAndAlert()` before the bot is set up.

**Events hooked**:
- `ALL_KEYS_EXHAUSTED` (critical) — orchestrator panic, refunds happening
- `KEY_AUTO_DEACTIVATED` (critical) — probe returned 401/403, key revoked
- `KEY_AUTO_PAUSED` (warn) — probe returned 429, key paused 1h
- `KEY_SLOW` (warn) — probe took >5s
- `ORPHAN_CHARGE_REFUNDED` (warn) — sweeper found pending task >10min, refunded
- `ORPHAN_SWEEP_OVER_CAP` (critical) — sweeper found >50 orphans in one run (likely outage)

### Orphan charge sweeper (Phase 1.5)

`/api/cron/sweep-orphan-charges` runs every 15min. Finds `usage_logs` rows stuck at `status='pending'` for >10min and refunds them (`refundCode` → flip status to `refunded`, log + Telegram alert).

**Manual run** (to test or recover from a stuck state):
```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://your-domain/api/cron/sweep-orphan-charges
```

**Tuning**: orphan age threshold is `ORPHAN_AGE_MINUTES = 10` in `src/app/api/cron/sweep-orphan-charges/route.ts`. Bump if customer has legitimate long-running tasks; lower if you want faster refund-visible behavior. Cap is `MAX_REFUNDS_PER_SWEEP = 50` — if a single sweep hits that, the script bails and sends critical alert instead of refunding blindly (likely a system-wide outage or clock bug).

**False-positive risk**: if a webhook is delayed past 10min, the sweep will refund a task that later succeeds. Customer gets the video *and* a refund. Acceptable since (a) failures are far more common than late webhooks, (b) the customer wins from any false positive. If this happens often, raise the threshold to 15min.

---

## Storage operations (R2)

### Bucket overview

- **Bucket**: `openfreepik`, public-read
- **Key shape**: `videos/<freepikTaskId>.mp4` (flat, no nesting)
- **Lifecycle rule**: delete objects after **1 day** (24h). Rule name
  is historically `auto-delete-6h` — action was edited to 1 day, name
  wasn't renamed. Don't be confused.
- **Critical gotcha**: lifecycle Prefix field MUST be empty or
  `videos/` (no leading slash). Setting `/videos` causes the rule to
  match zero objects → bucket grows unbounded. Cloudflare UI does not
  validate this.

### Verify lifecycle is actually deleting — `/api/admin/r2-audit`

Admin-only GET. Returns age distribution + lifecycle rule list + a
verdict so you don't have to interpret numbers.

In a browser tab logged into admin:
```js
await fetch('/api/admin/r2-audit').then(r => r.json())
```

Response highlights:
- `verdict: "ok"` → all objects < 24h, lifecycle healthy
- `verdict: "stragglers_24-48h"` → normal; R2 daily sweep allows 24-48h grace
- `verdict: "broken_>48h"` → rule misconfigured (check `lifecycleRules[].prefix` field verbatim)
- `wholeBucket.byPrefix[]` → if dashboard "Bucket Size" differs from `videos/` total, the gap lives elsewhere
- `multipart.pendingUploads` → orphan multipart parts hold space silently; R2 default rule aborts after 7 days

Dashboard "Bucket Size" metric is **cached and lags** (4-24h after
bulk changes) — trust this endpoint, not the dashboard.

### Manual cleanup — `/api/admin/r2-cleanup`

Backstop for when lifecycle is broken or you want stale data gone NOW
instead of waiting for the natural R2 sweep (1-3 days). POST with
dry-run by default.

Dry-run preview (default):
```js
await fetch('/api/admin/r2-cleanup?maxAgeHours=48', { method: 'POST' }).then(r => r.json())
```

Live delete (must pass explicit `dryRun=false`):
```js
await fetch('/api/admin/r2-cleanup?maxAgeHours=48&dryRun=false', { method: 'POST' }).then(r => r.json())
```

Caps:
- 1000 deletions per call (DeleteObjects API limit)
- Scans first 10K objects under `videos/` prefix
- ListObjectsV2 returns lexicographic order, NOT date — re-run if you hit cap

Logs `ADMIN_R2_CLEANUP` for audit.

### Expired video URL handling (3-layer)

When R2 deletes an object at 24h, the customer's saved task still has
the dead URL. Without cleanup customer sees broken `<video>` tag.
Layers:

1. **Server**: cron `/api/cron/sweep-expired-urls` (every 6h) sets
   `usage_logs.video_url = NULL` where `video_url_expires_at < now()`.
   Keeps `magnific_video_url` (permanent record).
2. **Client**: hook `useExpiredUrlCleaner` (mount + 5min interval)
   nulls `videoUrl + thumbnailUrl` in task store for tasks past expiry.
3. **UI**: `ExpiredVideoPanel` renders Clock icon + "Video đã hết hạn"
   message when `status=COMPLETED && !videoUrl`. Tải về button auto-
   hides; Tạo lại still works.

No action needed in normal operation; if cron stops firing,
`EXPIRED_URLS_SWEPT` event will be absent from logs (alert window: 12h).

---

## Cost & quota dashboard

| Resource | Plan | Soft limit | Hard limit | Upgrade trigger |
|----------|------|-----------|------------|-----------------|
| Vercel | Hobby (free) | 100h function execution / month | Same | Customer #5 (audit `$2`) |
| Vercel | Pro ($20/mo) | Unlimited execution | Bandwidth, function memory | — |
| Neon | Free | 191.9 compute hours / mo, 0.5 GB storage | Same | Customer #80 (audit `$1`) |
| Neon | Pro ($19/mo) | 300 compute hours / mo, 10 GB storage | Same | — |
| Freepik | Per-account | 500 EUR free credit | Same | Add 2nd account when 1st <100 EUR remaining |

Check current usage:
- Vercel: https://vercel.com/chugaxs-projects/openfreepik/usage
- Neon: console → Project → **Monitoring** → "Compute hours used this billing period"
- Freepik: https://www.freepik.com/api/dashboard (per account)

---

## Common scenarios

### "Customer says they were charged but no video"

1. Find their code in the dashboard `/dashboard/codes`
2. Cross-reference `usage_logs` (Neon SQL editor): `SELECT * FROM usage_logs WHERE code_id = '<id>' ORDER BY created_at DESC LIMIT 20`
3. If status = `succeeded` and `video_url` is set → URL works, customer just hasn't refreshed history
4. If status = `succeeded` but `video_url` is null → Freepik task likely still polling; check `freepik_task_id` against Freepik's API directly
5. If status = `refunded` → balance was reverted; tell customer to retry
6. If status = `failed` and balance still deducted → grep Vercel logs for `REFUND_FAILED` event with that codeId; manual SQL refund

### "Generation requests time out"

1. Vercel logs filter: `event="ALL_KEYS_EXHAUSTED"`. If present → all Freepik keys hit quota; add a new one (above)
2. If not: check Vercel function tab for 504 timeouts. Freepik upstream may be slow → patience or escalate to Freepik support
3. Check Vercel quota: are we OUT of function execution hours? → upgrade to Pro

### "Admin login locked out"

You hit the brute-force protection (audit fix #8). Two options:
- Wait 15 min, retry with correct password
- Manual unlock via Neon: `DELETE FROM failed_logins WHERE ip = '<your IP>';`

Find your IP at https://api.ipify.org or via Vercel logs.

### "I deployed and the site is broken"

1. **Roll back first** (5 sec): `vercel deployments ls` → `vercel promote <previous>`
2. THEN diagnose what broke at leisure

---

## Emergency contacts

| Role | Channel |
|------|---------|
| You (admin) | (your email) |
| Freepik API support | https://www.freepik.com/profile/support |
| Neon support | https://neon.tech/docs/introduction/support |
| Vercel support | https://vercel.com/support (Pro tier only — Hobby is community Discord) |

---

## Kling Motion Control (added 2026-05-19)

Replaces WAN 2.7 in the customer-facing model picker (WAN routes/lib/
pricing rows kept for revert — see `model-picker.tsx` commented option).
4 endpoints, customer picks tier + reference video + output duration.

| Tier         | Rate     | Endpoint slug              |
|--------------|----------|----------------------------|
| 2.6 Standard | 0.059€/s | `kling-motion-v2-6-std`    |
| 2.6 Pro      | 0.118€/s | `kling-motion-v2-6-pro`    |
| 3.0 Standard | 0.126€/s | `kling-motion-v3-std`      |
| 3.0 Pro      | 0.168€/s | `kling-motion-v3-pro`      |

Routes: `/api/freepik/kling-motion/[tier]` (POST) + `/[taskId]` (GET poll).

**Output duration model**: Magnific has no `duration` API field — output
length is implied by `character_orientation` (`video`=30s cap,
`image`=10s cap). The customer's chosen `output_duration` (5/10/15/30s)
flows through the route body for pricing lookup only.

**Reference video upload**: 3-30s, MP4/MOV/WEBM/M4V, ≤50MB. Uploaded
via `uploadVideoToHost` (litterbox.catbox.moe; 24h TTL is fine since
Magnific consumes the URL within seconds of POST).

**To revert WAN visibility**: uncomment the `wan-v27` option in
`src/components/generator/model-picker.tsx` + the `<WanSection />` in
`src/app/(customer)/pricing/page.tsx`. Backend routes are intact.

**Pricing seed**: `scripts/seed-kling-motion-pricing.sql` — 16 rows,
idempotent (DELETE-then-INSERT). Applied to prod 2026-05-19.

---

## Audit-driven backlog (as of 2026-05-19)

See [`plans/audits/`](../plans/audits/) for full reports.

**Resolved in Phase 1-5 roadmap** (Apr-May 2026):

| Issue | Resolution |
|-------|------------|
| #2 | DONE 2026-05-12 — Neon dev/prod branch split |
| #5 | DONE Phase 1.5 — automated orphan charge sweeper (`/api/cron/sweep-orphan-charges`, 15min) replaced manual log alert + SQL refund |
| #14 | DONE Phase 1.3 — Telegram bot wrapper (`src/lib/alerts/telegram.ts`), log drain instructions in this RUNBOOK |
| KEY_EXHAUSTED misclassification | DONE Phase 2.5 — `markKeyExhausted` now logs verbatim from any caller; admin PATCH path logs `KEY_DEACTIVATED_BY_ADMIN` distinguishably |
| Missing test coverage on financial code | DONE Phase 5.2 — 46 tests added across `pricing/calculator`, `auth/activation`, `freepik/orchestrator-helpers` |
| Polling fixed-rate retry | DONE Phase 5.4 — exponential backoff (2s→30s cap) + 5-consecutive-error hard-abort |
| Customer sees broken `<video>` after R2 deletes object | DONE — 3-layer cleanup (sweep-expired-urls cron + useExpiredUrlCleaner hook + ExpiredVideoPanel UI) |

**Still open / manual**:

| Issue | Severity | Owner / status |
|-------|----------|---------------|
| [#9](https://github.com/phamdangchung94/openfreepik/issues/9) | P0 | **Manual** — verify pricing matrix vs Freepik dashboard periodically |
| Single Freepik upstream account | P1 | When 1st key hits 80% used or shows degradation, register 2nd Magnific account, add via `/dashboard/keys` (failover code already supports pool of N) |
| Page decomposition (`keys/page.tsx` 800 lines, `usage-table.tsx` 675, `codes/page.tsx` 606) | P2 | DEFERRED Phase 5.1 — cosmetic, no functional gain |
| Email notifications + scheduled maintenance toggle | P2 | DEFERRED Phase 4 — Telegram alerts already cover admin-side; customer-side email pending demand |

Every closed audit fix has its commit linked in the git log.
