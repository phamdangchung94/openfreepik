# Phase 6 — Polish, Error Handling & QA

**Status:** ☐ Not started
**Priority:** High (ship quality gate)
**Depends on:** Phases 1–5

## Overview

Everything from Phase 1–5 is a working end-to-end pipeline. This phase makes it feel finished. Focus areas:

1. Unified error handling — every Freepik error class maps to a specific toast with an actionable next step.
2. Empty states & loading skeletons everywhere (no raw "undefined" ever visible).
3. Keyboard shortcuts for power users.
4. Dark mode toggle (shadcn default theme).
5. Final documentation: README + `docs/` fill-in.
6. Manual QA checklist run against the full app.
7. (Stretch) Minimal webhook receiver so users can avoid polling.

## Key Insights

- Errors happen at many layers: browser fetch network failure, Next.js route validation, Freepik API 4xx/5xx, video playback failure. Each needs its own user-visible message.
- The app is a local dev tool — we can afford to surface verbose technical messages in a collapsible "Details" panel inside error toasts, rather than hiding them.
- Dark mode is free with shadcn: add a theme toggle component + a `ThemeProvider` wrapper.
- We should NOT write automated tests in this phase (out of scope, YAGNI for v1). We run a **manual QA checklist** instead and log results in `docs/project-changelog.md`.

## Requirements

### Functional
- **Error map** with these flows (all via `sonner` toast):
  | Error | Toast Title | Toast Body | Action Button |
  |---|---|---|---|
  | Network fail | "Can't reach Freepik" | "Check your internet connection and retry." | Retry |
  | 401 auth | "Invalid API key" | "Verify FREEPIK_API_KEY in .env.local and restart dev server." | — |
  | 400 bad param | "Invalid request" | Shows `invalid_params[]` bullet list | — |
  | 429 rate limit | "Rate limit hit" | "Slow down — try again in a moment." | Retry (30s) |
  | 500/503 | "Freepik server error" | "Service is having issues. Usually resolves in a minute." | Retry |
  | COMPLETED w/ empty generated | "No result returned" | "Freepik reported success but sent no video URL." | Retry |
  | Polling timeout | "Still working…" (info) | "This is taking longer than usual. Check back soon." | Keep Waiting / Cancel |
- **Empty states**:
  - No history → illustration + "Your past generations will appear here."
  - No active task → "Fill out the form and click Generate to start."
  - FAILED task → clear error block with retry.
- **Loading skeletons**:
  - Generator preview skeleton (Phase 5).
  - Sidebar history item skeletons on first paint.
- **Keyboard shortcuts**:
  - `⌘/Ctrl + Enter` anywhere in the form → submits generate.
  - `⌘/Ctrl + I` in prompt field → improve prompt.
  - `Escape` → cancel any open dialog.
- **Dark mode**:
  - Toggle in top header (Sun/Moon icon).
  - Persists preference via `next-themes`.
  - All shadcn components already theme-aware.
- **Header bar**:
  - Left: app title "Kling 3 Video Generator" + small "Freepik API" badge.
  - Right: theme toggle + a "?" help button that opens a dialog with usage tips and links to docs.
- **README.md final version**:
  - Overview, features list, setup steps, screenshot.
  - Troubleshooting ("API key not working", "Images not accepted").
  - Credits / disclaimer.
- **`docs/` fill-in**:
  - `system-architecture.md` — final arch diagram + data flow.
  - `code-standards.md` — naming, component structure, import order.
  - `development-roadmap.md` — tick Phase 1–6; list expansion roadmap.
  - `project-changelog.md` — v1.0.0 entry with feature list.

### Non-functional
- Lighthouse accessibility score ≥ 95 on the main page (manual check with DevTools).
- Zero console errors during the full happy-path run.
- Clean TypeScript (`pnpm tsc --noEmit`).
- README can be followed by a brand-new user in under 5 minutes.

## Architecture

```
src/
├── components/
│   ├── layout/
│   │   ├── app-header.tsx        ← title + theme toggle + help
│   │   ├── theme-toggle.tsx
│   │   └── help-dialog.tsx
│   └── errors/
│       ├── error-toast.tsx       ← helper to show a branded error toast
│       └── retry-button.tsx
├── lib/
│   ├── errors/
│   │   ├── to-user-message.ts    ← FreepikApiError → { title, body, action }
│   │   └── error-codes.ts
│   └── shortcuts/
│       └── use-keyboard.ts       ← generic hook
└── app/
    └── layout.tsx                 ← wrap w/ <ThemeProvider>
```

## Related Code Files

### Create
- `src/components/layout/app-header.tsx`
- `src/components/layout/theme-toggle.tsx`
- `src/components/layout/help-dialog.tsx`
- `src/components/errors/error-toast.tsx`
- `src/components/errors/retry-button.tsx`
- `src/lib/errors/to-user-message.ts`
- `src/lib/errors/error-codes.ts`
- `src/lib/shortcuts/use-keyboard.ts`

### Modify
- `src/app/layout.tsx` — wrap children in `<ThemeProvider attribute="class" defaultTheme="dark">` + render `<AppHeader />`
- `src/app/globals.css` — audit color tokens for dark mode
- All places that currently throw raw errors → go through `errorToast(err)`
- `README.md` — full rewrite
- `docs/*` — fill in

## Implementation Steps

1. **Install `next-themes`**: `pnpm add next-themes`

2. **ThemeProvider wrapper** in `layout.tsx`; add `<ThemeToggle />` in new `<AppHeader />`.

3. **Write `to-user-message.ts`** — exhaustive switch over `FreepikApiError.code` + HTTP status; returns `{ title, body, actionLabel?, onAction? }`.

4. **Write `errorToast.ts`** — wraps `sonner.toast.error()` with the mapping result. Always includes a "Details" button that opens a secondary dialog with the raw error payload (developer mode).

5. **Replace every ad-hoc `toast.error(...)` from Phases 4 and 5** with `errorToast(err)` calls.

6. **Empty states** — write friendly messages + small SVGs (use lucide's built-in icons like `ImageOff`, `Sparkles`, `VideoOff`).

7. **Skeletons** — use shadcn's `Skeleton` component in the preview panel and history sidebar.

8. **Keyboard hook** — `useKeyboard({ '$mod+Enter': submit, '$mod+I': improve, 'Escape': closeDialog })`. Use `react-hotkeys-hook` if it simplifies (tiny dep).

9. **Help dialog** — content includes: what the button does, Freepik Kling 3 limits, link to docs, list of keyboard shortcuts.

10. **Accessibility pass**:
    - All form inputs have `<Label htmlFor="...">` — check via DevTools.
    - Color contrast ≥ 4.5:1 — use shadcn default tokens (already compliant).
    - Keyboard tab order makes sense.
    - ARIA labels on icon-only buttons.

11. **README.md rewrite** — sections:
    - Hero screenshot
    - Features (bulleted)
    - Requirements (Node 20+, Freepik API key)
    - Setup (3 steps)
    - Usage walkthrough
    - Troubleshooting
    - Roadmap (link to plan.md)
    - License (MIT or "personal use")

12. **Fill in `docs/`** (short and functional):
    - `system-architecture.md`: one Mermaid diagram + one paragraph per layer.
    - `code-standards.md`: kebab-case files, component < 200 LOC, feature folders, import order.
    - `development-roadmap.md`: check off Phase 1–6, list expansion ideas.
    - `project-changelog.md`: v1.0.0 release notes.

13. **Manual QA checklist** (run and record results):
    - [ ] Fresh clone → `pnpm install` → `pnpm check:api` → OK
    - [ ] `pnpm dev` boots
    - [ ] Dark mode toggle works + persists
    - [ ] T2V simple prompt generates a playable video (Pro)
    - [ ] T2V with Std tier works
    - [ ] I2V with start frame only works
    - [ ] I2V with start + end frames works
    - [ ] Multi-shot 3 scenes 12s total works
    - [ ] Improve prompt returns richer text and can be accepted/undone
    - [ ] Character counter turns red past 2500
    - [ ] Aspect ratio picker updates preview shape
    - [ ] Invalid API key → correct toast
    - [ ] Disconnect network mid-generation → correct toast
    - [ ] Reload mid-generation → polling resumes
    - [ ] Re-run from history creates a new task with same params
    - [ ] Delete a history item → gone + localStorage updated
    - [ ] Clear all → history empty
    - [ ] ⌘+Enter submits
    - [ ] ⌘+I improves prompt
    - [ ] Escape closes dialogs
    - [ ] Zero console errors during full run
    - [ ] Lighthouse accessibility ≥ 95
    - [ ] Responsive on 360px / 768px / 1280px / 1920px
    - [ ] `pnpm tsc --noEmit` passes

14. **(Stretch) Webhook receiver** — `POST /api/freepik/webhook` that updates task store by taskId when Freepik calls back. Out of scope if time-constrained; just document the contract.

## Todo List

- [ ] Install `next-themes`
- [ ] ThemeProvider + theme toggle
- [ ] `AppHeader` w/ title, theme toggle, help button
- [ ] `HelpDialog` with shortcuts + tips
- [ ] `lib/errors/to-user-message.ts` + `error-codes.ts`
- [ ] `errorToast` helper; replace all ad-hoc error toasts
- [ ] Empty states across preview panel + history sidebar
- [ ] Skeleton loaders
- [ ] Keyboard shortcuts hook + wire to submit / improve / escape
- [ ] A11y pass (labels, contrast, tab order, ARIA)
- [ ] README.md rewrite
- [ ] Fill in `docs/system-architecture.md`
- [ ] Fill in `docs/code-standards.md`
- [ ] Fill in `docs/development-roadmap.md`
- [ ] Fill in `docs/project-changelog.md`
- [ ] Run manual QA checklist — record results in `docs/project-changelog.md`
- [ ] (Stretch) Webhook receiver route
- [ ] Final `pnpm tsc --noEmit` → clean

## Success Criteria

- Every item in the manual QA checklist passes.
- No console errors during the happy path.
- Lighthouse accessibility ≥ 95.
- A new developer can clone the repo, follow the README, and generate their first video in < 5 minutes.
- `docs/` is a usable reference, not just skeletons.

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Running out of Freepik credits during manual QA | Use the cheapest path (Std tier, 3s duration) for most checklist items |
| Dark mode FOUC (flash of unstyled content) | `next-themes` provides `suppressHydrationWarning` pattern; follow their docs |
| Polyfill gap for `$mod` hotkey on Linux | `react-hotkeys-hook` handles this; alternative: manual `navigator.platform` detect |

## Security Considerations

- Before shipping, grep the repo for any logged `FREEPIK_API_KEY` — should be zero hits.
- README must have a **big bold note** to never commit `.env.local`.
- Webhook (stretch) must validate the Freepik signature if Freepik provides one; if not, note it as "unauthenticated — bind to localhost only".

## Next Steps

After Phase 6, v1 is complete. Announce to user. Gather feedback. Move to expansion roadmap:
1. Kling 3 Omni variants (reference-video guidance)
2. Hailuo 02 / 2.3 (cheap T2V + I2V)
3. Seedance Pro 1080p
4. Runway Gen 4 Turbo + Runway Act Two
5. WAN 2.5 / 2.6
6. Pixverse, LTX-2 Pro

Each addition should be ~1 day of work thanks to the model abstraction established in Phases 2 and 3.
