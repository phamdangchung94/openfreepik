import { NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth/api-key-helpers";
import { apiSuccess } from "@/lib/api-v1/response";

/**
 * GET /api/v1/me
 *
 * Auth probe — return the API key's owner info + balance. Use this to
 * verify the key works before firing real generation calls.
 *
 * Headers: `Authorization: Bearer sk_xxx...`
 *
 * Response:
 *   200 { ok: true, key: { id, label }, balance: { mode, used, quota, remaining } }
 *   401 { ok: false, error: "AUTH", request_id }
 *
 * All responses include `x-request-id` header for support traceability.
 */
export async function GET(request: Request) {
  const auth = await requireApiKey(request);
  if (auth instanceof NextResponse) return auth;

  const m = auth.metadata;
  return apiSuccess({
    requestId: auth.requestId,
    data: {
      ok: true,
      key: {
        id: auth.apiKeyId,
        label: auth.apiKeyLabel,
        rateLimitPerMin: auth.rateLimitPerMin,
      },
      balance: {
        mode: m.mode,
        label: m.label,
        // Internal accounting stays EUR; expose as `creditsEur` to keep
        // the public field name boring + currency-explicit.
        usedEur: m.usedEur,
        quotaEur: m.quotaEur,
        remainingEur: m.remainingEur,
      },
    },
  });
}
