/**
 * Verify a Magnific webhook signature.
 *
 * Magnific follows the Svix webhook convention:
 *   headers:
 *     webhook-id          unique id for the delivery
 *     webhook-timestamp   unix seconds when sent (used for replay window)
 *     webhook-signature   `v1,<base64-hmac>` (may carry multiple versions
 *                         space-separated, e.g. `v1,a v2,b`)
 *
 *   signed payload:
 *     `${id}.${timestamp}.${raw-body}`
 *
 *   algorithm:
 *     HMAC-SHA256 with the per-key webhook secret, base64-encoded.
 *
 * The secret can show up in three formats across providers:
 *   - raw UTF-8 (Python `secret.encode()`)
 *   - hex-decoded bytes (32 hex chars → 16 bytes)
 *   - base64-decoded bytes (Svix's canonical `whsec_<base64>` form)
 *
 * We try all three and accept the first match. Constant-time compare
 * on each candidate to avoid timing side channels leaking which
 * encoding was used.
 *
 * Replay window: reject if abs(now - timestamp) > 5 minutes. Magnific
 * doesn't document a retry policy, so we mirror Svix's 5-min tolerance.
 */

const REPLAY_WINDOW_MS = 5 * 60_000;

/** Parse hex (must be even length) → bytes. Returns null if invalid. */
function hexDecode(s: string): Uint8Array | null {
  if (s.length === 0 || s.length % 2 !== 0) return null;
  if (!/^[0-9a-f]+$/i.test(s)) return null;
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Parse Svix-style base64 (URL-safe or standard). Returns null on error. */
function base64Decode(s: string): Uint8Array | null {
  try {
    const padded = s + "=".repeat((4 - (s.length % 4)) % 4);
    const std = padded.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(std);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < out.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** Candidate byte sequences for the HMAC key, ranked most likely first. */
function secretCandidates(
  secret: string,
): { encoding: string; bytes: Uint8Array }[] {
  const stripped = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  const candidates: { encoding: string; bytes: Uint8Array }[] = [];
  // 1. Try as raw UTF-8 (Magnific Python docs show secret.encode()).
  candidates.push({
    encoding: "utf8",
    bytes: new TextEncoder().encode(stripped),
  });
  // 2. Try as Svix-style base64 (canonical whsec_ format).
  const b64 = base64Decode(stripped);
  if (b64) candidates.push({ encoding: "base64", bytes: b64 });
  // 3. Try as hex (the form Magnific actually surfaces to admins today).
  const hex = hexDecode(stripped);
  if (hex) candidates.push({ encoding: "hex", bytes: hex });
  // 4. Try original secret WITHOUT whsec_ strip (in case Magnific signs
  //    the whole "whsec_..." string as raw UTF-8 against itself).
  if (stripped !== secret) {
    candidates.push({
      encoding: "utf8-with-prefix",
      bytes: new TextEncoder().encode(secret),
    });
  }
  return candidates;
}

async function hmacBase64(keyBytes: Uint8Array, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message) as BufferSource,
  );
  let binary = "";
  const bytes = new Uint8Array(sig);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

export interface VerifyOpts {
  /** Raw request body — must be the bytes as sent, NOT re-stringified. */
  rawBody: string;
  webhookId: string;
  webhookTimestamp: string;
  webhookSignature: string;
  secret: string;
}

export type VerifyResult =
  | { ok: true }
  | {
      ok: false;
      reason: "bad_timestamp" | "stale" | "no_signature" | "mismatch";
      /**
       * Diagnostic prefixes — only populated for "mismatch". Each entry
       * shows the first 12 chars of the candidate's computed signature
       * paired with the encoding that produced it. Safe to log; the
       * full HMAC isn't exposed and 12 base64 chars (≈9 bytes) doesn't
       * leak enough to reverse the secret.
       */
      computedSigs?: { encoding: string; sigPrefix: string }[];
      receivedSigPrefixes?: string[];
      signedPayloadLen?: number;
    };

export async function verifyMagnificWebhook(opts: VerifyOpts): Promise<VerifyResult> {
  // Reject obviously-stale or future-skewed deliveries to bound the
  // replay-attack window. Magnific timestamps are unix seconds.
  const tsSec = Number(opts.webhookTimestamp);
  if (!Number.isFinite(tsSec)) return { ok: false, reason: "bad_timestamp" };
  const deltaMs = Math.abs(Date.now() - tsSec * 1000);
  if (deltaMs > REPLAY_WINDOW_MS) return { ok: false, reason: "stale" };

  // Pull v1 signatures from the (potentially multi-version) header.
  // Format: `v1,sig1 v1,sig2 v2,sig3` — accept any v1 match. Unknown
  // versions are ignored rather than fatal so a future v2 rollout
  // doesn't break existing receivers.
  const v1Sigs = opts.webhookSignature
    .split(" ")
    .map((p) => p.trim())
    .filter((p) => p.toLowerCase().startsWith("v1,"))
    .map((p) => p.slice(3));
  if (v1Sigs.length === 0) return { ok: false, reason: "no_signature" };

  // Try multiple payload formats — docs only mention {id}.{ts}.{body}
  // but other webhook providers sign just {ts}.{body} or just {body}.
  // We accept any combination of (encoding × payload-format × v1-sig)
  // so a quirky upstream still verifies.
  const payloadFormats = [
    { name: "id.ts.body", value: `${opts.webhookId}.${opts.webhookTimestamp}.${opts.rawBody}` },
    { name: "ts.body", value: `${opts.webhookTimestamp}.${opts.rawBody}` },
    { name: "body", value: opts.rawBody },
  ];

  // Collect diagnostic prefixes for the {id}.{ts}.{body} default so the
  // route can log them on mismatch; other formats just match-or-not.
  const computedSigs: { encoding: string; sigPrefix: string }[] = [];

  for (const candidate of secretCandidates(opts.secret)) {
    for (const payload of payloadFormats) {
      const expected = await hmacBase64(candidate.bytes, payload.value);
      if (payload.name === "id.ts.body") {
        computedSigs.push({
          encoding: candidate.encoding,
          sigPrefix: expected.slice(0, 12),
        });
      }
      for (const sig of v1Sigs) {
        if (timingSafeEqual(expected, sig)) return { ok: true };
      }
    }
  }

  return {
    ok: false,
    reason: "mismatch",
    computedSigs,
    receivedSigPrefixes: v1Sigs.map((s) => s.slice(0, 12)),
    signedPayloadLen: payloadFormats[0]!.value.length,
  };
}
