import { NextResponse } from "next/server";
import { z } from "zod";
import { validateCode } from "@/lib/auth/activation";
import { parseJsonBody } from "@/lib/freepik/route-helpers";
import { checkRateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-ip";

const activateBodySchema = z.object({
  code: z.string().min(8).max(256),
});

// Anti-brute-force: ANY POST to /api/activate counts toward the IP's
// budget — successful or not. 20 attempts per minute is plenty for a
// real user fixing typos but sets a hard ceiling on dictionary attacks.
const ACTIVATE_RATE_LIMIT = 20;
const ACTIVATE_RATE_WINDOW_SEC = 60;

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
  // Throttle by IP first — failures aren't free (they still hit the DB to
  // look up the code). Allow truly anonymous callers (no IP header) to
  // pass through; in practice Vercel always populates x-forwarded-for.
  const ip = getClientIp(request);
  if (ip) {
    const rl = await checkRateLimit({
      resource: "activate",
      scope: ip,
      limit: ACTIVATE_RATE_LIMIT,
      windowSeconds: ACTIVATE_RATE_WINDOW_SEC,
    });
    if (!rl.allowed) {
      return NextResponse.json(
        {
          ok: false,
          error: "RATE_LIMIT",
          message: `Too many attempts. Wait ${rl.retryAfterSeconds}s and retry.`,
        },
        {
          status: 429,
          headers: { "retry-after": String(rl.retryAfterSeconds) },
        },
      );
    }
  }

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
