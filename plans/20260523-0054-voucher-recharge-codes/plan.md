# Plan — Voucher / Mã nạp tiền

Single-use top-up codes (denominations 100k/200k/500k VND → +100/200/500
EUR to activation code's `quotaEur`). Admin bulk-mints, customer enters
on homepage to increase balance.

## Confirmed decisions

| Topic | Decision |
|---|---|
| Denominations | 100k VND → 100 EUR, 200k VND → 200 EUR, 500k VND → 500 EUR (1k VND ≈ 1 EUR credit) |
| Expiry | Voucher chưa redeem KHÔNG hết hạn |
| Single-use | Yes — `redeemed_at` + `redeemed_by_code_id` |
| Format | `CODE-100-X4K9MPQR` (uppercase, exclude O/0/I/l/1, 8 random chars) |
| Anti-bruteforce | Generic "Mã không hợp lệ" + rate limit redemption endpoint |
| Unlimited/revoked/expired activation code | Reject with "Code đã dùng/đã hết hạn" |
| Distribution | Manual — admin mints → gửi Zalo cho khách |
| Concurrency | Atomic UPDATE ... WHERE redeemed_at IS NULL |
| Telegram alert | Defer (sau khi bot infra sẵn sàng) |
| Payment gateway | Defer (manual flow only) |

## Phases

- **Phase 1 — Backend** (migration + schema + lib + 5 API routes + tests). See [phase-01-backend.md](./phase-01-backend.md).
- **Phase 2 — Admin UI** (`/dashboard/vouchers` page + bulk dialog + stats). See [phase-02-admin-ui.md](./phase-02-admin-ui.md).
- **Phase 3 — Customer UI** (Claim Code form + balance refresh + history). See [phase-03-customer-ui.md](./phase-03-customer-ui.md).
- **Phase 4 — Docs + deploy**.

## Estimate

| Phase | Effort |
|---|---|
| 1. Backend | 1 day |
| 2. Admin UI | 0.5 day |
| 3. Customer UI | 0.5 day |
| 4. Docs + deploy | 0.5 day |
| **Total** | ~2.5 days |

## Rollback

- Migration 0015 ADD TABLE only — drop with `DROP TABLE vouchers` if rollback
- All new files; no existing logic touched
- Customer "Claim Code" form gated behind activation code state → hide via 1 prop if needed
