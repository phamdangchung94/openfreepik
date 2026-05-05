/**
 * Diagnose which Magnific/Freepik endpoint accepts a given API key.
 *
 * Tests one plaintext key against BOTH:
 *   - https://api.freepik.com  (header: x-freepik-api-key)
 *   - https://api.magnific.com (header: x-magnific-api-key)
 *
 * Why: Freepik acquired Magnific in 2024 — both hosts respond at the
 * same path (/v1/ai/video/kling-v3-std), but it's unclear whether keys
 * issued by Magnific work at api.freepik.com (and vice versa). Run
 * this script with each suspect key to find out.
 *
 * Usage:
 *   pnpm tsx scripts/test-key-endpoints.ts <PLAINTEXT_KEY>
 *
 * Or via env:
 *   FREEPIK_API_KEY=FPSX... pnpm tsx scripts/test-key-endpoints.ts
 *
 * Reads HTTP status + first 200 chars of response body. Does NOT
 * actually create a task — sends an intentionally minimal POST so any
 * 200 means the endpoint accepted the key (with a 200/400 still
 * proving auth worked, just bad params). 401 = key rejected here.
 */

const ENDPOINTS = [
  {
    name: "Freepik   ",
    host: "https://api.freepik.com",
    header: "x-freepik-api-key",
  },
  {
    name: "Magnific  ",
    host: "https://api.magnific.com",
    header: "x-magnific-api-key",
  },
] as const;

const PATH = "/v1/ai/video/kling-v3-std";

// Minimal body: required field present so 401/403 are auth-related,
// not "missing required field" 400s.
const PROBE_BODY = JSON.stringify({ prompt: "test probe", duration: "5" });

function mask(key: string): string {
  if (key.length < 12) return "***";
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}

function classify(status: number): string {
  if (status === 200) return "✓ AUTH OK + accepted (created task)";
  if (status === 400) return "✓ AUTH OK (400 = bad params, but key valid)";
  if (status === 401) return "✗ KEY REJECTED here";
  if (status === 402) return "~ AUTH OK but account out of credit";
  if (status === 403) return "~ AUTH OK but request refused (plan limit / suspended)";
  if (status === 404) return "✗ ENDPOINT/PATH not found";
  if (status === 429) return "~ AUTH OK but rate-limited";
  if (status >= 500) return "? UPSTREAM DOWN — try again later";
  return `? HTTP ${status}`;
}

async function probe(
  endpoint: (typeof ENDPOINTS)[number],
  apiKey: string,
): Promise<{ status: number; bodySnippet: string; ms: number }> {
  const start = Date.now();
  try {
    const res = await fetch(endpoint.host + PATH, {
      method: "POST",
      headers: {
        [endpoint.header]: apiKey,
        "Content-Type": "application/json",
      },
      body: PROBE_BODY,
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    return {
      status: res.status,
      bodySnippet: text.slice(0, 200).replace(/\s+/g, " "),
      ms: Date.now() - start,
    };
  } catch (err) {
    return {
      status: 0,
      bodySnippet: `NETWORK: ${err instanceof Error ? err.message : String(err)}`,
      ms: Date.now() - start,
    };
  }
}

async function main() {
  const apiKey = process.argv[2] ?? process.env.FREEPIK_API_KEY;
  if (!apiKey) {
    console.error("Usage: pnpm tsx scripts/test-key-endpoints.ts <PLAINTEXT_KEY>");
    console.error("   or: FREEPIK_API_KEY=FPSX... pnpm tsx scripts/test-key-endpoints.ts");
    process.exit(1);
  }

  console.log(`\nTesting key: ${mask(apiKey)} (length=${apiKey.length})`);
  console.log(`Path:        ${PATH}`);
  console.log(`Body:        ${PROBE_BODY}\n`);
  console.log("─".repeat(72));

  for (const ep of ENDPOINTS) {
    const r = await probe(ep, apiKey);
    const code = r.status === 0 ? "ERR" : String(r.status).padStart(3);
    console.log(
      `${ep.name} ${ep.host.padEnd(28)} → ${code}  ${classify(r.status)} (${r.ms}ms)`,
    );
    if (r.bodySnippet) {
      console.log(`           body: ${r.bodySnippet}`);
    }
  }

  console.log("─".repeat(72));
  console.log("\nInterpretation:");
  console.log("  ✓ at one host only       → that's the right endpoint for this key");
  console.log("  ✓ at both                → keys are interchangeable");
  console.log("  ✗ at both                → key is genuinely invalid (typo / revoked)");
  console.log("  404 at one               → that host doesn't serve this path\n");
}

main();
