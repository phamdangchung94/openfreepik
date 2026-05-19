import { NextResponse } from "next/server";
import { extractApiKey, validateApiKey } from "@/lib/auth/api-key";

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
 *   401 { ok: false, error: "AUTH" }
 */
export async function GET(request: Request) {
  const apiKey = extractApiKey(request);
  if (!apiKey) {
    return NextResponse.json(
      {
        ok: false,
        error: "AUTH",
        message:
          "Missing Authorization header. Send `Authorization: Bearer sk_...` with your API key.",
      },
      { status: 401 },
    );
  }

  const result = await validateApiKey(apiKey);
  if (!result.ok) {
    const messages: Record<string, string> = {
      not_found: "Invalid API key.",
      inactive: "API key has been revoked.",
      expired: "API key has expired.",
      code_invalid:
        "API key valid but the linked account is inactive/expired. Contact support.",
    };
    return NextResponse.json(
      { ok: false, error: "AUTH", message: messages[result.reason] },
      { status: 401 },
    );
  }

  const m = result.metadata;
  return NextResponse.json({
    ok: true,
    key: {
      id: result.apiKeyId,
      label: result.apiKeyLabel,
      rateLimitPerMin: result.rateLimitPerMin,
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
  });
}
