# Audit Report — C7 + S10: Orphan recovery + SQL injection

**Date**: 2026-05-03
**Scope**: Orphan recovery flow when bearer is cleared mid-poll; raw SQL template injection vectors
**Status**: 1 HIGH (C7), 0 vulnerabilities (S10 clean)

## C7 — Orphan recovery breaks silently after logout

**Severity**: HIGH

**Symptom**: Customer fires a generation → task IN_PROGRESS → polling runs in background using `getApiHeaders()` which reads `activationCode` from `useAuthStore`. If customer clicks **Logout** mid-poll:

1. `useAuthStore.clear()` sets `activationCode = ""`
2. Next poll iteration sends `Authorization: Bearer ` (empty)
3. Server returns 401 → [poll-task.ts](src/lib/freepik/poll-task.ts) catches as a generic error → retries with backoff
4. Loop never exits — keeps 401-ing until the 10-minute `maxTimeMs` timeout
5. Eventually `status: "TIMEOUT"` written to the task — customer sees "Polling timed out" instead of "Logged out"

**Reload-after-logout case**: `useOrphanRecovery` runs at mount, finds the IN_PROGRESS task, calls `pollTaskUntilDone({ apiTaskId, endpoint: "kling-v3" })`. With activationCode still empty (or hydrated to "" from localStorage), the same 401 loop fires again.

**Why it slipped through**: `pollTaskUntilDone` treats 401 as "transient network error" and retries. There's no auth-failure circuit breaker.

**Fix** (~30 min):

```ts
// src/lib/freepik/poll-task.ts — inside the catch block
} catch (err) {
  if (err instanceof FreepikApiError && err.code === "AUTH") {
    return { status: "FAILED", generated: [], error: "Authentication lost (logged out)" };
  }
  if (signal?.aborted) { ... }
  console.warn(`[pollTask:${endpoint}] retry after error:`, err);
}
```

Also: in `useOrphanRecovery`, skip recovery entirely if `useAuthStore.getState().activationCode === ""`.

**Acceptance criteria**:
- Logout while task IN_PROGRESS → task immediately transitions to FAILED with "Authentication lost"
- Reload page after logout → orphaned tasks are not re-polled (just left as IN_PROGRESS until next login or manual cleanup)

---

## S10 — Raw SQL injection vectors

**Severity**: SAFE — no findings

**Method**: Grepped all `sql\`` template usage in src/. Audited each interpolation site for whether user input flows in.

| # | File:Line | Pattern | Verdict |
|---|-----------|---------|---------|
| 1 | [key-pool.ts:44](src/lib/freepik/key-pool.ts:44) | `${cost}::numeric` (cost from `Math.max(...).toFixed(2)`) | SAFE — coerced number |
| 2 | [activation.ts:85,92,96,121](src/lib/auth/activation.ts:85) | `${activationCodes.usedEur} + ${cost}` | SAFE — Drizzle column refs auto-escape |
| 3 | [login-throttle.ts:103](src/lib/auth/login-throttle.ts:103) | `${sql.raw(String(LOCKOUT_MINUTES))}` | SAFE — constant 15 baked at build time |
| 4 | [rate-limit.ts:60,84](src/lib/rate-limit.ts:60) | `${rateLimitBuckets.count} + 1` + sql time-bucket math | SAFE — column refs |
| 5 | [codes/[id]/route.ts:44](<src/app/api/admin/codes/[id]/route.ts:44>) | `sql\`COALESCE(${activationCodes.quotaEur}, 0) + ${amount}\`` | SAFE — `amount` from `addEur.toFixed(2)`, validated by Zod first |
| 6 | [codes/route.ts](src/app/api/admin/codes/route.ts) + [overview/route.ts](src/app/api/admin/overview/route.ts) | `count(...) FILTER (WHERE status = 'succeeded')` | SAFE — string literals + column refs |

**Conclusion**: Drizzle's `sql` template auto-parameterizes column refs (`${table.column}`) and JS values (`${var}`). The only manual escape would be `sql.raw(...)`, used once with a hardcoded numeric constant. No user-controlled string flows into raw SQL anywhere.

**Verification**: tested manually — every `${interpolation}` in the codebase either takes a Drizzle column reference (auto-escaped), a numeric constant via `.toFixed(2)`, or a Zod-validated value.

---

## Recommended action

| # | Severity | Effort | Action |
|---|----------|--------|--------|
| C7 | HIGH | 30 min | Detect AUTH error in `pollTaskUntilDone` + skip orphan recovery if no bearer |

S10 needs no action — it's a "good news" audit. Document the safe pattern so future raw SQL contributions know what's reviewed.
