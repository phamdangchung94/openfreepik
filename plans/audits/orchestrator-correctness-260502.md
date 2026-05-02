# Audit Report — Orchestrator correctness (S7+S8+C2)

**Date**: 2026-05-02
**Scope**: [src/lib/freepik/orchestrator.ts](src/lib/freepik/orchestrator.ts), [src/lib/auth/activation.ts](src/lib/auth/activation.ts), [src/lib/freepik/key-pool.ts](src/lib/freepik/key-pool.ts) — money-touching code paths
**Method**: Manual code review + 5-test stress script ([scripts/audit-orchestrator-stress.ts](scripts/audit-orchestrator-stress.ts))
**Status**: 4 findings (1 confirmed bug, 1 confirmed risk, 2 design gaps)

## Stress test results

| # | Test | Outcome |
|---|------|---------|
| 1 | 100x parallel `chargeCode(1 EUR)` against quota 100 | ✅ Exactly 100 succeeded, 0 over-spend |
| 2 | 50 charges + 50 refunds interleaved | ⚠️ Final used=3.00 EUR (expected 0) — refund-before-charge clamps at 0, leaks |
| 3 | 20x parallel `pickActiveKey(0)` with ONLY 1 key in pool | ⚠️ 19 picked, 1 returned null — SKIP LOCKED races to false-negative 503 |
| 4 | Charge expired code | ✅ Rejected |
| 5 | Refund 9999 EUR on usedEur=0 | ✅ Clamped at 0 |

## Findings

### F1 (HIGH) — `pickActiveKey` returns null spuriously under burst with ≤1 active key

**Code**: [src/lib/freepik/key-pool.ts:35-58](src/lib/freepik/key-pool.ts:35)

**Symptom**: With only 1 active Freepik key (current production state), 20 parallel `pickActiveKey(0)` calls returned a key 19 times and `null` once. The `null` causes the orchestrator to bail with HTTP 503 `NO_KEYS_AVAILABLE` even though the key exists and has budget.

**Root cause**: The CTE uses `FOR UPDATE SKIP LOCKED LIMIT 1`. When two concurrent requests target the same single row:
- Postgres assigns the lock to whichever request got there first
- The second request *skips* (instead of waits) → 0 rows in the subquery → 0 rows updated → 0 rows returned

This was an intentional choice for a *populated* pool (avoid head-of-line blocking) but degrades to false 503s when the pool has 1 key.

**Production impact (right now)**: The pool currently has exactly **1 active Freepik key**. Any customer who hits "Generate" simultaneously with another customer has a non-zero chance of getting a 503 they shouldn't. Today's batch T2V (concurrency 3) means even a single customer firing a 3-video batch can self-collide.

**Fix options**:
1. **Drop SKIP LOCKED → just `FOR UPDATE`** — second request waits ~50ms instead of 503-ing. Simplest, recommended for pools with <5 keys.
2. **Retry on null** — orchestrator wraps `pickActiveKey` in a 2-3 retry with small jitter. Adds latency on contention.
3. **Add a dummy key sentinel** — never run with <2 keys. Operational, doesn't fix root cause.

Recommend option 1 + add option 3 as ops policy.

### F2 (MEDIUM) — Refund silently fails if Neon SQL throws

**Code**: [src/lib/freepik/orchestrator.ts:88, 110, 121](src/lib/freepik/orchestrator.ts:88), [src/lib/auth/activation.ts:81-91](src/lib/auth/activation.ts:81)

**Symptom**: `refundIfCharged` calls `refundCode` without a try/catch. If Neon HTTP fails mid-refund:
- Customer balance was reduced by `chargeCode`
- Freepik call also failed
- The refund SQL `UPDATE` raises an exception → orchestrator throws → route handler returns 500
- **Customer is permanently charged for a request that produced no video**

**Code path**:
```ts
const charged = await chargeCode(codeId, opts.costEur);  // ✓ deducted
// ... key picked, callFreepik throws non-quota error ...
await refundIfCharged(codeId, opts.costEur);  // ❌ throws — error propagates
await logUsage(...);                          // never runs
```

**Fix**: Wrap refund in try/catch + log to a `pending_refunds` table for retry. Alternatively, queue the refund into a job that retries with exponential backoff. v1 minimum: log a CRITICAL message that admin can manually reconcile.

```ts
async function refundIfCharged(codeId: string, costEur: number): Promise<void> {
  if (costEur <= 0) return;
  try {
    await refundCode(codeId, costEur);
  } catch (err) {
    console.error(
      `[REFUND-FAILED] codeId=${codeId} amount=${costEur} — manual reconciliation required`,
      err,
    );
    // Future: insert into pending_refunds for cron-driven retry.
  }
}
```

### F3 (MEDIUM) — Crash window between charge and Freepik call

**Code**: [src/lib/freepik/orchestrator.ts:71-102](src/lib/freepik/orchestrator.ts:71)

**Symptom**: If the Vercel function crashes (OOM, timeout, deploy mid-request) between `chargeCode` (line 72) and the success/failure path (line 102 or 110/115), the customer is charged but no usage_log row exists.

Same risk for the success-path crash window between `callFreepik` returning (line 98) and `recordKeyCost` + `logUsage` (lines 99-101): customer got their video, Freepik billed our key, but our internal log says nothing happened. **Accounting drift**.

**Severity**: Medium because:
- Vercel function timeout default 10s; Freepik usually responds in <2s. Window small.
- No way to atomically combine "charge code" + "call Freepik" + "log" — they're across DB + HTTP + DB.

**Fix**: Two-phase commit pattern with a "pending charge" table:
1. Insert pending row with `pending` status before charge
2. After Freepik success: update row to `succeeded` + record key cost
3. Cron job sweeps `pending` rows older than 5 minutes and refunds them

This is significant scope. v1 mitigation: add a `[CHARGE-NO-CALLBACK]` log when the function takes >7s before calling Freepik so admin can spot orphan charges.

### F4 (LOW) — `usage_logs.video_url` never populated

**Code**: [src/lib/freepik/orchestrator.ts:101](src/lib/freepik/orchestrator.ts:101) + [src/app/api/freepik/kling-v3/[taskId]/route.ts](<src/app/api/freepik/kling-v3/[taskId]/route.ts>)

**Symptom**: Schema has `video_url text` for usage_logs, but no code path ever writes it. The video URL appears only in the GET poll response, which `authedFreepikCall` doesn't log.

**Impact**: Admin "Usage logs" page shows blank Task ID prefix only — no quick link to the actual video. Customer "Usage panel" same. Forensic value is reduced.

**Fix**: When polling returns `status="COMPLETED"`, the route handler updates the matching `usage_logs` row by `freepik_task_id` to set `video_url`. Light addition — ~15 lines.

### F5 (LOW) — Refund-before-charge race leaks money

**Stress test 2** showed: 50 random charges + 50 random refunds interleaved → balance ended at 3 EUR instead of 0.

**Root cause**: Refund clamps at `GREATEST(used - cost, 0)`. If a refund races AHEAD of its corresponding charge (e.g., out-of-order async scheduling), the refund clamps to 0 (no-op). When the charge then commits, you're +1 EUR used.

**Real-world likelihood**: Low. Within one request, charge always awaits before refund is even reachable. The race only manifests with cross-request interleaving — and our refund call sites only fire AFTER an already-committed charge in the same request.

**However**: if F2 is fixed by moving refund into a background job (delayed retry), this race becomes more reachable. Worth fixing pre-emptively when F2 is addressed.

**Fix**: Drop the GREATEST clamp and let used_eur go negative. Trust the data: a negative used means the system over-refunded, which admin can correct. Or use a separate `refunded_eur` column instead of subtracting from used_eur.

## Other observations (no severity yet)

- **isKeyExhaustedError heuristic over-rotates on AUTH errors**: A revoked Freepik key returns 401, marked as exhausted. But what if the key is *temporarily* invalid (Freepik service blip mistakenly returning 401)? We permanently mark it inactive after 3 retries. Operational risk: needs admin to manually re-activate.
- **Quota retry loop counts attempts but doesn't deduplicate**: If only 1 key exists and it's exhausted, we hit it 3 times in a row before giving up. Should track which keys we've already tried this request and skip.
- **logUsage is "best-effort"**: silently swallows insert failures. If logging breaks (e.g., DB out of space), the customer still gets charged but no audit trail. Consider failing the request if logging fails, since charging without a record is worse than no service.
- **No idempotency keys**: Customer hitting "Generate" twice quickly = 2 charges + 2 Freepik tasks. Standard practice is an `Idempotency-Key` header.

## Recommended action

| # | Severity | Effort | Action |
|---|----------|--------|--------|
| F1 | HIGH | 30 min | Drop `SKIP LOCKED` — switch to plain `FOR UPDATE`. Add ≥2 keys ops policy. |
| F2 | MEDIUM | 1 hour | Wrap refund in try/catch + structured `[REFUND-FAILED]` log. Manual reconciliation playbook. |
| F4 | LOW | 30 min | Update `usage_logs.video_url` from polling endpoint. |
| F3 | MEDIUM | DEFER | Two-phase commit needs design + new table. Add `[CHARGE-NO-CALLBACK]` watchdog log as v0 mitigation. |
| F5 | LOW | DEFER | Address when F2 moves refund to background. |

**Total quick fixes**: ~2 hours for F1+F2+F4. Recommend bundling into one PR titled "fix(orchestrator): correctness P0 from audit".

## Acceptance criteria

- [ ] Re-run [scripts/audit-orchestrator-stress.ts](scripts/audit-orchestrator-stress.ts) and Test 3 reports `picked=20, returned-null=0`
- [ ] Forced refund failure (e.g., kill DB connection mid-test) results in a `[REFUND-FAILED]` console.error with codeId + amount
- [ ] Polling a completed task writes `video_url` into `usage_logs`
- [ ] Stress test passes in CI before merge

## Out of scope

- Idempotency-Key header support (separate ticket)
- Two-phase commit / saga pattern for cross-service transactions (architectural)
- Distributed lock for cross-region scaling (premature)
