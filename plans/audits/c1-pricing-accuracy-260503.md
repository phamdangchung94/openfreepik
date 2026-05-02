# Audit Report — C1: Pricing accuracy vs Freepik public

**Date**: 2026-05-03
**Method**: WebFetch Freepik official docs + 5 third-party reseller pricing pages, triangulate per-second rates
**Status**: 10 findings — 3 HIGH, 3 MED, 4 LOW. **All conclusions are estimates; manual verification required.**

## TL;DR

Our seed pricing in [scripts/seed-pricing.ts](scripts/seed-pricing.ts) is **likely 50–60% too low for `std` tier and 30–40% too low for `pro`** based on third-party reseller signals. **Freepik's canonical EUR rates are not publicly accessible** (gated behind dashboard login; the docs domain redirects to docs.magnific.com mid-rebrand). Before relying on any of this, run the verification matrix below.

## Comparison table

(EUR; 1 EUR ≈ 1.07 USD as of 2026-05)

| Tier | Duration | Audio | Our price | Estimated real | Variance |
|------|----------|-------|-----------|----------------|----------|
| std  | 5s  | No  | 0.25 | ~0.59 | **−58%** |
| std  | 5s  | Yes | 0.35 | ~0.82 | **−57%** |
| std  | 10s | No  | 0.50 | ~1.18 | **−58%** |
| std  | 10s | Yes | 0.70 | ~1.65 | **−58%** |
| pro  | 5s  | No  | 0.50 | ~0.78 | **−36%** |
| pro  | 5s  | Yes | 0.70 | ~1.10 | **−36%** |
| pro  | 10s | No  | 1.00 | ~1.57 | **−36%** |
| pro  | 10s | Yes | 1.40 | ~2.20 | **−36%** |
| pro  | 15s | Yes | 2.10 | ~3.30 | **−36%** |

Estimates triangulated from Atlas Cloud ($0.084/s std, $0.112/s pro at 720p, +33% audio markup), Novita AI ($0.168/s std, $0.224/s pro w/o audio; ~50% audio markup), and Kuaishou's own credit table (6→9 credits/s = +50% audio at 720p; 8→12 at 1080p).

## Findings

### HIGH severity
- **F1** — `std` tier under-priced ~50–60%. Even cheapest reseller signal ($0.075/s on EvoLink) is 40% above our 0.05 EUR/s.
- **F2** — Audio multiplier wrong: 1.4× vs reality 1.5× minimum (Kuaishou's own table shows exactly 1.5×).
- **F3** — `pro` tier under-priced ~30–40%. Margin is razor-thin or negative.

### MEDIUM severity
- **F4** — No 720p/1080p split. Freepik's underlying Kling charges +33% for 1080p (8 vs 6 credits/s). Our schema doesn't expose resolution; we don't know which the API defaults to.
- **F5** — Aspect ratio assumed flat. `16:9 / 9:16 / 1:1` may have surcharges; not verified.
- **F6** — Multi-shot mode (up to 6 prompts in 1 video) not separately priced. If Freepik bills setup fee per shot, we under-charge.

### LOW severity
- **F7** — Elements / reference-image surcharge. EvoLink signals reference-to-video jumps from $0.075/s → $0.1125/s (+50%). Not in our matrix.
- **F8** — `improve-prompt` charged 0.00 EUR. No public confirmation it's free.
- **F9** — Polling cost (GET `/[taskId]`). Standard REST polls are free, but unverified for Freepik specifically.
- **F10** — Charge timing (POST vs COMPLETED) — we charge on POST. If Freepik bills only on COMPLETED, we're fine commercially (refund logic exists for failed Freepik calls).

## Recommended action

### Step 1 — Verification protocol (MUST DO before public launch)

Spend ~10 EUR of Freepik credit to measure real prices:

1. Top up Freepik account with known balance (e.g., 20 EUR).
2. Generate matrix: `{std, pro} × {5s, 10s, 15s} × {audio on/off} × {16:9, 9:16, 1:1}` = **36 calls**.
3. Read Freepik billing dashboard line-items → record exact EUR debited per call.
4. Test multi-shot (6 prompts × 2.5s) and elements (with reference image) separately.
5. Test improve-prompt 10× to see if any debit appears.
6. Replace estimates in `seed-pricing.ts` with measured values; commit dashboard screenshot to `docs/freepik-pricing-evidence/`.

**Effort**: ~2 hours + 10 EUR.

### Step 2 — Conservative interim update (TODAY)

Until verification runs, raise rates to ~25% margin above the reseller floor so we don't bleed:

```ts
// scripts/seed-pricing.ts
const RATES = {
  std: { perSecond: 0.10, audioMultiplier: 1.5 },  // was 0.05 / 1.4
  pro: { perSecond: 0.16, audioMultiplier: 1.5 },  // was 0.10 / 1.4
} as const;
```

Then re-run `pnpm db:seed-pricing` (idempotent UPSERT). Customers see new prices on their next request.

### Step 3 — Schema extensions (next sprint)

Add columns to `pricing_rules`:
- `resolution text` (`720p` / `1080p`)
- `has_reference_images boolean`
- `multi_shot_count smallint` (or treat as multiplier on duration)

Update `lookupForKlingV3` to compute the lookup key with these dimensions.

## Caveats — sources of uncertainty

- Freepik's `/api/pricing` endpoint returns 403 to unauthenticated requests. Could not retrieve canonical EUR rates.
- `docs.freepik.com` 301-redirects to `docs.magnific.com` (rebrand in progress). Pricing page on the new docs only says "varies by tier and duration."
- All "real" prices above are triangulated from third-party resellers — **rough order of magnitude only**.
- Audio multiplier 1.5× comes from Kuaishou's own user guide, not Freepik specifically.
- **Could not confirm**: charge timing, polling cost, elements surcharge, improve-prompt cost. **All four require dashboard testing.**

## Acceptance criteria

- [ ] 36-call verification matrix run; prices recorded
- [ ] `seed-pricing.ts` rates match within ±10% of measured values
- [ ] `docs/freepik-pricing-evidence/` contains dashboard screenshots
- [ ] Schema extended for resolution + reference images (or explicit decision to defer)
- [ ] If actual prices significantly different from estimates: customer-facing changelog entry + email to existing customers

## Out of scope

- Margin strategy (separate business decision)
- Tiered customer pricing (volume discounts) — premature
- Freepik plan upgrade analysis (Pro vs Premium subscription) — separate finance ticket
