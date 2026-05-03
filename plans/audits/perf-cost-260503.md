# Audit Report — Performance + cost projections (P1.1, $1, $2)

**Date**: 2026-05-03
**Scope**: DB query count per endpoint, Vercel/Neon ceiling math, perf quick wins
**Status**: 1 MED (perf wins worth ~33% latency reduction), informational cost projections

## TL;DR

Vercel Hobby ceiling at **~10 customers** (100 videos/day each). Neon free tier ceiling at **~80 customers**. Vercel will saturate first.

| Customers | Vercel hours | Neon hours | Plan cost (€/mo) |
|-----------|--------------|------------|------------------|
| 1 | 9.7h | 2.3h | 0 |
| 5 | 48.5h | 11.5h | 0 |
| **10** | **97h** ← Hobby ceiling | 23h | **0 → 20** (Vercel Pro) |
| 15 | 145.5h | 34.5h | 20 |
| 50 | 485h | 115h | 20 |
| 80 | 776h | 184h ← Free Neon ceiling | 20 → 39 (Neon Pro) |
| 100 | 970h | 230h | 39 |

(Per-customer assumption: 100 videos/day, ~5 concurrent active.)

---

## P1.1 — DB queries per endpoint

| Endpoint | DB queries | Total Neon RTT | Notes |
|----------|-----------|---------------|-------|
| `POST /api/freepik/kling-v3` | **8** | ~560ms | validateCode + checkRateLimit + validateCode (DUP!) + chargeCode + calculateCost + pickActiveKey (CTE) + recordKeyCost + logUsage |
| `GET /api/freepik/kling-v3/[taskId]` (poll) | **3** | ~210ms | validateCode + pickActiveKey + (conditional) update video_url |
| `POST /api/activate` | 1 | 70ms | validateCode |
| `GET /api/usage` | 3 | 210ms | validateCode + 3 aggregate queries (totals/today/recent) |
| `GET /api/admin/overview` | 4 | 280ms | session check + 3 aggregates |

Neon HTTP roundtrip: **~70ms median** based on our test scripts.

---

## Quick perf wins (~33% latency reduction on POST)

### W1 — Deduplicate `validateCode` in kling-v3 POST (HIGH ROI)

**Cost**: 1 DB query per POST = ~70ms

**Root cause**: Phase 8 added the rate-limit gate in [src/app/api/freepik/kling-v3/route.ts:52](src/app/api/freepik/kling-v3/route.ts:52) which calls `validateCode(bearer)` to resolve `codeId`. The orchestrator THEN calls `validateCode` again at line 62. Two roundtrips for the same data.

**Fix** (~15 min): Pass `validation` from route → orchestrator. Add an opts.preValidated field that skips the second call:

```ts
// orchestrator.ts
const validation = opts.preValidated ?? await validateCode(opts.bearerCode);

// kling-v3/route.ts
const result = await orchestrateFreepikCall({
  bearerCode: bearer,
  preValidated: validation,  // pass through
  // ...
});
```

### W2 — Cache `pricing_rules` in-memory (MED ROI)

**Cost**: 1 DB query per POST = ~70ms

**Root cause**: `calculateCost()` looks up the pricing matrix on every request. Pricing changes maybe weekly (admin edit).

**Fix** (~30 min): Module-level Map + 5-min TTL. Invalidate on PATCH from admin route.

```ts
// src/lib/pricing/calculator.ts
const cache = new Map<string, { value: number; expires: number }>();
const TTL_MS = 5 * 60_000;
// ... lookup cache before DB hit
```

Trade-off: 5-min staleness window after admin edits prices. Acceptable since prices change rarely.

### W3 — Skip `pickActiveKey` rate-limit insert during pure polls (LOW ROI)

**Cost**: ~50ms per poll, but polls are already fast

**Root cause**: GET poll calls `authedFreepikCall` which does `pickActiveKey(0)`. We're locking + updating last_used_at on every 2-second poll for every active task — far more contention than needed.

**Fix** (~1h): Cache picked key per polling task in-memory (server-side). Re-pick only on FAILED.

Less urgent — defer.

**Combined W1 + W2 = saves 140ms / kling-v3 POST = ~25% latency reduction.**

---

## Vercel Hobby ceiling math

Per-customer monthly footprint at 100 videos/day:
- POSTs: 100/day × 3s function time (Freepik 2s + DB 0.5s + Vercel overhead) = **9h/month**
- Polls: 100 active × 5 concurrent × 30 polls × 150ms = **0.7h/month**
- Misc (activate, dashboard) = **<0.05h/month**

**Per-customer: ~9.7h/month**

Hobby tier limit = 100h function execution → **10 customers maximum**.

Pro tier ($20/mo) = unlimited execution.

---

## Neon free tier ceiling math

Per-customer monthly footprint:
- POSTs: 100/day × 8 queries × 70ms = ~1.7h compute
- Polls: 100 active × 5 concurrent × 30 polls × 3 queries × 70ms = ~0.6h
- **Per-customer: ~2.3h/month**

Free tier = 191.9h → **~80 customers max** (much later than Vercel).

Pro tier ($19/mo) = 300h, can scale to ~130 customers.

---

## Recommendations by milestone

| Milestone | Trigger | Action | Cost +€/mo |
|-----------|---------|--------|------------|
| Customer #5 | Approaching 50% Vercel quota | Upgrade Vercel Hobby → Pro | +20 |
| Customer #10 | Hitting Hobby ceiling | Must be on Pro | (already 20) |
| W1 + W2 perf wins | Anytime | Deploy 1 PR | 0 |
| Customer #15 | Single Freepik key has ~125 EUR left (250 usage × ~0.5) | Add 2nd Freepik account ($4 audit finding) | 0 (Freepik free tier on each) |
| Customer #30+ | Neon compute approaching 50% | Add Vercel KV cache for pricing_rules + activation_metadata | +10 |
| Customer #80 | Neon free tier near limit | Upgrade Neon → Pro | +19 (total 39) |

---

## Out of scope

- Bundle size / Lighthouse metrics (separate audit)
- Edge runtime conversion (premature — current routes work fine on Node runtime)
- WebSocket migration for polling (premature)
- Multi-region (Neon region matters; both Vercel and Neon are us-east — fine for now)
