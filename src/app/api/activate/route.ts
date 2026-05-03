import { NextResponse } from "next/server";
import { z } from "zod";
import { validateCode } from "@/lib/auth/activation";
import { parseJsonBody } from "@/lib/freepik/route-helpers";

const activateBodySchema = z.object({
  code: z.string().min(8).max(256),
});

/**
 * POST /api/activate
 * Body: { code: string }
 *
 * Validates an activation code and returns its current metadata
 * (label, mode, balance). The client uses this to confirm the code
 * works before storing it in localStorage and using it as a bearer
 * token for downstream Freepik calls.
 *
 * Does NOT charge anything — this is a pure read.
 */
export async function POST(request: Request) {
  const body = await parseJsonBody(request);
  const parsed = activateBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "BAD_REQUEST", message: "Invalid code format." },
      { status: 400 },
    );
  }

  const result = await validateCode(parsed.data.code);

  if (!result.ok) {
    const message =
      result.reason === "not_found"
        ? "Activation code not found."
        : result.reason === "inactive"
          ? "Activation code has been revoked."
          : "Activation code has expired.";
    return NextResponse.json(
      { ok: false, error: result.reason, message },
      { status: 401 },
    );
  }

  const { metadata } = result;
  return NextResponse.json({
    ok: true,
    metadata: {
      label: metadata.label,
      mode: metadata.mode,
      quotaEur: metadata.quotaEur,
      usedEur: metadata.usedEur,
      remainingEur: metadata.remainingEur,
      expiresAt: metadata.expiresAt?.toISOString() ?? null,
    },
  });
}
