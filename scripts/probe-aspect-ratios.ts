/**
 * Probe Magnific API to discover which aspect_ratio values it actually
 * accepts. Their docs list 3 (16:9, 9:16, 1:1) but the homepage UI
 * shows 7 (adds 21:9, 4:3, 3:4, 9:21). This script tries each ratio
 * via the kling-v3 POST endpoint with a minimal config.
 *
 * Cost: €0 expected — Magnific validates aspect_ratio before queueing.
 * Rejected ratios return HTTP 400 with no task created → no billing.
 * If ANY accepted ratio sneaks through, we get a task_id back; the
 * script logs it so admin can manually cancel + verify (no auto-poll).
 *
 * Run: pnpm tsx --env-file=.env.local scripts/probe-aspect-ratios.ts
 *
 * Picks a single active key from the pool — needs DB access (DATABASE_URL).
 */

export {};

const RATIOS_TO_TEST = [
  // Already supported per docs (control / sanity check)
  "16:9",
  "9:16",
  "1:1",
  // UI-only candidates from Magnific homepage
  "21:9",
  "4:3",
  "3:4",
  "9:21",
];

interface TestResult {
  ratio: string;
  httpStatus: number;
  accepted: boolean;
  taskId?: string;
  errorCode?: string;
  errorMessage?: string;
}

function getApiKey(): string {
  const k = process.env.MAGNIFIC_PROBE_KEY;
  if (!k) {
    throw new Error(
      "Set MAGNIFIC_PROBE_KEY env var with a Magnific API key.\n" +
        "  Example: MAGNIFIC_PROBE_KEY=mk_xxx pnpm tsx --env-file=.env.local scripts/probe-aspect-ratios.ts",
    );
  }
  return k;
}

async function probe(apiKey: string, ratio: string): Promise<TestResult> {
  const url = "https://api.magnific.com/v1/ai/video/kling-v3-std";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "x-magnific-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt: "a test cat sitting still — probe ratio validation",
      aspect_ratio: ratio,
      duration: "5",
      generate_audio: false,
    }),
  });
  const body = await res.text();
  let parsed: unknown = null;
  try { parsed = JSON.parse(body); } catch {}
  const obj = parsed as Record<string, unknown> | null;

  if (res.ok) {
    const data = obj?.data as Record<string, unknown> | undefined;
    const taskId = (data?.task_id as string | undefined) ?? undefined;
    return { ratio, httpStatus: res.status, accepted: true, taskId };
  }
  return {
    ratio,
    httpStatus: res.status,
    accepted: false,
    errorCode: obj?.code as string | undefined,
    errorMessage: (obj?.message as string | undefined) ?? body.slice(0, 200),
  };
}

async function main() {
  console.log("=== Magnific aspect_ratio probe ===\n");
  const apiKey = getApiKey();
  console.log(`Using key prefix: ${apiKey.slice(0, 6)}...\n`);

  const results: TestResult[] = [];
  for (const ratio of RATIOS_TO_TEST) {
    process.stdout.write(`Testing ${ratio.padEnd(6)} ... `);
    try {
      const r = await probe(apiKey, ratio);
      results.push(r);
      if (r.accepted) {
        console.log(`✅ ACCEPTED (task_id=${r.taskId ?? "?"})`);
      } else {
        console.log(`❌ ${r.httpStatus} ${r.errorCode ?? ""} — ${r.errorMessage ?? ""}`);
      }
    } catch (err) {
      console.log(`💥 ${err instanceof Error ? err.message : String(err)}`);
    }
    // Tiny delay so we don't accidentally hammer rate limit while probing
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log("\n=== Summary ===");
  const accepted = results.filter((r) => r.accepted);
  const rejected = results.filter((r) => !r.accepted);
  console.log(`Accepted: ${accepted.map((r) => r.ratio).join(", ") || "(none)"}`);
  console.log(`Rejected: ${rejected.map((r) => r.ratio).join(", ") || "(none)"}`);

  if (accepted.some((r) => r.taskId)) {
    console.log("\n⚠️  Some probes created REAL tasks. task_ids:");
    for (const r of accepted) {
      if (r.taskId) console.log(`  - ${r.ratio}: ${r.taskId}`);
    }
    console.log("These will run + cost EUR. Cancel via Magnific dashboard if you don't want them.");
  }
}

main().catch((err) => {
  console.error("probe failed:", err);
  process.exit(1);
});
