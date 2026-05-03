# UI/UX Improvement Plan — Post Design System Application

**Date**: 2026-05-03
**Baseline**: After commits `66aaa82` (design system tokens) + `91db639` (Kling logo, branding strip, real-time cost).
**Method**: Static scan of every Customer + Admin component against the GitHub "Midnight Command Center" spec. 15 actionable findings, 8 categories.

## TL;DR

The token-first swap got us 80% of the way there. Remaining work is **fine-tuning at the component level** — radius inconsistencies on medium-emphasis surfaces, spacing rhythm 4px off in places, anaemic empty/loading states, and one clearly broken color (`bg-emerald-600` for COMPLETED badges that should be Spring Green).

**Total estimated effort**: ~6–9 hours across 4 batches. No redesign required; all changes are token swaps or small composition tweaks.

---

## What's already correct (don't touch)

- ✅ Card radius (`rounded-3xl` 24px) applied uniformly via the Card primitive
- ✅ Color tokens (Spring Green, Polar Blue, Deep Space, Subtle Gray) flow through the Shadcn semantic slots
- ✅ Mona Sans font stack loaded and inheriting on every page
- ✅ Button variants (outline, ghost, destructive) coherent with the new palette
- ✅ Focus rings use Polar Blue with correct opacity
- ✅ Mobile breakpoints exist for 3-col layout (form/preview/history)
- ✅ Customer header has Kling logo + activation pill; "Freepik API" branding stripped

---

## Priority Matrix (revised for UI/UX scope)

| Priority | Definition | When to do |
|---------|-----------|-----------|
| **UX-P0** | Visibly wrong / breaks design cohesion right now | Today |
| **UX-P1** | Clear improvements user would notice on first session | This week |
| **UX-P2** | Polish + onboarding hooks; matter on the 2nd visit | Next sprint |
| **UX-P3** | Nice-to-haves; A/B-testable; defer until traffic | Backlog |

---

## Batch A — Quick fixes (≤2h total)

These are pure search-and-replace in the design system grammar. Most can be one PR.

| # | Severity | File:line | Change | Why |
|---|----------|-----------|--------|-----|
| A1 | UX-P0 | [status-badge.tsx:19](src/components/preview/status-badge.tsx:19) | `bg-emerald-600` → `bg-primary` (Spring Green) | Hardcoded Tailwind color visibly mismatches the rest of the COMPLETED states and activation green dot |
| A2 | UX-P0 | [preview-panel.tsx:22,32,57](src/components/preview/preview-panel.tsx:22) | `rounded-lg` (8px) → `rounded-xl` (12px) on the video container chrome | Spec calls for radius hierarchy — buttons 6, inputs 8, mid surfaces 12, cards 24. Preview is mid-surface, not button-tier |
| A3 | UX-P0 | [batch-upload-zone.tsx, multi-shot-editor.tsx](src/components/batch/batch-upload-zone.tsx), [generator-i2v-source.tsx] | Inner card-ish containers using `rounded-lg` → `rounded-3xl` to match the wrapping Card primitive | When a "card inside a card" sits at half the parent's radius, it visually flattens the hierarchy |
| A4 | UX-P1 | [history-item.tsx:42,45,51](src/components/history/history-item.tsx:42) | Thumbnail container `rounded-md`→`rounded-lg`; prompt text `text-xs`→`text-sm` | Primary content in a clickable item should be readable; reserve `text-xs` for timestamps |
| A5 | UX-P1 | [app-header.tsx:12,19](src/components/layout/app-header.tsx:12), [cost-preview.tsx:67](src/components/generator/cost-preview.tsx:67) | `gap-3` (12px) → `gap-4` (16px) at element-group level | Spec element-gap = 16px. Header logo↔title and cost preview internals look cramped |
| A6 | UX-P1 | [cost-preview.tsx:67-71](src/components/generator/cost-preview.tsx:67) | `px-3 py-2` → `px-4 py-3` on the cost preview card | Padding rhythm should match the surrounding card (px-4 py-4) |
| A7 | UX-P2 | [activation-code-input.tsx:99](src/components/layout/activation-code-input.tsx:99) | Add `aria-label="Activation code"` to the pill input | Header strips visible label; screen readers see only the icon |

**Estimated effort**: 90 minutes, single commit.

---

## Batch B — Empty + loading state polish (~2h)

Empty states are present but minimal. Each is a chance to onboard a new user with one extra sentence.

### B1 (UX-P1) — History sidebar empty state
**File**: `src/components/history/history-sidebar.tsx`
**Now**: icon + "No history yet"
**Should**: add CTA-flavoured subtext: *"Submit a generation from the form on the left — it'll show up here."*
Effort: 10 min.

### B2 (UX-P1) — Preview panel empty state
**File**: `src/components/preview/preview-panel.tsx`
**Now**: "No video selected"
**Should**: subtext explaining how it gets populated: *"Pick a generation from history or fire a new one."*
Effort: 10 min.

### B3 (UX-P1) — Generation in-progress messaging
**File**: `src/components/preview/preview-panel.tsx` (line ~36)
**Now**: generic "Generating video..."
**Should**: show prompt snippet + position when multiple in flight (e.g., *"Generating "a serene zen garden" — 2 of 5"*).
Effort: 30 min.

### B4 (UX-P2) — First-visit onboarding card
**File**: new `src/components/customer-onboarding-empty.tsx`
**When**: customer hits the page WITH no activation code AND no history.
**Show**: 3-step guide card replacing the empty preview area:
1. Paste your activation code in the header
2. Type a prompt or upload an image
3. Click Generate
Effort: 60 min.

### B5 (UX-P2) — Cost preview "loading" state polish
**File**: `src/components/generator/cost-preview.tsx`
**Now**: "Loading rates…" text
**Should**: skeleton rectangle matching final card dimensions to avoid layout shift on rates fetch.
Effort: 15 min.

---

## Batch C — Mobile responsiveness (~2h)

The 3-column desktop layout collapses to 1 column at <`lg:` (1024px). Tablets (768–1023px) get a cramped form with no preview/history visible.

### C1 (UX-P1) — Add tablet breakpoint
**File**: `src/app/(customer)/page.tsx:88`
**Now**: `lg:grid-cols-[minmax(0,1fr)_420px_260px]`
**Add**: `md:grid-cols-[minmax(0,1fr)_260px]` so tablets get form + history side-by-side, preview hidden.
Effort: 30 min + visual QA.

### C2 (UX-P1) — Header overflow on small screens
**File**: `src/components/layout/app-header.tsx`
**Now**: 4 elements + balance display inline. Wraps awkwardly under 600px.
**Should**: collapse activation code + auto-download into a hamburger / overflow menu under `md:`. Or hide the auto-download label on mobile (icon only).
Effort: 45 min.

### C3 (UX-P2) — Generator form vertical density on mobile
**File**: `src/components/generator/generator-form.tsx`
**Issue**: Each section card has 16px padding; on a 375px viewport, the visible area shrinks fast.
**Fix**: under `sm:`, use `data-size="sm"` on Card to use the existing compact padding variant. ~5 lines.
Effort: 15 min.

### C4 (UX-P3) — Touch target audit
Audit all buttons + clickable areas to ensure ≥44px hit target on touch. Lucide icons in `size-3.5` icon-only buttons (e.g., refresh, logout) are below this.
Effort: 30 min.

---

## Batch D — Microcopy + Vietnamese localization (~2–3h)

Customer is Vietnamese ("tproxy.team@gmail.com" per env). All UI is currently English. Two paths:

### D1 (UX-P2, recommend) — i18n setup
Wire `next-intl` or similar; extract every customer-facing string into a JSON dictionary; add `vi` translation alongside `en`. Default to Vietnamese for `.io.vn` domain.
Effort: ~3 hours initial, then ~30 min per page added.

### D2 (UX-P3) — Quick Vietnamese pass for hero strings only
If full i18n is overkill: just hard-code Vietnamese for the 6–8 most visible strings (header title, tab labels, primary button, success/error toasts).
Effort: 30 min.

### D3 (UX-P2) — Toast tone
**Files**: every `toast.success` / `toast.error` call site.
**Now**: terse English ("Activated", "Generation started", "Failed to start generation").
**Should**: friendlier with action context. e.g. "Welcome, Khách A — 12.40 EUR available" instead of "Activated". Same micro-effort but warmer.
Effort: 1 hour combing through 12 call sites.

### D4 (UX-P3) — Error message decoder
When orchestrator returns 503 ALL_KEYS_EXHAUSTED or 402 INSUFFICIENT_BALANCE, current toast just shows the technical message. Map error codes → friendlier customer-facing copy.
Effort: 45 min.

---

## Batch E — Accessibility (~1.5h)

### E1 (UX-P1) — Keyboard navigation audit
Test every page with Tab key only. Focus order, skip-to-content link, modal focus trap.
Likely findings: dialog close buttons not getting focus on open, sidebar nav skipping cards.
Effort: 1 hour QA + 30 min targeted fixes.

### E2 (UX-P1) — Color contrast verification
Run any page through axe-core or Lighthouse. Spec colors are dark-on-dark heavy; some `text-muted-foreground` (UI Gray #9198a1) on `bg-muted` (Subtle Gray #21262d) may fail WCAG AA (need ≥4.5:1).
Effort: 30 min audit + targeted fixes (likely bump UI Gray to Faded Silver in critical spots).

### E3 (UX-P3) — Screen reader pass
Test with VoiceOver on the activation flow + admin dashboard.
Effort: 1 hour.

---

## Batch F — Larger UX projects (P2/P3, >2h each)

Defer until traffic justifies. Listed for completeness.

### F1 — Realtime task progress
Currently history sidebar polls + updates discretely. Could use Server-Sent Events to stream progress (`5%, 30%, 70%, COMPLETED`). Polished but heavy lift.

### F2 — Inline video preview in history
Hover a history item → small video preview popover. Adds delight, requires custom component.

### F3 — Preset library
"Cinematic", "Anime", "Realistic" preset chips that fill the prompt + tier + aspect ratio in one click. Reduces typing.

### F4 — Drag-and-drop history reordering
For multi-task workflows. Most users won't notice it's missing.

### F5 — Admin dashboard charts
Replace plain stat cards on `/dashboard` with small sparklines (Today × 7 days). Recharts already in Shadcn ecosystem.

### F6 — Customer "share my video" flow
On a COMPLETED task: button to copy a Vercel-hosted preview link (instead of the expiring Freepik URL). Requires storage.

---

## Suggested execution order

| Week | Focus | Output |
|------|-------|--------|
| **This week** | Batch A (radius/spacing fixes) + Batch B1+B2+B3 (empty states) | 1 PR, ~3h |
| **Next week** | Batch C1+C2 (mobile) + Batch E1+E2 (a11y critical) | 1 PR, ~3h |
| **2 weeks** | Batch D1 (i18n setup, vi-VN) + D3 (toast warmth) | 1 PR, ~4h |
| **Backlog** | Batch B4 (onboarding card), C3+C4 (mobile polish), E3, F1–F6 | as time permits |

---

## Acceptance criteria

After all 5 batches:
- Lighthouse Performance ≥ 90, Accessibility ≥ 95, Best Practices ≥ 95 on customer page
- Lighthouse Mobile FCP < 2s on 3G (`freepik.io.vn`)
- Visual regression: cards, buttons, badges visually consistent across customer + admin (run `playwright screenshot` or manual diff)
- Vietnamese pass: every customer-facing string available in `vi`
- New customer can land on `/`, see the 3-step onboarding, paste a code, generate a video without help text

## Out of scope for this plan

- Marketing landing page (`freepik.io.vn` currently goes straight to the generator — separate decision whether to add a `/` landing)
- Email notifications (e.g., low balance) — operational ticket, not UI
- Documentation site / help center — separate content project
- Pricing page (admin sets prices; no public-facing pricing yet)
