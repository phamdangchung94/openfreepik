# Brand rename reference — 2026-05-06 (commit `6ac606a`)

White-label pass: scrub every user-facing reference to "Freepik" /
"Magnific" so customers don't see which upstream provider we use.
Two layers were added — direct string replacement plus a runtime
sanitizer that catches anything bleeding through from the API.

This file is a permanent reference: if any error message looks
unfamiliar in the future, search here first.

## Table of changes — direct string replacements

### Server-side error messages (returned to client)

| File | Trước | Sau |
|---|---|---|
| `src/lib/error-messages.ts` | `Freepik trả về không đúng định dạng — đã hoàn tiền, vui lòng thử lại.` | `Máy chủ trả về dữ liệu lỗi — đã hoàn tiền, vui lòng thử lại.` |
| `src/lib/freepik/orchestrator.ts:166` | `No Freepik keys with sufficient budget — please contact support.` | `No active video credits available — please contact support.` |
| `src/lib/freepik/orchestrator.ts:189` | `Freepik returned an unexpected response — refunded.` | `Upstream returned an unexpected response — refunded.` |
| `src/lib/freepik/orchestrator.ts:321` | `All Freepik keys ran out of credit — please contact support.` | `All upstream credits exhausted — please contact support.` |
| `src/lib/freepik/orchestrator.ts:352` | `No Freepik keys available.` | `No active video credits available.` |
| `src/lib/freepik/base-client.ts:28` | `API key is required. Please enter your Freepik API key.` | `API key is required.` |
| `src/lib/freepik/base-client.ts:72` | `Freepik returned a non-JSON response.` | `Upstream returned a non-JSON response.` |
| `src/lib/freepik/base-client.ts:98` | `Freepik account is out of credit.` | `Account is out of credit.` |
| `src/lib/freepik/base-client.ts:133` | `Freepik refused the request — key likely suspended or limited.` | `Upstream refused the request — key likely suspended or limited.` |
| `src/lib/freepik/base-client.ts:173` | `Freepik server error. Try again later.` | `Upstream server error. Try again later.` |
| `src/app/api/download/[taskId]/route.ts:210` | `Không lấy được video từ Freepik.` | `Không lấy được video từ máy chủ.` |

### Customer-facing UI text

| File | Trước | Sau |
|---|---|---|
| `src/components/batch/batch-progress-widget.tsx:136` (tooltip) | `Đang gọi Freepik` | `Đang xử lý trên máy chủ AI` |
| `src/hooks/use-auto-download.ts:188` (toast) | `Freepik không trả về video — thử lại sau` | `Máy chủ không trả về video — thử lại sau` |

### Admin UI text (admin-only — scrubbed because user requested ALL refs hidden)

| File | Trước | Sau |
|---|---|---|
| `src/components/dashboard/dashboard-nav.tsx:19` | `Freepik keys` (nav label) | `API keys` |
| `src/components/dashboard/dashboard-nav.tsx:35` | `OpenFreepik Admin` | `Admin Console` |
| `src/app/(admin)/dashboard/(authed)/page.tsx:83` | `Freepik key pool budget` | `API key pool budget` |
| `src/app/(admin)/dashboard/(authed)/keys/page.tsx:148` | `Freepik keys` (h1) | `API keys` |
| `src/app/(admin)/dashboard/(authed)/keys/page.tsx:151-152` | `Freepik exposes no balance API ... verify against the Magnific dashboard` | `upstream exposes no balance API ... verify against the provider dashboard` |
| `src/app/(admin)/dashboard/(authed)/keys/page.tsx:161` (title) | `Probe every key against Magnific. ...` | `Probe every key against upstream. ...` |
| `src/app/(admin)/dashboard/(authed)/keys/page.tsx:205` | `No Freepik keys yet — add one so customers can generate.` | `No API keys yet — add one so customers can generate.` |
| `src/app/(admin)/dashboard/(authed)/keys/page.tsx:314` (title) | `Probe Magnific for quota / rate-limit headers` | `Probe upstream for quota / rate-limit headers` |
| `src/app/(admin)/dashboard/(authed)/keys/page.tsx:363` | `Magnific probe` | `Upstream probe` |
| `src/app/(admin)/dashboard/(authed)/keys/page.tsx:555` | `Add Freepik key` (dialog title) | `Add API key` |
| `src/app/(admin)/dashboard/(authed)/keys/page.tsx:568` | `Freepik API key (plaintext)` (label) | `API key (plaintext)` |
| `src/app/(admin)/dashboard/(authed)/keys/page.tsx:591` | `Default 500 — Freepik's free-tier credit per account.` | `Default 500 — provider's free-tier credit per account.` |
| `src/app/(admin)/dashboard/(authed)/usage/usage-filters.tsx:110` | `Key Magnific` (placeholder) | `API Key` |
| `src/app/(admin)/dashboard/(authed)/usage/usage-table.tsx` | column label `URL Magnific` / `URL R2` | `URL gốc` / `URL CDN` |

## Runtime sanitizer (catches upstream message bleed-through)

Two stripper functions normalize any text right before it hits the
customer. Both apply the same regex:

```ts
.replace(/\bMagnific\b/gi, "máy chủ AI")
.replace(/\bFreepik\b/gi, "máy chủ AI")
.replace(/https?:\/\/(?:www\.)?(?:magnific|freepik)\.com\S*/gi, "")
.replace(/\s{2,}/g, " ")
.trim();
```

| Function | File | Where it fires |
|---|---|---|
| `sanitizeUpstreamMessage()` | `src/lib/freepik/base-client.ts` | Inside `mapHttpError()` — runs the upstream JSON `message` field through the regex before it lands on `FreepikApiError.message`. Catches Magnific 401/402/403/429/5xx prose like `"verify your API key at https://www.magnific.com/..."`. |
| `stripBrandNames()` | `src/lib/error-messages.ts` | At the END of `friendlyError()` — fallthrough path. Anything that didn't match a `CODE_MAP` or `PHRASE_MAP` entry gets scrubbed before being returned to the UI. Defense-in-depth. |

## New PHRASE_MAP entry — free-trial 429

`src/lib/error-messages.ts` now matches the Magnific-specific
free-trial-exhausted message early:

```ts
[
  /free trial|trial usage|upgrade.*paid|paid plan|usage limit|api plan|plan limit/i,
  "Hệ thống tạm thời hết credit — vui lòng thử lại sau.",
]
```

Was leaking through as raw upstream prose; now collapses to one
neutral Vietnamese line.

## Things deliberately NOT renamed (and why)

| Item | Why kept |
|---|---|
| `class FreepikApiError` (TypeScript class name) | Internal identifier — never reaches the UI. Renaming triggers churn across many files for no user-visible benefit. |
| Route paths `/api/freepik/kling-v3` / `/api/freepik/improve-prompt` | Visible in DevTools Network tab only (technical user). Renaming requires server-side redirects + client-side fetcher updates, plus risk of breaking a customer who bookmarked an in-flight job URL. |
| Admin cookie name `openfreepik-admin` | Renaming forces every active admin session to re-login. Saved for a future scheduled rotation rather than this cleanup. |
| Allowlist hostnames `freepik.com`, `magnific.com`, `*.r2.dev` (in `src/lib/url-allowlist.ts` and `src/app/api/download/[taskId]/route.ts`) | Internal validation logic — the strings are *checks against* incoming URLs, not text shown to the user. Removing them would break video playback / download. |
| Env var names `FREEPIK_API_BASE_URL`, `FREEPIK_API_KEY_HEADER` | Used to override the default (`https://api.magnific.com` / `x-magnific-api-key`) without redeploying. Renaming requires updating every Vercel environment for no UI gain. |
| Browser tab title `"Kling 3 Video Generator"` | Already brand-free. |
| Internal column id `magnific` (in `usage-table.tsx`) | Used as a Set key only — the visible column LABEL is `URL gốc` (already swapped above). |
| Comments containing brand names | Source-only; not shipped to the browser. |

## How to extend in the future

If you ever want to rename additional places (route paths, the cookie,
class names), do them in their own commit so:

1. The change set is reviewable on its own.
2. Rollback is one `git revert` if the rename breaks something
   downstream (especially the cookie — admin login depends on it).

If you find a NEW user-facing string that mentions an upstream brand
later, add it to the table above AND verify the runtime sanitizer
catches it as a backup. The sanitizer regex is intentionally
conservative (word-boundary anchored, case-insensitive); test with the
actual error message before relying on it.

## Verification commands

```bash
# Find any remaining hard-coded brand text in source.
grep -rn -E '"[^"]*[Ff]reepik|"[^"]*[Mm]agnific' src \
  --include="*.ts" --include="*.tsx" \
  | grep -vE "^\s*\*|^\s*//|test\.|import |from \"@"

# Watch for upstream brand text leaking back to the customer in
# production (Vercel logs).
grep -i "magnific\|freepik" <(vercel logs ...)
```
