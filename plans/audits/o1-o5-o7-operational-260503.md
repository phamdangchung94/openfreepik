# Audit Report — Operational gaps (O1, O5, O7)

**Date**: 2026-05-03
**Scope**: Logging, periodic cleanup, deployment runbook
**Status**: 1 HIGH (O5 — DB bloat + locked-out IPs forever), 2 MED (O1, O7)

## Priority order

`O5 → O7 → O1` (database hygiene first, then ops knowledge, then observability).

---

## O5 — Cron cleanup MISSING (HIGH)

### Findings

Three tables accumulate without bound:

| Table | Has purge fn? | Caller? | Growth pattern |
|-------|--------------|---------|----------------|
| `admin_sessions` | ✅ `purgeExpiredSessions()` ([src/lib/auth/admin.ts:65](src/lib/auth/admin.ts:65)) | ❌ none | ~7 stale rows/admin login/24h |
| `rate_limit_buckets` | ✅ `purgeExpiredRateLimitBuckets()` ([src/lib/rate-limit.ts:81](src/lib/rate-limit.ts:81)) | ❌ none | 1 row per (resource × code × minute). At 10 customers × 100 videos/day = ~1500 rows/day |
| `failed_logins` | ❌ none exists | n/a | 1 row per attacker IP, NEVER cleaned. **Locked-out IPs stay locked beyond their 15-min window if anyone hits the endpoint after lockout but before cleanup.** |

### Real-world impact

- `rate_limit_buckets` at 100 customers × 100 videos/day = 50k rows/month. Negligible storage, but `INSERT ... ON CONFLICT` does an indexed lookup → grows in cost.
- `failed_logins` rows persist with `lockedUntil` in the past → admin shows "wrong password, 0 attempts remaining" because the previous counter is still there. **This is a real correctness bug, not just hygiene.**

### Fix (~45 min)

1. Add `purgeStaleFailedLogins()` to [src/lib/auth/login-throttle.ts](src/lib/auth/login-throttle.ts):
   ```ts
   export async function purgeStaleFailedLogins(): Promise<void> {
     await db.delete(failedLogins).where(
       and(
         isNotNull(failedLogins.lockedUntil),
         lt(failedLogins.lockedUntil, new Date(Date.now() - 24 * 60 * 60 * 1000)),
       ),
     );
   }
   ```

2. New API route `src/app/api/cron/purge/route.ts`:
   ```ts
   export async function GET(req: Request) {
     const auth = req.headers.get("authorization");
     if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
       return NextResponse.json({ error: "AUTH" }, { status: 401 });
     }
     await Promise.all([
       purgeExpiredSessions(),
       purgeExpiredRateLimitBuckets(),
       purgeStaleFailedLogins(),
     ]);
     return NextResponse.json({ ok: true });
   }
   ```

3. `vercel.json` (Hobby tier max 1 cron, daily granularity):
   ```json
   { "crons": [{ "path": "/api/cron/purge", "schedule": "0 2 * * *" }] }
   ```

4. Add `CRON_SECRET` to Vercel env (random 32-byte token). Vercel Cron auto-sends `Authorization: Bearer <CRON_SECRET>` if env var present.

---

## O7 — Deployment runbook MISSING (MED)

### Findings

- No `RUNBOOK.md`, `OPERATIONS.md`, `DEPLOY.md` anywhere
- Only `docs/system-architecture.md` (feature overview)
- Audit reports document specific incidents but aren't operationalized as a playbook

### Critical gaps without runbook

| Scenario | Current state | Needed |
|----------|--------------|--------|
| Production rollback | Unknown — would have to dig Vercel UI | `vercel deploys list` + `vercel promote` steps |
| Env var rotation | Unknown — what breaks? | Per-var rotation impact + redeploy checklist |
| Freepik key exhausted | Admin dashboard exists but undocumented | Step-by-step: dashboard → keys → toggle inactive + add new |
| Activation code leaked | Same — UI exists, no playbook | Revoke + investigate steps |
| Drizzle migration fails | Unclear | Rollback SQL pattern (each migration should ship a down) |
| Error spike | No idea where to look | Vercel logs URL + filter recipes (once O1 done) |

### Fix (~1h) — write `docs/RUNBOOK.md`

Template sections:
1. Quick links (Vercel project, Neon DB, admin dashboard)
2. Incident response: rollback, hotfix
3. Routine ops: env rotation, Freepik key rotation, customer code revoke
4. Migration management: how to apply, how to "rollback" (write inverse migration)
5. Monitoring & health checks (depends on O1)
6. Cost / quota dashboard (Vercel + Neon usage views)
7. Emergency contacts (you + Freepik support email + Neon support email)

---

## O1 — Structured logging MISSING (MED)

### Findings

- 11 unstructured `console.*` calls across src/ — no request ID, no codeId context, no JSON
- Zero logging deps in package.json (no Sentry, Pino, Winston, Logtail)
- Vercel function logs only retain 1h on Hobby tier — anything older = forensic dead end

### Critical blind spots

| Path | Visibility |
|------|-----------|
| `[REFUND-FAILED]` log (audit fix #4) | Goes to Vercel logs, expires in 1h |
| `[orchestrator] all keys exhausted` | Same |
| Customer 401s from logout race (C7 above) | Silent |
| Rate-limit hits | Silent (only the 429 response shows) |
| Pricing rule lookups | Silent |

### Fix options

| Option | Effort | Cost | Notes |
|--------|--------|------|-------|
| **Vercel Log Drains → Logtail/Datadog** | 15 min | $0 (free tiers) | Captures `console.*` AS-IS — no code change needed; just configure drain |
| **Sentry @sentry/nextjs** | 1-2h | $0 (free tier 5k events/mo) | Best for errors + replay; add `instrumentation.ts` + `Sentry.captureException` wrappers |
| **Pino + Logtail drain** | 2-3h | $0 | Structured JSON; replaces console.* with pino logger |

### Recommendation

**Option 1 (Log Drains)** today — 15 min, zero code change, covers all existing `console.*`. Then **Option 2 (Sentry)** for error grouping + alerts when we have time.

---

## Combined effort estimate

| Item | Effort |
|------|--------|
| O5 cleanup cron | 45 min |
| O7 runbook | 1h |
| O1 logging (Log Drains only) | 15 min |
| O1 logging (full Sentry) | +2h |
| **Total minimum** | **2h** |
| **Total recommended** | **4h** |

## Acceptance criteria

- `vercel.json` exists with `/api/cron/purge` schedule
- Hitting `/api/cron/purge` with `CRON_SECRET` deletes expired rows from all 3 tables
- `docs/RUNBOOK.md` exists and is linked from README
- Vercel Log Drains configured → logs appear in Logtail dashboard
