# Improvement Roadmap — 2026-05-04

> Sau khi đã ship: design system, security P0 (rate limit, login throttle, CORS),
> cross-device history, smart download proxy, Excel import, multi-copy, anti-lag,
> migration 0002 fix.
>
> Mục tiêu: list các phương án cải thiện, priority, effort, ROI.
> Bạn pick subset rồi tôi triển khai.

---

## Priority Matrix

| Tier | Định nghĩa | Khi làm |
|------|-----------|---------|
| **P0** | Block public launch — money/security/correctness | Trước khách thật ngoài bạn bè |
| **P1** | Fix trong 2 tuần — operational gap khi scale | Trước khách thứ 5 |
| **P2** | Tháng đầu — quality, polish, docs | Backlog có deadline |
| **P3** | Khi rảnh | Backlog không deadline |

---

## P0 — Block public launch

### P0.1. Pricing accuracy verification (CRITICAL)
**Risk**: Pricing matrix tôi seed bằng số đoán. Nếu sai → over-charge khách (mất uy tín) hoặc under-charge (lỗ).
**Action**:
1. Tạo 1 video std 5s + 1 pro 5s + 1 std 10s
2. So sánh `usedEur` trong DB vs Freepik dashboard (account `za01154987933@gmail.com`)
3. Update `pricing_rules` table nếu lệch
**Effort**: 30 phút (test chính). Tôi không tự làm được vì cần Freepik dashboard.
**Tự động hoá tương lai**: cron daily so sánh tổng sum vs Freepik /me/usage endpoint.

### P0.2. Test atomic charge race
**Risk**: 50 customer × 5 video song song có thể dẫn đến over-spend nếu SQL `usedEur += cost` không atomic.
**Action**: Script `Promise.all(50× chargeCode())` → kiểm balance cuối cùng có khớp.
**Effort**: 1h viết script + run.
**Hiện tại**: Code dùng `UPDATE ... SET used_eur = used_eur + $cost WHERE used_eur + $cost <= quota_eur RETURNING ...`. Là atomic. Test xác nhận thôi.

### P0.3. Vercel function timeout cho download proxy
**Risk**: Video 30MB qua sin1 → US-East CDN có thể chậm. Hobby plan timeout 300s (fluid). Hết → user thấy 500 dù file có thể download được.
**Action**:
1. Add `accept-encoding: gzip` forward (Freepik chưa chắc gzip)
2. Stream upstream body trực tiếp thay vì buffer (tôi đã làm)
3. Monitor function duration p95
**Effort**: Đã có. Chỉ cần monitor.

### P0.4. Refund-on-Freepik-failure window
**Risk**: charge → Freepik 500 → refund. Nếu refund SQL fail (network blip) → tiền mất hẳn.
**Action**: Audit `refundIfCharged` — nếu fail, log REFUND_FAILED loud cho admin reconcile thủ công.
**Effort**: Code đã có log. Cần thêm:
- Email/Slack alert khi REFUND_FAILED
- Admin UI list các REFUND_FAILED rows + 1-click manual refund
**Effort fix**: 2h.

### P0.5. Backup Freepik key
**Status**: ✅ Đã activate `Account 1 (real)` → 2 key active, ~985 EUR remaining tổng.

### P0.6. Admin password rotation
**Status**: ⚠️ Password đã lộ trong chat session này. Bạn cần rotate ngay.
**Action**:
```bash
openssl rand -base64 32
# Vercel dashboard → Env → ADMIN_PASSWORD → paste → Save → redeploy
```

### P0.7. Vercel token revocation
**Status**: ⚠️ 1 token (`vcp_4mBgf...`) đã lộ trong chat. Bạn cần revoke ở `https://vercel.com/account/tokens`.

### P0.8. Freepik API key in `.env.local`
**Bạn vừa nói**: thêm Freepik API key vào `.env.local`.
**Risk**: nếu commit vào git → public leak. Đảm bảo `.env.local` trong `.gitignore` (hiện tại có).
**Action**: 
```bash
grep "^.env.local$" /tmp/openfreepik-redeploy/.gitignore
# Should output ".env.local"
```

---

## P1 — Fix trong 2 tuần

### P1.1. Vitest setup + critical tests
**Why**: 0 tests. Mỗi refactor ngày càng risk.
**Coverage targets**:
- `lib/auth/activation.ts` — atomic charge / refund
- `lib/freepik/key-pool.ts` — rotation + LRU
- `lib/pricing/calculator.ts` — lookup edge cases
- `lib/auto-download.ts` — filename construction
- `lib/parse-batch-file.ts` — Excel/CSV parser
**Effort**: 4-6h setup + tests.

### P1.2. Structured logging + Sentry
**Why**: Hiện có `lib/logger.ts` nhưng output console only. Vercel logs ephemeral 1h trên Hobby.
**Action**:
1. Sign up Sentry free tier
2. Wrap top-level catch trong API routes với `Sentry.captureException`
3. Frontend: `Sentry.init` với DSN → catch React errors
**Effort**: 1-2h.

### P1.3. Alerting cho key exhausted + refund failed
**Why**: Khi key cạn quota Freepik, hiện chỉ log. Không ai biết đến khi customer phàn nàn.
**Action**: Webhook → Discord/Telegram khi:
- `ALL_KEYS_EXHAUSTED`
- `REFUND_FAILED`
- `LOGIN_LOCKOUT` (admin login bị brute force)
**Effort**: 1-2h (Discord webhook free).

### P1.4. Rate limit `/api/usage`
**Status**: Đã có rate limit POST endpoints. Nhưng GET `/api/usage` chưa cap → user spam refresh có thể drain Neon free tier (191 compute-hour/tháng).
**Action**: Thêm `checkRateLimit({ resource: "usage", scope: codeId, limit: 30, windowSec: 60 })`.
**Effort**: 10 phút.

### P1.5. Webhook thay polling (nếu Freepik hỗ trợ)
**Why**: Polling 2s × N video × 5p = nhiều DB call. Vercel function-time cũng tốn.
**Action**: Check Freepik docs xem có webhook callback "task done" không. Nếu có → Freepik POST → /api/freepik/webhook → update usage_logs.
**Effort**: 4h (nếu có webhook). Defer nếu không.

### P1.6. Cron job cleanup verification
**Status**: `/api/cron/purge` exists. Vercel cron config trong `vercel.json` (`0 2 * * *`).
**Verify**:
- Vercel dashboard → Crons → xem ngày chạy gần nhất
- Manual trigger với CRON_SECRET, kiểm log có "purged X rows"
**Effort**: 15 phút.

### P1.7. Admin dashboard charts
**Why**: Stat cards plain. Khó nhận trend.
**Action**: Recharts sparklines (đã trong shadcn ecosystem) cho:
- Today × 7 days videos
- Per-key spend over time
- Top customers by spend
**Effort**: 3h.

### P1.8. Database backup verification
**Why**: Neon có auto-backup nhưng chưa test restore.
**Action**: 
1. Neon dashboard → Backups → snapshot list
2. Test restore vào branch dev → query `usage_logs.id` count khớp
**Effort**: 30 phút.

### P1.9. .env.local secrets isolation (S1 từ audit cũ)
**Status**: Bạn vừa thêm Freepik API key vào `.env.local`. Đó là OK cho local dev.
**Risk còn**: Nếu local `.env.local` cùng `DATABASE_URL` với prod → script `db:migrate` chạy local vẫn affect prod.
**Action**: Tạo Neon branch `dev` (free):
```
neon branches create --name=dev
# Update .env.local: DATABASE_URL=<dev branch URL>
# Vercel prod env: DATABASE_URL=<main branch URL>
```
**Effort**: 30 phút.

---

## P2 — Tháng đầu

### P2.1. File size violations (rule: <200 lines)
| File | Lines |
|------|-------|
| `app/(admin)/dashboard/(authed)/codes/page.tsx` | 396 |
| `components/history/history-sidebar.tsx` | 345 |
| `lib/freepik/orchestrator.ts` | 333 |
| `hooks/use-batch-queue.ts` | 323 |
| `components/batch/batch-excel-import.tsx` | 308 |
| `components/generator/generator-form.tsx` | 292 |
| `app/(admin)/dashboard/(authed)/keys/page.tsx` | 270 |
| `components/usage/usage-panel.tsx` | 260 |

**Action**: Split mỗi file thành 2-3 components/modules nhỏ hơn.
**Effort**: 1-2h mỗi file.

### P2.2. Translate residual English
- `metadata.expiresAt` toast format
- Admin dashboard toasts (cố ý English vì admin = bạn, OK skip)
- Error messages chưa qua `friendlyError()` decoder

### P2.3. UX polish
- Loading skeletons consistent (history rehydration flash)
- Empty states cho admin tabs (codes/keys empty)
- Keyboard shortcut hint dropdown

### P2.4. Documentation
- README outdated (vẫn nói "single Freepik key model")
- ARCHITECTURE.md (5 tables, request lifecycle, key rotation diagram)
- RUNBOOK.md (rollback, env rotation, common issues)
- API.md cho admin endpoints

### P2.5. Bundle analyzer
```bash
pnpm dlx @next/bundle-analyzer
```
Tìm chunks lớn để code-split.

### P2.6. Type strictness audit
- `tsconfig.json` đã có `strict: true`?
- `noUncheckedIndexedAccess`?
- `exactOptionalPropertyTypes`?

---

## P3 — Backlog

### P3.1. Multi-tenant (multi-admin)
Hiện single-admin. Sau này nhiều partner → cần admin per partner.

### P3.2. Storage tier riêng (S3/R2)
Lưu video ≥24h thay vì rely Freepik URL TTL.

### P3.3. Realtime task progress (SSE)
Stream "5%, 30%, 70%" thay vì poll.

### P3.4. Preset library
"Cinematic", "Anime", "Realistic" presets fill prompt + tier + aspect 1 click.

### P3.5. Customer dashboard `/usage` page
Hiện dialog popup. Có thể là full page với charts.

### P3.6. GDPR
- Privacy policy / ToS pages
- Data retention policy (purge usage_logs > 90 days?)
- Customer "export my data" / "delete my account" endpoints

---

## Recommendation order

Nếu phải pick top 5 ngay tuần này:

1. **P0.1 Pricing verification** (30p) — bắt buộc trước khách thật
2. **P0.6 Admin password rotation** (5p) — bạn làm thôi, đã lộ
3. **P0.7 Vercel token revoke** (5p) — như trên
4. **P1.2 Sentry setup** (1-2h) — có khả năng debug khi có vấn đề
5. **P1.1 Vitest + critical tests** (4-6h) — chống regression khi refactor

Total ~1 ngày. Sau đó xét sang P1 còn lại.

---

## Tôi tự làm được vs cần bạn

| Task | Tôi tự | Bạn cần làm |
|------|--------|-------------|
| Vitest setup + write tests | ✓ | Review |
| Sentry init | ✓ | Sign up + paste DSN |
| File size split refactor | ✓ | Review |
| Bundle analyzer | ✓ | Read report |
| README/docs | ✓ | Review |
| Pricing verification | ✗ | Bạn phải Freepik dashboard |
| Admin password rotation | ✗ | Bạn phải Vercel env |
| Vercel token revoke | ✗ | Bạn phải Vercel account |
| GDPR legal | ✗ | Bạn (hoặc luật sư) |
| Neon dev branch | ✓ (qua API) | Bạn approve |
