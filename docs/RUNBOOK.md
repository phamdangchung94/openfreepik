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

All of these are set in Vercel production AND mirrored in `.env.local` for development. **Local and production should NOT share values** (audit #2 — currently violated, fix when convenient).

| Var | Purpose | Rotation impact |
|-----|---------|-----------------|
| `DATABASE_URL` | Neon pooled connection | Redeploy needed; new conn string takes effect on next request |
| `KEY_ENCRYPTION_SECRET` | AES-GCM key for Freepik keys at rest | **All existing Freepik keys decrypt fail** — must re-encrypt every row before swap |
| `ADMIN_PASSWORD` | Login to `/dashboard` | Active admin sessions still valid until cookie expires (24h) |
| `ADMIN_SESSION_SECRET` | Cookie session validation | All admin sessions invalidated immediately on rotation |
| `CRON_SECRET` | Bearer for `/api/cron/purge` | Vercel Cron auto-uses the new value on next scheduled run |
| `WEBHOOK_BASE_URL` | Optional override for Magnific webhook callback (e.g. custom domain). Falls back to `https://${VERCEL_PROJECT_PRODUCTION_URL}` when `VERCEL_ENV=production`. | None — read fresh on every POST to `/api/freepik/*` |

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

### Separate the dev database from production (audit #2)

The default Neon project ships with one branch; `pnpm dev` and production currently share it. To isolate:

1. Neon Console → project `openfreepik` → **Branches** → **New branch** → name `dev`, copy data from `main`. Snapshot is instant — branches share storage, so the dev branch is free until it diverges.
2. Click the new branch → **Connection string** → copy.
3. Update local `.env.local`: replace `DATABASE_URL` with the dev branch's connection string. Production Vercel env stays pointed at `main`.
4. (Optional) Add a `DATABASE_URL` override in Vercel's **Development** environment with the dev branch — so any future Vercel CLI dev runs also stay isolated.
5. Reset dev branch back to current prod state any time: Neon Console → branch `dev` → **Reset from parent**. Useful before testing migrations.

After the split: `pnpm db:migrate` and `pnpm db:seed-pricing` only touch the dev branch. Apply the same migration to prod via the Neon SQL editor or by promoting the dev branch when ready.

### Mint an activation code for a new customer

```bash
# CLI (preferred for scripting)
pnpm admin:create-code -- --mode=quota --quota=200 --label="Customer name"

# OR via dashboard: /dashboard/codes → Create code
```

Copy the `FK-XXXXX-XXXXX-...` string and send to customer over a secure channel (email/Signal). They paste it into the activation input on the homepage.

### Revoke an activation code (lost / shared)

Dashboard → **Codes** → row → **Revoke**. Customer's next request gets HTTP 401 immediately. No grace period.

### Top up a `topup`-mode code

Dashboard → **Codes** → row → **Top-up** → enter EUR to add. Atomic SQL increment, race-safe under concurrent customer charges.

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

| Event | Severity | Action |
|-------|----------|--------|
| `REFUND_FAILED` | CRITICAL | Inspect `codeId` and `amountEur` fields; manual SQL refund via Neon console |
| `ALL_KEYS_EXHAUSTED` | HIGH | Add another Freepik key immediately; customers seeing 503 |
| `ORCHESTRATOR_UNEXPECTED` | MED | Read `errMessage` field; usually points to Freepik API change |
| `CRON_PARTIAL` | LOW | Tomorrow's run will retry; only escalate if 3+ days in a row |
| `CRON_MISCONFIGURED` | HIGH | `CRON_SECRET` not set on Vercel — re-add env var + redeploy |
| `CHARGE_INITIATED` w/o matching `CHARGE_COMMITTED` | CRITICAL | Function crashed mid-call. Look up `requestId`, find `codeId` + `costEur`, refund manually via SQL |
| `CHARGE_SLOW` | MED | Request still running >5s — usually slow Freepik. If clustered, check Freepik status page |

### Detecting orphan charges (audit #5)

The orchestrator emits a `CHARGE_INITIATED` log right before charging
the activation code, then `CHARGE_COMMITTED` after the Freepik call
succeeds and the usage row is written. Both share a `requestId`.

If the function crashes between those two logs (Vercel timeout, OOM,
deploy mid-request) you'll see an INITIATED with no matching
COMMITTED. In your log drain, alert on:

```
event = "CHARGE_INITIATED" and not exists(
  event = "CHARGE_COMMITTED" within 5 minutes where requestId = $.requestId
)
```

When this fires, refund the customer manually via Neon SQL:

```sql
UPDATE activation_codes
SET used_eur = used_eur - <costEur from log>
WHERE id = '<codeId from log>';
```

This is a v0 mitigation — the proper fix is a `pending_charges` table
with 2-phase commit + cron sweep, deferred to a future ticket.

### Setup Vercel Log Drain (audit #14, optional 15min)

To persist logs beyond Vercel's 1h Hobby buffer:

1. Sign up for a free log destination: [Better Stack (recommended)](https://betterstack.com/), [Logtail](https://logtail.com/), or [Datadog](https://datadog.com/) free tier
2. Get the drain URL/token from your provider
3. Vercel project → **Settings** → **Log Drains** → **Add Drain**
4. Paste URL, set format = JSON, environments = Production
5. Test by hitting `/api/cron/purge` with the bearer; structured JSON appears in your destination within ~10s

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

## Audit-driven open backlog (as of 2026-05-03)

See [`plans/audits/`](../plans/audits/) for full reports.

| Issue | Severity | Owner / status |
|-------|----------|---------------|
| [#2](https://github.com/phamdangchung94/openfreepik/issues/2) | P0 | **Manual** — split dev/prod Neon project + secrets |
| [#9](https://github.com/phamdangchung94/openfreepik/issues/9) | P0 | **Manual** — verify pricing matrix vs Freepik dashboard |
| [#5](https://github.com/phamdangchung94/openfreepik/issues/5) | P1 | Crash window watchdog log |

Every closed audit fix has its commit and PR linked from the issue thread.
