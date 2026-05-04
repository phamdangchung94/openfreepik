# Full System Test Plan — 2026-05-04

> Manual checklist + automated checks for end-to-end verification of OpenFreepik
> after the today-batch of changes (download proxy, Excel import, multi-copy,
> region move to sin1, schema migration 0002, etc).

Production URL: <https://freepik.io.vn>
Latest commit: `d50958c` (sin1 region, Hobby plan, fluid functions)

---

## Phần A — Đã chạy tự động (tôi đã verify)

| Check | Trạng thái |
|-------|-----------|
| TypeScript compile | ✅ Clean |
| 17 API routes — health probe | ✅ Tất cả trả 200/401/405 đúng (không có 500) |
| Vercel deploy | ✅ Ready, region sin1, Node 24.14.1 |
| DB schema migration 0002 | ✅ Apply (cột `video_url_expires_at` có) |
| DB connection từ sin1 | ✅ ~700ms (chấp nhận được, sẽ giảm khi Neon edge) |
| Domain aliases | ✅ `freepik.io.vn` + `openfreepik.vercel.app` |

---

## Phần B — Manual checklist (bạn chạy)

### B1. Customer single-video flow

- [ ] Vào `https://freepik.io.vn`, không có activation code → onboarding hiện ra
- [ ] Nhập mã kích hoạt → toast "Xin chào, X" + balance hiện ở header
- [ ] Mode "Văn bản → Video", nhập prompt → click **"Tạo Video"** → toast "Đã bắt đầu tạo video" + Preview hiện loading
- [ ] Đợi ~30-60s → Preview hiện video player + nút "Tải về" + countdown "Còn 23h…"
- [ ] Click "Tải về" → file `.mp4` về máy (filename dạng `<prompt15>_kling-pro_<date>.mp4`)
- [ ] Mở file trên máy → video play OK
- [ ] Click "Tải về" lần 2 → label đổi thành "Tải lại" + file thứ 2 về máy

### B2. Image-to-video

- [ ] Mode "Ảnh → Video" → upload 1 ảnh → nhập prompt → Tạo Video
- [ ] Đợi xong → tải về xem có dùng ảnh start frame chưa

### B3. Multi-copy (tính năng mới)

- [ ] Single-prompt mode (KHÔNG batch), nhập 1 prompt
- [ ] Trong field **"Số bản sao"** gõ `3` → button đổi thành "Tạo 3 Video"
- [ ] Cost preview = 3 × giá đơn
- [ ] Click → 3 task hiện trong History + widget góc dưới phải tracking
- [ ] Bấm **"Huỷ batch"** giữa chừng → các task chưa xong chuyển thành "Đã huỷ"
- [ ] Bấm **"Thử lại N video lỗi"** → các task fail re-queue
- [ ] Test gõ `100` → button "Tạo 100 Video" — nếu balance đủ thì chạy được
- [ ] Test gõ `0` → clamp về 1; test `999` → clamp về 100

### B4. Batch via textarea

- [ ] Bấm "Batch (nhiều prompt) →" trong t2v mode
- [ ] Tab "Dán prompt" → dán 5 dòng prompt
- [ ] Click "Tạo 5 Video" → widget hiện "5 đang chạy / 0 trong hàng chờ"
- [ ] Set concurrency = 2 → resubmit 10 prompts → widget hiện "2 đang chạy / 8 trong hàng chờ"

### B5. Batch via Excel

- [ ] Tạo file `.xlsx` với cột `STT | Prompt`, ~10 dòng
- [ ] Tab "Tải Excel/CSV" → kéo thả file
- [ ] Preview hiện ALL rows + nút 🗑 mỗi dòng
- [ ] Click 🗑 → dòng đó biến mất, count update
- [ ] Click "Bỏ hết" → tất cả về 0
- [ ] Upload lại + click "Tạo N Video" → batch chạy

### B6. Cross-device history

- [ ] Tạo 2-3 video trên Chrome
- [ ] Mở Firefox / private window → nhập **cùng activation code**
- [ ] History tự xuất hiện các video đã tạo (qua /api/usage hydration)
- [ ] Click "Tải về" trên Firefox → tải được (qua URL fallback từ DB)

### B7. Download bulk

- [ ] Trong History có ≥3 video → click icon checkbox bên cạnh tiêu đề "Lịch sử"
- [ ] Selection mode bật → các video chưa tải tự tick sẵn
- [ ] Click "Tải N video" → tải tuần tự, toast progress "Đang tải 3/N..."
- [ ] Sau khi xong → các video tích "✓ Đã tải"

### B8. Cancel batch

- [ ] Tạo batch 10 video
- [ ] Khi 3 đang chạy → click "Huỷ batch" trong widget
- [ ] Preview Panel của task active phải đổi từ "Đang tạo" → "Đã huỷ" (xám, không đỏ)
- [ ] History badge các task: COMPLETED giữ nguyên, IN_PROGRESS / CREATED → "Đã huỷ"

### B9. URL countdown + expiry

- [ ] Tạo 1 video → countdown "Còn 23h…" trong History + Preview
- [ ] Manually edit `videoUrlExpiresAt` trong devtools localStorage về `Date.now() - 1` để giả lập expired
- [ ] Refresh → countdown đổi thành "Hết hạn" (đỏ)
- [ ] Click "Tải về" → toast "Link đã hết hạn"

### B10. Admin dashboard

- [ ] `https://freepik.io.vn/dashboard/login` → đăng nhập password
- [ ] Tab Keys: thấy 2 Freepik keys, balance, last_used
- [ ] Add key mới → encrypt + save OK
- [ ] Toggle inactive → key không pick nữa
- [ ] Tab Codes: issue mã mới với mode/quota/expiry
- [ ] Top-up code → quota tăng đúng
- [ ] Tab Pricing: list rules, edit cost
- [ ] Tab Usage: log full với link video, status, key

### B11. Error handling

- [ ] Activation code sai → "Mã kích hoạt không hợp lệ"
- [ ] Activation code expired → "Mã đã hết hạn"
- [ ] Spam-click "Tạo Video" 10 lần → 429 sau 3 click (rate limit)
- [ ] Spam admin login wrong → 5 lần fail → lockout 15 phút
- [ ] Mất mạng → toast "Lỗi mạng…"

### B12. Mobile

- [ ] Mở `freepik.io.vn` trên iPhone Safari / Android Chrome
- [ ] Toggle "Auto-download" trong header **không hiện** (mobile gate)
- [ ] Layout 1 cột, form vẫn submit được
- [ ] Tải video về mobile (qua proxy) — iOS có thể vẫn không lưu file trực tiếp; cần test

---

## Phần C — Performance load test (tuỳ chọn)

- [ ] **100-prompt batch**: upload Excel 100 dòng, concurrency 5 → đo:
  - Memory tab DevTools peak (target < 1GB)
  - Vercel function logs có 429 không
  - Thời gian hoàn thành (target ~30 phút @ 5 concurrent × 60s/video)
  - Browser tab background → polling vẫn chạy (visibility hook)
- [ ] **Stress concurrency=10**: xem có hit Freepik rate limit không → key rotation kích hoạt

---

## Phần D — Self-checks tôi vẫn chưa làm được

| Check | Cần | Lý do |
|-------|-----|-------|
| Pricing accuracy | Bạn so sánh 1 video Pro 5s ở app vs Freepik dashboard | Cần Freepik dashboard access |
| Concurrent charge race | Script `Promise.all` 100 chargeCode | Cần activation code thật |
| Key rotation under exhaustion | Drain 1 key xuống 0 EUR | Cần admin dashboard |
| Customer label PII (GDPR) | Audit `customer_label` xem có lưu email hợp lý không | Bạn quyết định policy |
| Vercel function logs | Real-time observe khi user gen | Cần dashboard access |

---

## Phần E — Improvement roadmap (xem chi tiết bên dưới)

Sau khi bạn pass checklist B+C, mời chuyển sang **`improvement-roadmap-260504.md`** để chọn phase tiếp theo.
