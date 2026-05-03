# Audit Report — S4: Rate limiting

**Date**: 2026-05-02
**Method**: Static analysis — grep deps + middleware + every API route handler for any limiter
**Status**: 8 findings — 2 HIGH, 4 MED, 2 LOW

## TL;DR

**Zero rate limiters anywhere.** No `@upstash/ratelimit`, no `next-rate-limit`, no manual counter. Every API endpoint is unbounded. The two scariest gaps:

- `/api/freepik/kling-v3` POST — costs real EUR per call. A leaked code = burn the entire 500 EUR Freepik budget in minutes.
- `/api/admin/login` POST — plain string compare with no failed-attempt tracking. Brute-forceable at Vercel function speed.

## Findings

| # | Severity | Endpoint / Surface | Current state | Risk | Fix |
|---|----------|--------------------|---------------|------|-----|
| F1 | **HIGH** | `POST /api/freepik/kling-v3` | Unbounded; charges 0.25–2.10 EUR per call | 1 leaked code → 1000-user fanout drains 50 EUR pool in <1 min | `3 req/min per code` via Upstash Redis sliding window |
| F2 | **HIGH** | `POST /api/admin/login` | No failed-attempt counter, no lockout | 16-char password brute-force at 1000+ req/sec via Vercel functions | Track `failed_logins(ip, count, locked_until)` in DB or Redis; lock 15 min after 5 failures |
| F3 | MED | `POST /api/activate` | Unbounded | Code enumeration: brute force the FK-XXXXX-... shape | `10 req/min per IP` |
| F4 | MED | `POST /api/freepik/improve-prompt` | Unbounded; cost=0 | Wastes Freepik upstream quota even though we don't charge | `5 req/min per code` |
| F5 | MED | `GET /api/freepik/*/[taskId]` | Unbounded; clients poll every 2s | 10 concurrent tasks × 2s = 300 req/min per code, 10× that across customers | `30 req/min per code` (loose — polling is normal) |
| F6 | MED | `/dashboard/login` (web form) | Same handler as F2; no UI throttle either | Slow brute force via the form | Inherits F2 fix |
| F7 | LOW | Freepik 429 (RATE_LIMIT) handling | [src/lib/freepik/orchestrator.ts](src/lib/freepik/orchestrator.ts) treats 429 as fatal — refunds and surfaces error | If our pool happens to hit Freepik's per-key rate limit, customers see 503 instead of retry | Add 429 to retry loop with exponential backoff (1s, 2s, 4s) |
| F8 | LOW | Vercel/Neon implicit limits | Vercel free tier: 60s function timeout, Neon HTTP: 15 req/min on free | Natural ceiling exists but undocumented; not a defense | Document in `docs/limits.md` |

## Architecture observations

- **Code = bearer token**: rate limiting per-code is straightforward (the bearer IS the rate-limit key). Per-IP is supplementary.
- **No IP capture in usage_logs**: can't post-hoc audit "did one IP burn this code?". Cheap fix: add `ip text` column + populate from `request.headers.get('x-forwarded-for')`.
- **Orchestrator already has retry loop** (3 attempts on quota exhaustion) — adding 429 retry is a small extension.

## Recommended dependency

[`@upstash/ratelimit`](https://github.com/upstash/ratelimit-js) + Vercel KV (free tier) is the standard pattern for Vercel + serverless. ~50 lines of integration:

```ts
// src/lib/rate-limit.ts
import { Ratelimit } from "@upstash/ratelimit";
import { kv } from "@vercel/kv";

export const klingV3Limit = new Ratelimit({
  redis: kv,
  limiter: Ratelimit.slidingWindow(3, "1 m"),
  prefix: "rl:kling",
});

// In route:
const { success } = await klingV3Limit.limit(`code:${codeId}`);
if (!success) return NextResponse.json({ error: "RATE_LIMIT" }, { status: 429 });
```

Alternative without external dep: Postgres-backed counter table + cron cleanup. Simpler to deploy (already have Neon) but more code (~100 lines).

## Recommended fix sequence

| # | When | What |
|---|------|------|
| 1 | TODAY | Add Vercel KV + `@upstash/ratelimit`; protect F1 (kling-v3) — single highest-blast-radius fix |
| 2 | TODAY | Implement F2 lockout (DB-based, no extra dep needed) |
| 3 | This week | F3 + F4 + F5 (3 more route limiters) |
| 4 | Next sprint | F7 — wrap Freepik 429 in orchestrator's retry loop |
| 5 | Backlog | F8 doc; add `ip` to usage_logs for forensics |

## Acceptance criteria

- [ ] `for i in {1..10}; do curl -X POST .../api/freepik/kling-v3 -H "Authorization: Bearer $CODE" ...; done` — at most 3 succeed, rest get 429
- [ ] 6th wrong admin password attempt within 15 min returns 429 with retry-after header
- [ ] `/api/admin/usage` query for "logs from same code in 1 minute" can detect a previously-unprotected burst (proves we logged enough to forensically verify)

## Out of scope

- DDoS protection (Vercel has built-in WAF on Pro tier)
- CAPTCHA on login (consider if F2 lockout proves insufficient)
- Per-region rate limits (premature)
