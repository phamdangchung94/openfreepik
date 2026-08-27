# OpenFreepik — Software Flows

Cây thư mục các luồng (flows) chính của hệ thống, tổng hợp từ codebase hiện tại.
Đây là góc nhìn theo **luồng người dùng/dữ liệu** (bổ trợ cho `system-architecture.md`
vốn theo góc nhìn kỹ thuật).

> Cập nhật khi codebase thay đổi đáng kể (thêm endpoint mới, đổi orchestrator,
> đổi data model, v.v.).
>
> Muốn mở rộng catalog model (Kling 3 Omni, Nano Banana Pro/Flash, video
> upscaler, audio, lip-sync…) hoặc dùng tính năng nền tảng mới của Magnific
> (MCP, x402, credit-based)? Xem [`magnific-api-2026-update.md`](magnific-api-2026-update.md)
> — có sơ đồ khác biệt, đặc tả endpoint, và checklist "thêm 1 model mới".

---

## 1. Tổng quan các luồng

| # | Luồng | Entry point | Lõi xử lý | Đụng DB |
|---|---|---|---|---|
| 1 | Customer activation | `/api/activate` | `auth/activation.ts` | `activation_codes` |
| 2 | Single T2V/I2V | form → `/api/freepik/{kling-v3 \| kling-4k-t2v \| kling-4k-i2v \| wan-v27}` | `freepik/orchestrator.ts` | `activation_codes`, `freepik_keys`, `usage_logs`, `pricing_rules` |
| 3 | Batch | `use-batch-queue.ts` | gọi N lần luồng #2 song song (Kling 3 std/pro/4k đều support) | giống #2 |
| 4 | Multi-shot (chỉ Kling 3 std/pro) | cùng endpoint #2 + body `multi_prompt[]` | giống #2 | giống #2 |
| 5 | Improve prompt | `/api/freepik/improve-prompt` | `orchestrator.ts` (cost=0) | `usage_logs` |
| 6 | Auto-download | `/api/download/[taskId]` | proxy stream từ R2/Magnific | — |
| 7 | History / Orphan recovery | client localStorage + `use-orphan-recovery.ts` | resume polling | — |
| 8 | Usage panel (khách) | `/api/usage`, `/api/pricing/rates` | đọc DB | `usage_logs`, `pricing_rules` |
| 9 | Admin CRUD | `/api/admin/*` | `auth/admin-server.ts` + Drizzle | tất cả bảng |
| 10 | Cron purge + key healthcheck | Vercel cron → `/api/cron/purge` | dọn rate_limit/sessions, probe + auto-deactivate dead keys | `rate_limit_buckets`, `admin_sessions`, `failed_logins`, `freepik_keys` |
| 11 | Magnific webhook receiver | `/api/freepik/webhook` | HMAC verify (Svix-style) → `finalizeUsageOnPoll` | `usage_logs`, `activation_codes` (refund), `freepik_keys` (secret lookup) |
| 12 | Announcement broadcast | admin: `/api/admin/announcements` CRUD · customer: `/api/announcements` poll (60s) | `AnnouncementBanner` mount + per-device dismiss qua localStorage | `announcements` (migration 0012) |
| 13 | Public API (`/api/v1/*`) | client gọi `/api/v1/{me,video/*,prompt/improve,tasks/{id}}` với `Authorization: Bearer sk_*` | `requireApiKey` → orchestrator (`preValidated` path) | `api_keys` (migration 0014), `activation_codes`, `usage_logs` |
| 14 | Customer file upload | form picker → `/api/upload/presign` → browser PUT → R2 `uploads/{image\|video}/` | `lib/upload/image-host.ts` + `lib/storage/r2.ts` (presigned PUT) | — (R2 only, no DB) |
| 15 | Upload TTL sweep | Vercel cron 15min → `/api/cron/sweep-uploads` | R2 ListObjectsV2 + DeleteObjects prefix `uploads/` age > 120 min | — (R2 only) |
| 16 | Kling 3 Omni (T2V/I2V/V2V) | form → `/api/freepik/kling-omni/[tier]` (`omni-std\|omni-pro\|omni-ref-std\|omni-ref-pro`) | `freepik/kling-omni.ts` (4 POST endpoints, 2 GET namespaces) → orchestrator | `usage_logs`, `pricing_rules` (8 rows: 4 endpoint × 2 audio) |

**Trung tâm hệ thống:** `src/lib/freepik/orchestrator.ts` — mọi gọi API tới
Magnific đều đi qua đây (validate code → charge → pick key → call → record → log).

**Layer riêng cho mobile UX** (parallel render với desktop, không đụng desktop UX):
- Customer page: bottom tab nav (3 ô Tạo/Xem/Lịch sử), now-playing bar trên tab nav, recent task strip trong Xem tab, adaptive video aspect (16:9/9:16/1:1) + PiP button — xem `src/app/(customer)/page.tsx` + `src/components/preview/*`.
- Admin dashboard: 6-ô bottom tab nav, card lists thay tables (`/codes` `/keys` `/usage`), FAB cho create dialogs, progressive render cho `/usage` >100 rows, collapsible filters — xem `src/components/dashboard/dashboard-nav.tsx`.

---

## 2. Cây thư mục các luồng

```
OpenFreepik — SaaS Video Generation (Kling V3 / Kling 4K / WAN V2.7 / Improve Prompt qua Freepik/Magnific)
│
├── ┌──────────────────────────────────────────────────────────────────────────────┐
│   │  🧑 LUỒNG KHÁCH HÀNG (customer)                                              │
│   │  Vào trang → nhập activation code → tạo video → xem/tải về                   │
│   └──────────────────────────────────────────────────────────────────────────────┘
│
├── src/app/(customer)/
│   ├── layout.tsx ............................. Wrapper (theme, header, toast)
│   ├── page.tsx ............................... Trang chủ — 3 cột (form, preview, history)
│   │   │
│   │   ├── ▶ FLOW 1: ONBOARDING & ACTIVATION ────────────────────────────────────
│   │   │   • components/customer-onboarding.tsx → hiển thị khi chưa kích hoạt
│   │   │       (chip Telegram t.me/chugaxai + Zalo 0336788856)
│   │   │   • components/layout/activation-code-input.tsx → input code; sau khi
│   │   │       activated → click label trong header → DropdownMenu hiển thị
│   │   │       full activation code + nút Copy (user dùng trên thiết bị khác)
│   │   │   • components/layout/contact-button.tsx → header icon Send → link
│   │   │       thẳng tới t.me/chugaxai (1-tap support)
│   │   │   • components/layout/announcement-banner.tsx → dưới header, poll
│   │   │       /api/announcements mỗi 60s, dismiss per-device qua localStorage
│   │   │   • POST /api/activate ────► api/activate/route.ts
│   │   │       → lib/auth/activation.ts → validateCode()
│   │   │       → DB: activation_codes (mode: unlimited|quota|topup)
│   │   │       → trả về metadata, lưu vào store/auth-store.ts (localStorage)
│   │   │
│   │   ├── ▶ FLOW 2: SINGLE VIDEO (T2V / I2V) ───────────────────────────────────
│   │   │   components/generator/
│   │   │     ├── generator-form.tsx ........... form chính (react-hook-form + Zod)
│   │   │     ├── mode-toggle.tsx .............. T2V / I2V
│   │   │     ├── prompt-field.tsx ............. textarea + char counter
│   │   │     ├── negative-prompt-field.tsx
│   │   │     ├── image-url-field.tsx .......... I2V: paste URL
│   │   │     ├── generator-i2v-source.tsx ..... I2V: upload file → R2
│   │   │     ├── start-end-frame-uploader.tsx . frame đầu/cuối
│   │   │     ├── model-picker.tsx ............. Kling 3 / WAN V2.7 (Kling 4K là 1 tier)
│   │   │     ├── quality-tier-picker.tsx ...... 4K / 1080p (pro) / 720p (std) — dispatch endpoint theo tier
│   │   │     ├── aspect-ratio-picker.tsx ...... 16:9 / 9:16 / 1:1
│   │   │     ├── duration-slider.tsx .......... 3–15s
│   │   │     ├── cfg-scale-slider.tsx ......... 0–1
│   │   │     ├── generate-audio-switch.tsx
│   │   │     ├── generator-advanced-settings.tsx
│   │   │     ├── resolution-picker.tsx ........ (WAN) 720p/1080p
│   │   │     └── cost-preview.tsx ............. ước tính EUR/VND
│   │   │
│   │   │   hooks/use-generate-video.ts → fire-and-forget worker
│   │   │     → POST /api/freepik/{kling-v3 | kling-4k-t2v | kling-4k-i2v | wan-v27}
│   │   │         ├── lib/freepik/route-helpers.ts → extractBearer (activation code)
│   │   │         ├── lib/freepik/kling-v3-schema.ts → validate Zod
│   │   │         ├── lib/pricing/calculator.ts → tính cost EUR
│   │   │         └── lib/freepik/orchestrator.ts ──┐
│   │   │             1. validateCode               │
│   │   │             2. chargeCode (codes.used_eur)│
│   │   │             3. pickActiveKey (key-pool)   │ Retry ≤3 keys
│   │   │             4. lib/freepik/kling-v3.ts ───┤  nếu quota exhausted
│   │   │                → base-client.ts (HTTP)    │  → markKeyExhausted
│   │   │                → Magnific API             │  → thử key tiếp
│   │   │             5. recordKeyCost ─────────────┘
│   │   │             6. logUsage → usage_logs (status='pending' if cost>0; 'succeeded' if free)
│   │   │     ← trả freepik_task_id về client
│   │   │
│   │   │   hooks/use-task-polling.ts → backoff (2→10s, timeout 1800s = 30 min)
│   │   │     → GET /api/freepik/{endpoint}/[taskId]
│   │   │       • rate limit per (code, task) — 60/min, KHÔNG phải per-code
│   │   │       • SELECT key_id FROM usage_logs WHERE freepik_task_id=X
│   │   │         (migration 0008 partial index, O(1)) → preferredKeyId
│   │   │       • authedFreepikCall dùng key gốc (tránh 404 alternation
│   │   │         vì Magnific scope task theo account)
│   │   │       → finalizeUsageOnPoll
│   │   │       khi COMPLETED + có URL:
│   │   │         ├── tải video từ Magnific → upload R2 mirror (lib/storage/r2.ts)
│   │   │         ├── cập nhật usage_logs.videoUrl + magnificVideoUrl
│   │   │         ├── tính videoUrlExpiresAt (TTL 6h - video-url-ttl.ts)
│   │   │         └── status = 'succeeded'
│   │   │       khi FAILED hoặc COMPLETED không có URL:
│   │   │         ├── refundCode → activation_codes.usedEur -= cost
│   │   │         └── status = 'refunded'  (rule: không có URL ≠ tính tiền)
│   │   │
│   │   ├── ▶ FLOW 3: BATCH (nhiều ảnh cùng lúc) ─────────────────────────────────
│   │   │   components/batch/
│   │   │     ├── batch-upload-zone.tsx ........ drag-drop ảnh
│   │   │     ├── batch-excel-import.tsx ....... import prompts từ xlsx/csv (parse-batch-file.ts)
│   │   │     ├── batch-t2v-input.tsx .......... batch text-only
│   │   │     ├── batch-settings.tsx ........... concurrency 1-10, autoEnhance toggle
│   │   │     └── batch-progress-widget.tsx .... thanh tiến độ chung
│   │   │   hooks/use-batch-queue.ts → fillSlots pattern
│   │   │     (mỗi item gọi /api/freepik/* qua cùng orchestrator)
│   │   │
│   │   ├── ▶ FLOW 4: MULTI-SHOT (đa cảnh) ───────────────────────────────────────
│   │   │   components/generator/
│   │   │     ├── generator-multi-shot-section.tsx
│   │   │     └── multi-shot-editor.tsx ........ tối đa 6 cảnh, total ≤15s
│   │   │   → cùng endpoint kling-v3, body có multi_prompt[] + elements[]
│   │   │
│   │   ├── ▶ FLOW 5: AI PROMPT ENHANCEMENT ──────────────────────────────────────
│   │   │   components/generator/improve-prompt-dialog.tsx
│   │   │   hooks/use-improve-prompt.ts
│   │   │   lib/improve-prompt-runner.ts
│   │   │     → POST /api/freepik/improve-prompt → improve-prompt.ts
│   │   │       (qua cùng orchestrator nhưng cost=0)
│   │   │     → GET /api/freepik/improve-prompt/[taskId] → poll 1.5s/60s
│   │   │
│   │   ├── ▶ FLOW 6: AUTO-DOWNLOAD ──────────────────────────────────────────────
│   │   │   components/layout/auto-download-toggle.tsx
│   │   │   hooks/use-auto-download.ts → lib/auto-download.ts
│   │   │     khi task COMPLETED → fetch GET /api/download/[taskId]
│   │   │     → api/download/[taskId]/route.ts (proxy stream → browser save)
│   │   │
│   │   ├── ▶ FLOW 7: HISTORY & ORPHAN RECOVERY ─────────────────────────────────
│   │   │   components/history/
│   │   │     ├── history-sidebar.tsx .......... list task (mới nhất trên)
│   │   │     └── history-item.tsx ............. card từng task
│   │   │   components/preview/
│   │   │     ├── preview-panel.tsx ............ video chính + Regenerate
│   │   │     │   (mobile: md:sticky md:top-4, max-md:-mx-4 edge-to-edge)
│   │   │     ├── video-player.tsx ............. aspect-adaptive (đọc
│   │   │     │   task.params.aspectRatio → aspect-[9/16] / aspect-square
│   │   │     │   / aspect-video) + Picture-in-Picture button
│   │   │     ├── mobile-now-playing-bar.tsx ... mobile-only, float trên
│   │   │     │   bottom tab nav. Pick running > recently completed (10min)
│   │   │     │   > recently failed (5min). Dismiss per-(taskId,status)
│   │   │     ├── recent-task-strip.tsx ........ mobile-only, horizontal
│   │   │     │   scroll thumb strip trong Xem tab. Tap để switch task
│   │   │     ├── status-badge.tsx
│   │   │     ├── url-countdown.tsx ............ đếm ngược TTL
│   │   │     └── parameters-block.tsx
│   │   │   store/task-store.ts → Zustand, persist localStorage
│   │   │   hooks/use-orphan-recovery.ts ....... reload page → resume polling
│   │   │   hooks/use-history-hydration.ts ..... đồng bộ task từ server (cross-device)
│   │   │   hooks/use-keyboard-shortcuts.ts .... Cmd+Enter, Cmd+I
│   │   │
│   │   ├── ▶ FLOW 8: USAGE PANEL (số dư + lịch sử dùng) ─────────────────────────
│   │   │   components/layout/usage-stats-button.tsx
│   │   │   components/usage/usage-panel.tsx
│   │   │   hooks/use-pricing-rates.ts
│   │   │     → GET /api/usage → api/usage/route.ts (mỗi customer)
│   │   │     → GET /api/pricing/rates → api/pricing/rates/route.ts
│   │   │   lib/format-currency.ts ............. EUR ↔ VND
│   │   │
│   │   └── ▶ FLOW 9: ERROR LOG ─────────────────────────────────────────────────
│   │       components/error-log/
│   │         ├── error-log-button.tsx
│   │         └── error-log-dialog.tsx
│   │       lib/error-messages.ts .............. mapping mã lỗi → text VN
│   │
│   └── pricing/page.tsx ...................... Bảng giá công khai
│       → đọc qua /api/pricing/rates
│
├── ┌──────────────────────────────────────────────────────────────────────────────┐
│   │  🤖 LUỒNG PUBLIC API (`/api/v1/*` — AI clients, MCP, custom integrations)   │
│   │  API key `sk_*` → REST JSON → orchestrator (cùng billing pipeline với web)  │
│   └──────────────────────────────────────────────────────────────────────────────┘
│
├── src/app/api/v1/
│   ├── me/route.ts ........................... GET probe key + balance
│   ├── video/
│   │   ├── kling-3/route.ts .................. POST kling-3 (tier std|pro)
│   │   ├── kling-3-4k-text/route.ts .......... POST kling-3 4K T2V
│   │   ├── kling-3-4k-image/route.ts ......... POST kling-3 4K I2V
│   │   └── kling-motion/[tier]/route.ts ...... POST motion (v2-6-std/pro, v3-std/pro)
│   ├── prompt/improve/route.ts ............... POST mở rộng prompt (free)
│   ├── tasks/[taskId]/route.ts ............... GET universal poll (dispatch theo
│   │                                              usage_logs.endpoint)
│   └── openapi.json/route.ts ................. GET OpenAPI 3.1 spec (CORS open)
│
│   Auth: src/lib/auth/api-key-helpers.ts → requireApiKey()
│     • Extract Bearer sk_* header → SHA-256 → JOIN api_keys + activation_codes
│     • Wraps metadata trong ValidationResult cho orchestrator.preValidated path
│     • Rate-limit scope = apiKeyId (không chia bucket với code khác)
│
│   Brand sanitize: poll response error_message qua stripBrandNames()
│   (src/lib/error-messages.ts) — defense-in-depth ngoài sanitizeUpstreamMessage
│   ở base-client. Đảm bảo không leak "Freepik" / "Magnific" cho AI client.
│
│   Docs công khai: src/app/docs/api/page.tsx (cURL/JS/Python tabs + copy)
│   AI integration guide: docs/ai-integration-guide.md (MCP, LangChain, OpenAI)
│
│   Admin UI mint/revoke: src/app/(admin)/dashboard/(authed)/api-keys/page.tsx
│   ├── CreateApiKeyDialog → POST /api/admin/api-keys → trả plaintext 1 lần
│   └── DELETE /api/admin/api-keys?id=… → revoke
│
├── ┌──────────────────────────────────────────────────────────────────────────────┐
│   │  👨‍💼 LUỒNG ADMIN (admin)                                                    │
│   │  Login → quản lý codes, keys, pricing, xem usage                              │
│   └──────────────────────────────────────────────────────────────────────────────┘
│
├── src/app/(admin)/dashboard/
│   ├── login/page.tsx ......................... form login (password)
│   │   → POST /api/admin/login ──► api/admin/login/route.ts
│   │     ├── lib/auth/login-throttle.ts → DB: failed_logins (5 sai/15p → khóa)
│   │     ├── lib/auth/admin.ts → so sánh ADMIN_PASSWORD env
│   │     ├── lib/auth/admin-server.ts → tạo session token
│   │     └── DB: admin_sessions (SHA-256 hash, TTL 24h)
│   │
│   └── (authed)/                              ← middleware kiểm tra cookie
│       ├── layout.tsx                          (components/dashboard/dashboard-nav.tsx)
│       │
│       ├── ▶ FLOW A1: OVERVIEW ─────────────────────────────────────────────────
│       │   page.tsx
│       │   → GET /api/admin/overview ── tổng quan keys/codes/usage/spend
│       │
│       ├── ▶ FLOW A2: ACTIVATION CODES ──────────────────────────────────────────
│       │   codes/page.tsx
│       │   → GET    /api/admin/codes ──── list
│       │   → POST   /api/admin/codes ──── tạo code mới (unlimited/quota/topup)
│       │   → PATCH  /api/admin/codes/[id] revoke / topup / sửa quota
│       │   → DELETE /api/admin/codes/[id]
│       │     DB: activation_codes
│       │
│       ├── ▶ FLOW A3: FREEPIK KEYS POOL ─────────────────────────────────────────
│       │   keys/page.tsx
│       │   → GET   /api/admin/keys ────── list (đã mask)
│       │   → POST  /api/admin/keys ────── thêm key (mã hóa AES-GCM lib/crypto/aes-gcm.ts)
│       │   → PATCH /api/admin/keys/[id]── đổi nhãn, max_concurrent, active
│       │   → POST  /api/admin/keys/[id]/refresh-quota
│       │           (probe-quota.ts: gọi Magnific lấy balance thực)
│       │   → POST  /api/admin/keys/refresh-all-quotas
│       │   → POST  /api/admin/keys/reactivate-all
│       │     DB: freepik_keys (key_encrypted, used_eur, max_concurrent)
│       │
│       ├── ▶ FLOW A4: PRICING MATRIX ─────────────────────────────────────────────
│       │   pricing/page.tsx
│       │   → GET    /api/admin/pricing
│       │   → POST   /api/admin/pricing ────── thêm rule
│       │   → PATCH  /api/admin/pricing/[id]── sửa giá
│       │   → DELETE /api/admin/pricing/[id]
│       │     DB: pricing_rules (lookup: endpoint+tier+duration+audio)
│       │
│       ├── ▶ FLOW A5: USAGE LOGS & STATS ─────────────────────────────────────────
│       │   usage/page.tsx + usage-filters.tsx + usage-stats.tsx + usage-table.tsx
│       │   → GET /api/admin/usage ───────── log từng request (filter; max 2000)
│       │   → GET /api/admin/usage/summary ─ tổng hợp theo ngày/code/key
│       │     DB: usage_logs
│       │   • Client-side progressive render: PAGE_SIZE=100, nút "Tải thêm"
│       │     load thêm chunk. Reset về 100 khi filter đổi. Sticky table header.
│       │   • Mobile: usage-filters collapsible (active count badge);
│       │     usage-table dùng UsageMobileCard thay vì <table>.
│       │
│       └── ▶ FLOW A6: ANNOUNCEMENTS BROADCAST ──────────────────────────────────
│           announcements/page.tsx
│           → GET    /api/admin/announcements ──── list (active + inactive)
│           → POST   /api/admin/announcements ──── tạo (title, body, severity,
│                                                  optional CTA + expiry)
│           → PATCH  /api/admin/announcements?id=X update / toggle active
│           → DELETE /api/admin/announcements?id=X xoá hẳn
│             DB: announcements (migration 0012)
│           • Severity: info (xanh) / warn (cam) / critical (đỏ) — drives
│             banner color trên customer page
│           • CTA URL chỉ chấp nhận http(s)://... hoặc /internal-path (chặn
│             javascript:/data: injection từ compromised admin session)
│           • Mobile: FAB cho create dialog (giống /codes /keys)
│           • Customer poll /api/announcements mỗi 60s — urgent broadcast
│             tới user đang online không cần reload
│

├── ┌──────────────────────────────────────────────────────────────────────────────┐
│   │  ⚙️ LUỒNG NỀN (background / infra)                                          │
│   └──────────────────────────────────────────────────────────────────────────────┘
│
├── src/app/api/cron/purge/route.ts ............ Vercel Cron daily 02:00 UTC
│   (vercel.json: "0 2 * * *", region "sin1")
│   • dọn rate_limit_buckets hết hạn
│   • dọn admin_sessions hết hạn
│   • dọn failed_logins cũ
│   • probeAndHealthcheckActiveKeys → auto-deactivate key 401
│   • (tuỳ chọn) re-mirror video sắp expire
│   Bảo vệ bằng CRON_SECRET header
│
├── ▶ FLOW 11: MAGNIFIC WEBHOOK RECEIVER ─────────────────────────────────────────
│   src/app/api/freepik/webhook/route.ts ........ Magnific push delivery (Svix-style)
│   src/lib/freepik/webhook-verify.ts ........... HMAC-SHA256 verification
│   src/lib/freepik/webhook-url.ts .............. resolve callback URL (env-based)
│   • Headers: webhook-id, webhook-timestamp, webhook-signature (v1,<base64>)
│   • Signed payload: ${id}.${ts}.${body}
│   • Probes every key có webhook_secret_encrypted (migration 0007) đến khi match
│   • Sau verify: gọi finalizeUsageOnPoll (cùng path với poll route → idempotent)
│   • Outbound: orchestrator inject params.webhook_url tự động khi VERCEL_ENV=production
│

├── src/lib/
│   ├── rate-limit.ts ............... fixed-window per code/IP → DB rate_limit_buckets
│   ├── logger.ts ................... structured JSON log (server-side)
│   ├── url-allowlist.ts ............ chặn SSRF cho start_image_url
│   ├── request-ip.ts ............... lấy IP thật từ headers (xforwarded)
│   ├── api-headers.ts .............. helper gửi `x-activation-code` từ client
│   ├── is-mobile.ts
│   ├── format-currency.ts .......... EUR ↔ VND (rate cố định)
│   ├── video-url-ttl.ts ............ tính expiresAt cho video URL
│   ├── parse-batch-file.ts ......... đọc xlsx/csv → BatchItem[]
│   ├── auto-download.ts ............ trigger browser save
│   ├── error-messages.ts ........... bản dịch lỗi VN
│   ├── auth/
│   │   ├── activation.ts ........... validateCode, chargeCode, refundCode
│   │   ├── admin.ts ................ password compare
│   │   ├── admin-server.ts ......... session token CRUD
│   │   └── login-throttle.ts ....... brute-force protection
│   ├── crypto/aes-gcm.ts ........... mã hoá Freepik key trong DB
│   ├── db/
│   │   ├── client.ts ............... Drizzle + Supabase Postgres pool
│   │   └── schema.ts ............... bảng (xem mục Data Model)
│   ├── form/
│   │   ├── generator-schema.ts ..... Zod v4 schema
│   │   ├── defaults.ts
│   │   ├── to-api-params.ts ........ form → API params
│   │   └── zod-resolver.ts ......... custom resolver cho RHF + Zod v4
│   ├── freepik/
│   │   ├── index.ts (barrel)
│   │   ├── types.ts
│   │   ├── base-client.ts .......... HTTP client (timeout, retry, headers)
│   │   ├── errors.ts ............... FreepikApiError
│   │   ├── route-helpers.ts ........ extractBearer, errorToResponse
│   │   ├── orchestrator.ts ......... 🔑 luồng trung tâm: charge + key pool + retry
│   │   ├── orchestrator-helpers.ts . finalizeUsageOnPoll (charge → succeeded/refunded)
│   │   ├── key-pool.ts ............. pickActiveKey / pickKeyById (poll preferred key)
│   │   │                              / markKeyExhausted / recordKeyCost
│   │   │                              / getKeyWebhookSecrets (webhook verify)
│   │   ├── poll-task.ts ............ R2 mirror khi COMPLETED
│   │   ├── probe-quota.ts .......... gọi Magnific + probeAndHealthcheckActiveKeys
│   │   ├── webhook-verify.ts ....... HMAC-SHA256 Svix-style + multi-encoding fallback
│   │   ├── webhook-url.ts .......... resolve outbound webhook_url
│   │   ├── kling-v3.ts + schema.ts
│   │   ├── kling-4k.ts + schema.ts . T2V + I2V (tier='4k', 1.12 EUR/s, audio param
│   │   │                              forwarded nhưng Magnific ignore → silent)
│   │   ├── wan-v27.ts + schema.ts
│   │   └── improve-prompt.ts + schema.ts
│   ├── pricing/calculator.ts ....... lookup pricing_rules → cost EUR
│   ├── storage/r2.ts ............... Cloudflare R2 (S3 SDK)
│   ├── upload/image-host.ts ........ upload ảnh I2V → R2 public URL
│   └── improve-prompt-runner.ts .... server-side runner cho batch autoEnhance
│
├── src/store/ (Zustand + localStorage)
│   ├── task-store.ts ............... tasks, queue, concurrency, autoEnhance
│   ├── preferences-store.ts ........ theme, language, autoDownload
│   ├── auth-store.ts ............... activationCode, customer metadata
│   └── regenerate-handler-store.ts . cầu nối Preview ↔ Form
│
├── src/proxy.ts .................... Next.js middleware (auth check cho /dashboard/(authed))
│
├── ┌──────────────────────────────────────────────────────────────────────────────┐
│   │  🗄️ DATA MODEL (Supabase Postgres + Drizzle)                                │
│   └──────────────────────────────────────────────────────────────────────────────┘
│
├── drizzle/migrations/ .............. 0000 → 0014
│   Tracking: __drizzle_migrations table (filename PK); scripts/db-migrate.ts
│   scan thư mục alphabetically, không dùng meta/_journal.json runtime.
│   Bảng:
│     • freepik_keys      — pool API keys (encrypted, used_eur, max_concurrent,
│                           webhook_secret_encrypted nullable từ 0007,
│                           paused_until từ 0013)
│     • activation_codes  — bearer code khách (mode, quota_eur, used_eur)
│     • api_keys          — public API auth keys (sk_*, sha256 hash, FK code_id
│                           → activation_codes cascade) — migration 0014
│     • usage_logs        — mỗi request 1 row (status, cost, video URLs, TTL,
│                           key_id, freepik_task_id — partial index từ 0008;
│                           error_message từ 0009; prompt từ 0011)
│     • pricing_rules     — ma trận giá (endpoint+tier+duration+audio)
│                           tier enum: 'pro' | 'std' | '4k' | null (motion)
│     • admin_sessions    — SHA-256 token hash, TTL 24h
│     • rate_limit_buckets — fixed-window counter (scope: per-(code,task) cho poll;
│                           per-apiKeyId cho /api/v1/*)
│     • failed_logins     — brute-force lock per IP
│     • announcements     — broadcast banner (migration 0012)
│
│   Latest migrations:
│     0012 — announcements table (broadcast banner)
│     0013 — freepik_keys.paused_until + usage_logs key_id/code_id indexes
│     0014 — api_keys table (public API auth, 2026-05-19)
│
├── ┌──────────────────────────────────────────────────────────────────────────────┐
│   │  🛠️ SCRIPTS VẬN HÀNH (chạy thủ công qua `pnpm tsx scripts/...`)             │
│   └──────────────────────────────────────────────────────────────────────────────┘
│
├── scripts/
│   ├── db-migrate.ts ................. apply migrations (pnpm db:migrate)
│   ├── db-status.ts .................. check connection + counts
│   ├── seed-pricing.ts ............... seed pricing_rules ban đầu
│   ├── calibrate-pricing.ts .......... tính lại giá từ data thực
│   ├── upsert-calibrated-pricing.ts
│   ├── admin-add-key.ts .............. CLI thêm Freepik key
│   ├── admin-create-code.ts .......... CLI tạo activation code
│   ├── reconcile-pending-charges.ts .. quét usage_logs.status='pending' lâu → probe + finalize
│   ├── check-api-key.ts .............. test 1 key có còn quota
│   ├── test-key-endpoints.ts
│   ├── test-key-pool.ts
│   ├── test-charge.ts ................ unit test orchestrator
│   ├── test-pricing.ts
│   ├── rotate-encryption-secret.ts ... đổi KEY_ENCRYPTION_SECRET (re-encrypt tất cả keys)
│   ├── audit-orchestrator-stress.ts .. stress test money path
│   └── inspect-recent-videos.ts ...... debug video URLs
│
├── ┌──────────────────────────────────────────────────────────────────────────────┐
│   │  🌐 PHỤ THUỘC NGOÀI                                                          │
│   └──────────────────────────────────────────────────────────────────────────────┘
│
│   • Magnific / Freepik API (default base: api.magnific.com)
│     Outbound (POST creator + GET poll):
│       - /v1/ai/video/kling-v3-{pro|std}     + GET /v1/ai/video/kling-v3/{taskId}
│       - /v1/ai/video/kling-4k-t2v           + GET /v1/ai/video/kling-4k-t2v/{taskId}
│       - /v1/ai/video/kling-4k-i2v           + GET /v1/ai/video/kling-4k-i2v/{taskId}
│       - /v1/ai/video/wan-v27-*              + GET status
│       - /v1/ai/improve-prompt               + GET /v1/ai/improve-prompt/{taskId}
│     Inbound (Magnific push delivery → us):
│       - POST {WEBHOOK_BASE_URL}/api/freepik/webhook (Svix-style HMAC, per-key secret)
│   • Cloudflare R2 (env: R2_ACCOUNT_ID, R2_BUCKET, R2_PUBLIC_URL_BASE…) → video mirror, image upload
│   • Supabase Postgres:
│       - production: Vercel prod + preview deploys via transaction pooler
│       - dev/local: .env.local should point to a non-production Supabase DB
│   • Vercel Cron (vercel.json) — daily purge + key healthcheck
│
└── ┌──────────────────────────────────────────────────────────────────────────────┐
    │  🔐 ENV VARS (đã có trên Vercel Production & Preview)                        │
    └──────────────────────────────────────────────────────────────────────────────┘
        DATABASE_URL, ADMIN_PASSWORD, ADMIN_SESSION_SECRET, KEY_ENCRYPTION_SECRET,
        CRON_SECRET, WEBHOOK_BASE_URL (optional),
        R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
        R2_BUCKET, R2_PUBLIC_URL_BASE
```
