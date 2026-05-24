/**
 * SSRF (Server-Side Request Forgery) defense for customer-supplied URLs.
 *
 * Customer can pass `webhook_url` in /v1/* POST bodies. Without checks,
 * a malicious customer could point it at:
 *   - http://localhost:5432 / http://127.0.0.1:6379 — probe co-located
 *     internal services (in case Vercel ever runs a sidecar)
 *   - http://169.254.169.254/  — cloud metadata service (AWS/GCP, not
 *     Vercel today but defense-in-depth against future moves)
 *   - http://10.x.x.x / http://192.168.x.x — internal VPCs
 *   - http://*.internal, *.local, *.lan — internal DNS
 *
 * Strategy: parse `URL.hostname`, classify as "external" (allowed) vs
 * "private/loopback/reserved" (blocked). Pure-function check on the
 * hostname string — works at validate-time (POST) AND delivery-time
 * (fire-and-forget webhook) without doing DNS.
 *
 * Limitation: DNS rebinding (a public hostname that resolves to 127.0.0.1
 * post-validate) is NOT prevented by this hostname check alone. Mitigated
 * by: (a) fetch happens server-side with 10s timeout — narrow window,
 * (b) Vercel functions don't expose meaningful loopback services.
 *
 * If a stronger guard is needed later: do DNS resolution + recheck the
 * resolved IPs before fetch. For now hostname-only is the practical
 * tradeoff (avoids `dns.lookup` import + extra latency per webhook).
 */

/**
 * Hostnames that resolve to "the machine running this code" or to a
 * private network. Case-insensitive match.
 */
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
  "broadcasthost",
]);

/**
 * Suffixes used by internal DNS / mDNS / corporate VPN namespaces.
 * Hostname ending in any of these gets blocked.
 */
const BLOCKED_SUFFIXES = [
  ".local",
  ".internal",
  ".lan",
  ".intranet",
  ".corp",
  ".home",
  ".localhost",
  ".test",
  ".example",
  ".invalid",
];

/** True if hostname is an IPv4 dotted-quad literal like 192.168.1.1. */
function isIPv4Literal(host: string): boolean {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(host);
}

/** True if a parsed IPv4 octet array falls in a private/reserved range. */
function isPrivateIPv4(host: string): boolean {
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true; // malformed — treat as unsafe
  }
  // Length check above + 4 elements means [0]/[1] are guaranteed defined,
  // but TS doesn't narrow tuple destructuring through .length — assert.
  const a = parts[0] as number;
  const b = parts[1] as number;
  // 0.0.0.0/8 — "this network"
  if (a === 0) return true;
  // 10.0.0.0/8 — RFC 1918
  if (a === 10) return true;
  // 100.64.0.0/10 — RFC 6598 carrier-grade NAT
  if (a === 100 && b >= 64 && b <= 127) return true;
  // 127.0.0.0/8 — loopback
  if (a === 127) return true;
  // 169.254.0.0/16 — link-local + cloud metadata 169.254.169.254
  if (a === 169 && b === 254) return true;
  // 172.16.0.0/12 — RFC 1918
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.0.0.0/24 (IETF) + 192.0.2.0/24 (TEST-NET-1) + 192.88.99.0/24 (6to4 relay)
  if (a === 192 && (b === 0 || b === 88)) return true;
  // 192.168.0.0/16 — RFC 1918
  if (a === 192 && b === 168) return true;
  // 198.18.0.0/15 — benchmark
  if (a === 198 && (b === 18 || b === 19)) return true;
  // 198.51.100.0/24, 203.0.113.0/24 — TEST-NET-2/3
  if (a === 198 && b === 51) return true;
  if (a === 203 && b === 0) return true;
  // 224.0.0.0/4 — multicast
  if (a >= 224 && a <= 239) return true;
  // 240.0.0.0/4 — reserved + 255.255.255.255 broadcast
  if (a >= 240) return true;
  return false;
}

/** True if hostname is an IPv6 literal (may be bracketed when from URL). */
function isIPv6Literal(host: string): boolean {
  // URL.hostname strips brackets, so check for ':' presence
  return host.includes(":");
}

/**
 * True if an IPv6 literal falls in loopback/link-local/unique-local
 * scope. Conservative — when in doubt, blocks.
 */
function isPrivateIPv6(host: string): boolean {
  const lower = host.toLowerCase();
  // Loopback ::1, unspecified ::
  if (lower === "::1" || lower === "::") return true;
  // IPv4-mapped IPv6 ::ffff:127.0.0.1 — recheck IPv4 portion
  const v4mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(lower);
  if (v4mapped) return isPrivateIPv4(v4mapped[1]!);
  // Link-local fe80::/10
  if (/^fe[89ab]/.test(lower)) return true;
  // Unique-local fc00::/7
  if (/^f[cd]/.test(lower)) return true;
  // Multicast ff00::/8
  if (lower.startsWith("ff")) return true;
  // Discard prefix 100::/64
  if (lower.startsWith("100:")) return true;
  return false;
}

/**
 * Returns true if the URL's hostname points to a loopback, private,
 * link-local, multicast, or reserved address — i.e. SHOULD BE BLOCKED
 * for customer-supplied URLs.
 *
 * Callers should reject the URL (drop the webhook delivery, return
 * 400 at POST validate time) when this returns true.
 */
export function isUnsafeWebhookHost(hostname: string): boolean {
  const host = hostname.toLowerCase().trim();
  if (!host) return true;

  // Empty / whitespace / common loopback aliases
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  if (BLOCKED_SUFFIXES.some((s) => host === s.slice(1) || host.endsWith(s))) {
    return true;
  }

  // IPv6 literal — covers ::1, fe80::*, fc00::/7, ff00::/8, IPv4-mapped
  if (isIPv6Literal(host)) {
    return isPrivateIPv6(host);
  }

  // IPv4 literal — covers 127.x, 10.x, 192.168.x, 169.254.x, etc.
  if (isIPv4Literal(host)) {
    return isPrivateIPv4(host);
  }

  // Hostname (DNS name) — let it through. DNS rebinding caveat is
  // documented at the top of this module.
  return false;
}

/**
 * One-stop validate: parses the URL, enforces http/https scheme, then
 * runs the hostname check. Returns `null` on any failure (caller treats
 * the same as "no webhook url supplied"); returns the trimmed URL
 * string on success.
 *
 * Used by:
 *   - POST routes via extractCustomerWebhookUrl() — reject at request time
 *   - fireCustomerWebhook delivery — defense in depth (in case the row
 *     was inserted before this guard existed, or via SQL bypass)
 */
export function validateCustomerWebhookUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  const trimmed = raw.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (isUnsafeWebhookHost(parsed.hostname)) return null;
  return trimmed;
}
