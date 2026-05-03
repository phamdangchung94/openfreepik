# Plan — Chuyển tool sang SaaS với Activation Code + Multi-Key Pool

## Context

Hiện tại tool yêu cầu customer tự nhập Freepik API key vào browser → key sống trên máy customer, mỗi customer phải tự đăng ký Freepik account. Mục tiêu mới:

- **Bạn** quản lý nhiều Freepik API key (mỗi key có 500 EUR free credit)
- **Customer** không bao giờ thấy Freepik key — chỉ nhập **activation code** dài (do bạn cấp)
- Tool vẫn deploy **Cách A — pure SaaS** trên Vercel (Next.js API routes làm proxy, không cần proxy server riêng)
- DB: **Neon** (lưu code, key, usage logs, pricing — KHÔNG lưu ảnh/video; URL Freepik trả về client để customer download trực tiếp)
- 3 chế độ activation: `unlimited` / `quota` (cap EUR) / `topup` (balance pay-as-you-go)
- Tự động xoay vòng key khi 1 key Freepik hết quota
- Pricing matrix: tier × duration × audio (admin edit được)
- Thêm tính năng: **batch T2V** (100 prompts, concurrency 3), **auto-download** (toggle có cảnh báo), **dashboard** customer + admin

**Out of scope** (làm sau nếu cần): rate limiting per code, Stripe/payment integration, email notifications, multi-tenant key sharing across orgs.

---

## Architecture overview

```
┌──────────────────────────────────────────────────────────┐
│  Customer browser — yourapp.vercel.app                   │
│  • Nhập activation code (long random string)             │
│  • Toggle auto-download                                  │
│  • Generate single / batch T2V / batch I2V               │
│  • Xem balance + usage panel của chính mình              │
└────────────────────┬─────────────────────────────────────┘
                     │ Authorization: Bearer <activation-code>
                     ▼
┌──────────────────────────────────────────────────────────┐
│  Vercel — Next.js API routes (= proxy)                   │
│  • Validate code → check balance                         │
│  • pickFreepikKey() từ pool theo round-robin/LRU         │
│  • Calculate cost từ pricing rules                       │
│  • Charge code (atomic UPDATE)                           │
│  • Forward sang Freepik với key thật                     │
│  • Log usage row                                         │
│  • On 402 → mark key exhausted, refund, retry next key   │
└────────────────────┬─────────────────────────────────────┘
                     ▼
            ┌───────────────────┐         ┌──────────────┐
            │  Neon Postgres    │         │  Freepik API │
            │  • freepik_keys   │         │  (real key)  │
            │  • activation_    │         └──────────────┘
            │    codes          │
            │  • usage_logs     │
            │  • pricing_rules  │
            └───────────────────┘
                     ▲
                     │ Admin: yourapp.vercel.app/dashboard
                     │ (password gate)
                     │ • CRUD codes & keys
                     │ • Edit pricing
                     │ • View all usage
                     │ • Total EUR spent across keys
                     └────────────────────────────────────
```

**Lưu ý DB không lưu media:** `usage_logs.video_url` chỉ lưu URL Freepik trả về (string). Customer browser tự download từ URL đó. Nếu URL Freepik expire (thường 24-72h) → customer mất link. Document rõ điều này cho customer.

---

## Database schema (Neon Postgres + Drizzle ORM)

```ts
// src/lib/db/schema.ts (rút gọn)

freepik_keys {
  id              uuid PK
  label           text          // "Account 1 - tom@example.com"
  key_encrypted   text          // AES-GCM(KEY_ENCRYPTION_SECRET)
  assigned_eur    numeric(10,2) // 500.00 (default)
  used_eur        numeric(10,2) // tăng dần
  is_active       boolean       // false khi exhausted
  notes           text
  created_at      timestamptz
  last_used_at    timestamptz
}

activation_codes {
  id              uuid PK
  code            text UNIQUE   // 32+ char random base32 (vd "FREEPIK-XXXX-XXXX-XXXX-XXXX")
  customer_label  text          // "Khách A - email"
  mode            text          // "unlimited" | "quota" | "topup"
  quota_eur       numeric(10,2) // null nếu unlimited; tổng cap nếu quota; current balance nếu topup
  used_eur        numeric(10,2) // tổng đã dùng
  is_active       boolean
  created_at      timestamptz
  expires_at      timestamptz   // optional
}

usage_logs {
  id                uuid PK
  code_id           uuid FK → activation_codes.id
  key_id            uuid FK → freepik_keys.id
  endpoint          text          // "kling-v3" | "improve-prompt"
  tier              text          // "pro" | "std" | null
  duration_seconds  smallint
  with_audio        boolean
  cost_eur          numeric(10,2)
  freepik_task_id   text
  video_url         text          // Freepik URL (expire ~72h)
  status            text          // "succeeded" | "failed" | "refunded"
  created_at        timestamptz
}

pricing_rules {
  id                uuid PK
  endpoint          text          // "kling-v3"
  tier              text          // "pro" | "std"
  duration_seconds  smallint      // 5, 10, ...
  with_audio        boolean
  cost_eur          numeric(10,2)
  updated_at        timestamptz
  // UNIQUE(endpoint, tier, duration_seconds, with_audio)
}

admin_sessions {
  token_hash      text PK         // SHA-256 của session token
  expires_at      timestamptz
  created_at      timestamptz
}
```

**Atomic charging** (race-safe):
```sql
UPDATE activation_codes
SET used_eur = used_eur + $cost
WHERE id = $codeId
  AND is_active
  AND (mode = 'unlimited' OR (quota_eur - used_eur) >= $cost)
RETURNING used_eur, quota_eur, mode;
-- 0 rows → insufficient balance / inactive → reject
```

---

## Implementation phases

| # | Phase | Effort | Risk |
|---|-------|--------|------|
| 1 | DB setup (Neon + Drizzle + schema + migrations) | 1d | Low |
| 2 | Activation code system (server + client) | 1d | Low |
| 3 | Multi-key pool + rotation + AES encryption | 1d | Med (race) |
| 4 | Pricing table + cost calculator | 0.5d | Low |
| 5 | Refactor existing API routes (charge + retry on 402) | 1d | Med |
| 6 | Client UI: thay api-key input → activation code, balance display | 1d | Low |
| 7 | Customer usage panel (own stats) | 0.5d | Low |
| 8 | Batch T2V mode (100 prompts, concurrency 3) | 1.5d | Med |
| 9 | Auto-download toggle + warning + File System Access | 0.5d | Low |
| 10 | Admin dashboard (codes, keys, pricing, usage) | 2-3d | Med |
| 11 | Vercel deploy + env vars + smoke test | 0.5d | Low |

**Total: ~11-13 ngày** dev một mình.

---

## Phase 1 — DB setup

**Tasks:**
1. Tạo Neon project, lấy `DATABASE_URL` (pooled connection cho Vercel)
2. `pnpm add drizzle-orm @neondatabase/serverless` + `pnpm add -D drizzle-kit`
3. Tạo `drizzle.config.ts` (dialect: postgresql, schema path)
4. Tạo `src/lib/db/schema.ts` (4 tables như trên)
5. Tạo `src/lib/db/client.ts`:
   ```ts
   import { neon } from "@neondatabase/serverless";
   import { drizzle } from "drizzle-orm/neon-http";
   const sql = neon(process.env.DATABASE_URL!);
   export const db = drizzle(sql, { schema });
   ```
6. Generate + apply migration: `pnpm drizzle-kit generate` → `pnpm drizzle-kit push`
7. Seed pricing rules với Freepik public defaults (script `scripts/seed-pricing.ts`)

**Env vars mới:**
- `DATABASE_URL` (Neon pooled)
- `KEY_ENCRYPTION_SECRET` (32 bytes base64, dùng cho AES-GCM)

**Files:** `drizzle.config.ts`, `src/lib/db/schema.ts`, `src/lib/db/client.ts`, `drizzle/migrations/0001_init.sql`, `scripts/seed-pricing.ts`

---

## Phase 2 — Activation code system

**Server side:**
- `src/lib/auth/activation.ts`:
  - `validateCode(code: string)` → `{ valid, codeId, mode, balanceRemaining, label }`
  - `chargeCode(codeId, costEur)` → atomic UPDATE (như SQL ở trên)
  - `refundCode(codeId, costEur)` → đảo ngược khi Freepik fail
- `src/app/api/activate/route.ts` POST:
  - Body: `{ code }` → trả `{ valid, mode, balance, label }` hoặc 401
  - Không issue JWT — code **chính là** bearer token (đơn giản hoá; revoke = set is_active=false)

**Client side:**
- Đổi `useAuthStore` từ `apiKey` → `activationCode`
- `getApiHeaders()` gửi `Authorization: Bearer <code>` thay cho `x-api-key`
- Component mới `src/components/layout/activation-code-input.tsx` (thay `api-key-input.tsx`):
  - Input nhập code
  - Button "Activate" → POST `/api/activate`
  - Nếu valid → lưu code vào localStorage qua `useAuthStore`, hiển thị balance + label
  - Nếu invalid → toast error
  - Hiển thị: `[Khách A] · 23.50 / 200.00 EUR · [Logout]`

**Files:** `src/lib/auth/activation.ts`, `src/app/api/activate/route.ts`, `src/components/layout/activation-code-input.tsx`

---

## Phase 3 — Multi-key pool + rotation

**Encryption:**
- `src/lib/crypto/aes-gcm.ts`: `encrypt(plaintext, secret)` / `decrypt(ciphertext, secret)` dùng `crypto.subtle` Web API (chạy được trên Vercel edge).

**Key pool:**
- `src/lib/freepik/key-pool.ts`:
  - `pickActiveKey(estimatedCostEur): Promise<{ id, decryptedKey } | null>`
    ```sql
    SELECT id, key_encrypted FROM freepik_keys
    WHERE is_active AND (assigned_eur - used_eur) >= $estimatedCost
    ORDER BY last_used_at ASC NULLS FIRST
    LIMIT 1;
    ```
    + UPDATE `last_used_at = now()` cùng transaction
  - `markKeyExhausted(keyId)` → `UPDATE SET is_active = false`
  - `recordKeyCost(keyId, costEur)` → atomic increment
- `pickActiveKey` lock bằng `FOR UPDATE SKIP LOCKED` để tránh 2 request chọn cùng key cuối cùng.

**Rotation logic** (trong Phase 5 sẽ tích hợp):
```
for attempt in 1..3:
  key = pickActiveKey(estimatedCost)
  if !key: return 503 "All keys exhausted"
  try:
    result = await freepik.call(key.decryptedKey)
    recordKeyCost(key.id, costEur)
    return result
  catch (FreepikApiError code=402 or QUOTA):
    markKeyExhausted(key.id)
    continue  // try next key
  catch (other): throw
return 503
```

**Files:** `src/lib/crypto/aes-gcm.ts`, `src/lib/freepik/key-pool.ts`

---

## Phase 4 — Pricing table + calculator

**Default pricing** (Freepik Kling V3 public, lấy số tròn — admin edit sau):

| Tier | Duration | With audio | Cost EUR |
|------|----------|-----------|----------|
| std  | 5s       | false     | 0.25     |
| std  | 5s       | true      | 0.35     |
| std  | 10s      | false     | 0.50     |
| pro  | 5s       | false     | 0.50     |
| pro  | 5s       | true      | 0.70     |
| pro  | 10s      | false     | 1.00     |
| ... (cho hết duration 3-15s × 2 tier × 2 audio = 52 rows) |

improve-prompt: cost = 0 EUR (free hoặc rất rẻ — không charge)

**Calculator:**
```ts
// src/lib/pricing/calculator.ts
export async function calculateCost(opts: {
  endpoint: "kling-v3";
  tier: "pro" | "std";
  durationSeconds: number;
  withAudio: boolean;
}): Promise<number> {
  const row = await db.select(...).from(pricingRules).where(...).limit(1);
  if (!row) throw new Error("No pricing rule for combination");
  return Number(row.cost_eur);
}
```

**Seed script:** `scripts/seed-pricing.ts` chạy 1 lần khi setup.

**Files:** `src/lib/pricing/calculator.ts`, `scripts/seed-pricing.ts`

---

## Phase 5 — Refactor existing API routes

**`src/app/api/freepik/kling-v3/route.ts` POST flow mới:**

```ts
1. Extract code from Authorization header → validateCode(code)
   nếu invalid → 401
2. Parse body với klingV3RouteInputSchema
3. cost = calculateCost({ tier, durationSeconds: parseInt(params.duration), withAudio: !!params.generate_audio })
4. Charge code: chargeCode(codeId, cost) → 0 rows = 402 "Insufficient balance"
5. Loop max 3 lần:
     key = pickActiveKey(cost)
     nếu null → refund + 503 "All keys exhausted"
     try:
       task = await freepik.klingV3.generate(params, { tier, apiKey: key.decryptedKey })
       insert usage_logs (status=succeeded, cost, key_id, code_id, freepik_task_id, ...)
       recordKeyCost(key.id, cost)
       return { data: task }
     catch QuotaError:
       markKeyExhausted(key.id); continue
     catch other:
       refundCode(codeId, cost)
       insert usage_logs (status=failed)
       throw
6. (sau 3 retries) refund + 503
```

**`/api/freepik/kling-v3/[taskId]/route.ts` GET** (poll status — không charge):
- Validate code (không charge), pick **bất kỳ key active nào** (vì poll API thường không tốn quota), forward request.

**Improve-prompt routes:**
- Validate code, pick key, forward. Cost 0 → không charge.

**Files modified:**
- `src/app/api/freepik/kling-v3/route.ts`
- `src/app/api/freepik/kling-v3/[taskId]/route.ts`
- `src/app/api/freepik/improve-prompt/route.ts`
- `src/app/api/freepik/improve-prompt/[taskId]/route.ts`
- `src/lib/freepik/route-helpers.ts` (đổi `extractApiKey` → `extractActivationCode`)

---

## Phase 6 — Client UI cho activation

**Đổi `useAuthStore`:**
```ts
interface AuthState {
  activationCode: string;       // long string
  metadata: {                   // load từ /api/activate response
    label: string;
    mode: "unlimited" | "quota" | "topup";
    quotaEur: number | null;
    usedEur: number;
  } | null;
  setActivationCode: (code: string) => void;
  refreshMetadata: () => Promise<void>;
  clear: () => void;
}
```

Migration từ legacy `apiKey` localStorage → ignore (breaking change, customer phải nhập code mới).

**`activation-code-input.tsx`** thay thế `api-key-input.tsx`:
- Input field + Activate button
- Sau khi activate: hiển thị `[Khách A] · 23.50 / 200.00 EUR` + Logout button
- Periodically refresh metadata (mỗi 30s) để cập nhật balance khi gen xong

**Files:** `src/store/auth-store.ts` (refactor), `src/components/layout/activation-code-input.tsx`, xóa `api-key-input.tsx`

---

## Phase 7 — Customer usage panel

**API mới `/api/usage` GET:**
- Auth: bearer activation code
- Trả về:
  ```json
  {
    "balance": { "mode": "quota", "used": 23.50, "quota": 200, "remaining": 176.50 },
    "totals": { "videosGenerated": 47, "totalEur": 23.50 },
    "today": { "videos": 5, "eur": 2.50 },
    "recent": [ { "createdAt", "tier", "durationSeconds", "costEur", "videoUrl" }, ... limit 20 ]
  }
  ```

**UI:** thêm tab/card mới ở sidebar phải (hoặc mở dialog từ nav):
- `src/components/usage-panel.tsx`
- Hiển thị progress bar quota, biểu đồ ngày (sparkline đơn giản), bảng 20 video gần nhất với link download

**Files:** `src/app/api/usage/route.ts`, `src/components/usage-panel.tsx`

---

## Phase 8 — Batch T2V mode

**Hiện tại:** chỉ batch I2V (yêu cầu upload nhiều ảnh). Cần thêm batch T2V (paste nhiều prompts).

**UI:**
- Trong `generator-form.tsx`, mode `t2v` thêm UI section `BatchT2VInput`:
  - Toggle "Single / Batch" trong T2V mode
  - Khi Batch: textarea lớn — 1 prompt mỗi dòng, max 100 dòng
  - Counter: "23 / 100 prompts"
  - Concurrency selector (default 3, max 5)
  - Button "Generate All"

**Hook:** Mở rộng `useBatchQueue` để support T2V items (không cần `imageUrl`):
- `BatchItem` schema thêm `mode: "t2v" | "i2v"`, `imageUrl: string | undefined`
- `runTask()` rẽ nhánh: T2V dùng `toApiParams` (no image), I2V dùng `toBatchApiParams`
- Concurrency lấy từ store (default đổi từ 5 → 3)

**Files:** `src/components/generator/batch-t2v-input.tsx` (NEW), `src/hooks/use-batch-queue.ts` (extend), `src/lib/form/generator-schema.ts` (BatchItem schema), `src/lib/form/to-api-params.ts`

---

## Phase 9 — Auto-download

**Store:**
```ts
// src/store/preferences-store.ts (new — tách khỏi auth/task)
interface PrefsState {
  autoDownload: boolean;
  downloadFolderHandle: FileSystemDirectoryHandle | null;  // Chrome only
  setAutoDownload: (v: boolean) => void;
  setDownloadFolder: (h: FileSystemDirectoryHandle | null) => void;
}
```

**Logic:**
- `src/lib/auto-download.ts`:
  - `downloadVideo(url, filename)`:
    - Nếu có `downloadFolderHandle` (Chrome File System Access API): fetch blob → ghi vào folder đã chọn
    - Nếu không: tạo `<a href={url} download={filename}>` → click → browser download tới folder mặc định
- Subscribe vào task-store changes: khi 1 task chuyển `IN_PROGRESS → COMPLETED` và `autoDownload === true` → trigger download
- Filename pattern: `kling-{tier}-{YYYY-MM-DD-HHmm}-{slug(prompt, 40)}.mp4`

**UI toggle component:** `src/components/auto-download-toggle.tsx`
- Switch trên nav bar
- **Lần đầu bật:** mở dialog cảnh báo:
  > **Auto-download bật rồi!**
  > 
  > • Browser sẽ tự download video về folder Downloads (mặc định) khi mỗi video tạo xong.
  > • Mỗi video ~5-30MB. Batch 100 video có thể ngốn 1-3GB.
  > • Trên Chrome desktop, bạn có thể chọn folder cụ thể (button bên dưới).
  > • URL Freepik chỉ tồn tại 24-72h — auto-download giúp không mất video.
  > • Tắt auto-download nếu không muốn lưu mọi video.
  > 
  > [Chọn folder (Chrome)] [OK, hiểu rồi]

**Files:** `src/store/preferences-store.ts`, `src/lib/auto-download.ts`, `src/components/auto-download-toggle.tsx`, `src/components/auto-download-warning-dialog.tsx`

---

## Phase 10 — Admin dashboard

**Auth (đơn giản):**
- Env: `ADMIN_PASSWORD` (plain string, đủ vì 1 admin user duy nhất)
- `/dashboard/login` form: nhập password → `POST /api/admin/login` → server compare → set httpOnly cookie `admin-session=<random-token>`
- Insert vào `admin_sessions` (token_hash, expires_at +24h)
- Middleware `src/middleware.ts`: gate `/dashboard/*` (trừ `/dashboard/login`) bằng cookie validation

**Pages (tất cả trong same project, route group `(admin)/dashboard/*`):**

| Route | Chức năng |
|-------|----------|
| `/dashboard` | Tổng quan: tổng EUR đã dùng, số code active, số key remaining EUR, biểu đồ usage 7 ngày |
| `/dashboard/codes` | Bảng codes: search, filter, click vào edit. Form "Create code" (mode, quota, label) → trả code string copy được |
| `/dashboard/codes/[id]` | Chi tiết code: usage history, balance, revoke button |
| `/dashboard/keys` | Bảng keys: label, used/assigned EUR, status. Form "Add key" (label, key plaintext) → encrypt và lưu |
| `/dashboard/pricing` | Bảng pricing rules, edit inline |
| `/dashboard/usage` | All usage logs, filter by code/date/status, CSV export |

**API endpoints (`/api/admin/*`):** CRUD cho codes, keys, pricing. Validate cookie ở mọi endpoint.

**URL riêng (tuỳ chọn sau):** Vercel cho phép add custom domain — bạn có thể trỏ `admin.openfreepik.com` → cùng project, middleware check hostname để redirect customer routes 404 trên admin domain. Đơn giản nhất ở v1: dùng cùng domain `/dashboard`, password gate là đủ. Subdomain riêng để v2.

**Files (~15-20 files mới):**
- `src/middleware.ts`
- `src/app/(admin)/dashboard/layout.tsx`
- `src/app/(admin)/dashboard/page.tsx`
- `src/app/(admin)/dashboard/codes/page.tsx`
- `src/app/(admin)/dashboard/codes/[id]/page.tsx`
- `src/app/(admin)/dashboard/codes/new/page.tsx`
- `src/app/(admin)/dashboard/keys/page.tsx`
- `src/app/(admin)/dashboard/pricing/page.tsx`
- `src/app/(admin)/dashboard/usage/page.tsx`
- `src/app/(admin)/dashboard/login/page.tsx`
- `src/app/api/admin/login/route.ts`
- `src/app/api/admin/codes/route.ts` + `[id]/route.ts`
- `src/app/api/admin/keys/route.ts` + `[id]/route.ts`
- `src/app/api/admin/pricing/route.ts`
- `src/app/api/admin/usage/route.ts`
- `src/lib/auth/admin.ts`
- `src/components/dashboard/*` (tables, forms, charts)

---

## Phase 11 — Vercel deploy

**Vercel env vars (Production + Preview):**
- `DATABASE_URL` — Neon pooled connection
- `KEY_ENCRYPTION_SECRET` — `openssl rand -base64 32`
- `ADMIN_PASSWORD` — bạn chọn
- `ADMIN_SESSION_SECRET` — `openssl rand -base64 32`

**Pre-deploy:**
1. Run `pnpm drizzle-kit push` (apply migration tới Neon)
2. Run `pnpm tsx scripts/seed-pricing.ts` (seed pricing rules)
3. Add 1-2 Freepik keys qua admin dashboard sau khi deploy
4. Tạo 1 activation code test

**Smoke test sau deploy:**
- [ ] Customer URL: nhập code test → activate OK
- [ ] Generate 1 video std 5s → balance giảm 0.25 EUR
- [ ] Batch T2V 3 prompts → tất cả complete, balance giảm đúng
- [ ] Auto-download: bật → file tải về Downloads folder
- [ ] Admin URL: login → thấy 1 usage log mới
- [ ] Code revoke: revoke code test → customer bị 401 lần generate kế tiếp
- [ ] Key rotation: tạo 1 key fake invalid → verify rotation skip + error log đúng

---

## Critical files reference

**Read for context:**
- `src/lib/freepik/base-client.ts` — HTTP wrapper, không đổi
- `src/lib/freepik/poll-task.ts` — không đổi (vẫn gọi qua `/api/freepik/...`)
- `src/hooks/use-batch-queue.ts` — sẽ extend cho T2V

**Heavy modifications:**
- `src/store/auth-store.ts` — schema thay đổi
- `src/lib/api-headers.ts` — đổi header
- `src/app/api/freepik/**/route.ts` — auth + charge + rotation logic
- `src/lib/freepik/route-helpers.ts` — extract activation code thay vì api key

**Net new files (~30-40 file):** xem từng phase ở trên.

---

## Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Race condition charge code | Atomic UPDATE với WHERE balance_eur >= cost (Postgres handle) |
| Race condition pick key | `FOR UPDATE SKIP LOCKED` |
| Freepik thực tế tốn nhiều hơn pricing table | Admin reconcile thủ công; log Freepik response để verify |
| URL Freepik expire trước khi customer download | Cảnh báo user; auto-download recommended; tương lai có thể cache vào S3/R2 |
| Customer chia sẻ code → drain quota | v1 chấp nhận; v2 thêm rate limit per code (e.g. 100 req/giờ) |
| Vercel function timeout 10s (Hobby) hoặc 60s (Pro) | Generate API trả ngay sau khi POST tới Freepik (không await). Polling từ client side. |
| Migration SQL fail trên prod | Dùng `drizzle-kit push` với confirm prompt; backup Neon trước |
| Lộ KEY_ENCRYPTION_SECRET → leak Freepik keys | Vercel env var encrypted at rest; rotate secret = re-encrypt all keys (provide script) |

---

## Migration impact (cho user hiện tại nếu có)

Đây là **breaking change** — model cũ (customer tự nhập Freepik key) bị xoá. Cần:
- Email/notify existing users (nếu có)
- Cấp activation code cho họ
- Document migration trong README

Nếu chưa có user thực tế → ignore.

---

## Verification

Sau mỗi phase:
- `pnpm typecheck` pass
- `pnpm build` pass
- Phase 1: query DB qua `psql $DATABASE_URL` xác nhận tables tồn tại
- Phase 2-5: dùng `curl` test API routes với code thật
- Phase 6-9: smoke test trong browser
- Phase 10: smoke test admin dashboard với ADMIN_PASSWORD
- Phase 11: full E2E như checklist trên

Không có existing test suite — manual verification là duy nhất ở v1. Sau ổn định có thể setup Vitest cho `lib/auth/`, `lib/pricing/`, `lib/freepik/key-pool/` (logic thuần dễ test).
