/**
 * End-to-end smoke test for Kling 3 Omni against PRODUCTION.
 *
 * Submits a small T2V task, polls until terminal, prints the result.
 * Total cost: ~840 đ (5s × Std no-audio) — billed to the activation
 * code passed via env.
 *
 * Usage:
 *   OMNI_TEST_CODE=<activation-code> \
 *   OMNI_TEST_TIER=omni-std \              # omni-std | omni-pro | omni-ref-std | omni-ref-pro
 *   OMNI_TEST_BASE=https://video.chugax.io.vn \
 *     pnpm tsx --env-file=.env.local scripts/test-omni-e2e.ts
 *
 * Env defaults: tier=omni-std, base=https://video.chugax.io.vn.
 *
 * What it verifies:
 *   - POST schema accepted (no 400 on body shape)
 *   - Orchestrator + pricing wire correctly (no 503 PRICING_MISSING)
 *   - Pool picks an active key (no 503 NO_KEYS_AVAILABLE)
 *   - Magnific accepts our endpoint URL + body (no upstream 400/404)
 *   - Polling round-trips (no GET 404 like motion v2-6 quirk)
 *   - Finalize → status=COMPLETED + videoUrl returned
 */

export {};

const code = process.env.OMNI_TEST_CODE;
const tier = process.env.OMNI_TEST_TIER ?? "omni-std";
const base = process.env.OMNI_TEST_BASE ?? "https://video.chugax.io.vn";

if (!code) {
  console.error(
    "Set OMNI_TEST_CODE to a valid activation code (web UI code, NOT a Magnific key).",
  );
  process.exit(1);
}

const VALID_TIERS = ["omni-std", "omni-pro", "omni-ref-std", "omni-ref-pro"];
if (!VALID_TIERS.includes(tier)) {
  console.error(`Invalid tier "${tier}". Expected: ${VALID_TIERS.join(" | ")}`);
  process.exit(1);
}

interface PostResponse {
  data?: { task_id: string };
  balance?: { mode: string; remainingEur: number | null };
  error?: string;
  message?: string;
}

interface PollResponse {
  data?: {
    task_id: string;
    status: "CREATED" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
    generated: string[];
    error_message?: string;
  };
  error?: string;
  message?: string;
}

function isReferenceTier(t: string): boolean {
  return t.startsWith("omni-ref-");
}

async function post(): Promise<{ taskId: string; balanceBefore: number | null }> {
  const url = `${base}/api/freepik/kling-omni/${tier}`;
  const params: Record<string, unknown> = {
    prompt: "A small fluffy cat staring at a butterfly in a sunny garden, cinematic 4K",
    duration: "5",
    aspect_ratio: "16:9",
    cfg_scale: 0.5,
  };
  // Optional: test elements feature. Pass OMNI_TEST_ELEMENT_URL with
  // a public-reachable image URL (JPG/PNG). Prompt will reference it
  // as @Element1 so Magnific should apply identity lock.
  const elementUrl = process.env.OMNI_TEST_ELEMENT_URL;
  if (elementUrl) {
    params.prompt = `@Element1 standing in a sunny garden, cinematic 4K`;
    const refUrls = (process.env.OMNI_TEST_ELEMENT_REFS ?? "")
      .split(",")
      .map((u) => u.trim())
      .filter((u) => u.length > 0);
    params.elements = [
      {
        frontal_image_url: elementUrl,
        ...(refUrls.length > 0
          ? { reference_image_urls: refUrls }
          : {}),
      },
    ];
    console.log(`Testing WITH element: ${elementUrl}`);
    if (refUrls.length > 0) {
      console.log(`  + ${refUrls.length} reference angle(s)`);
    }
  }
  // V2V needs a reference video URL — use a tiny known-good sample.
  // For e2e smoke, the existing R2 public URLs from prior tests work.
  if (isReferenceTier(tier)) {
    console.error(
      "Reference-to-video tier requires a video_url. Pass via OMNI_TEST_VIDEO_URL.",
    );
    const refUrl = process.env.OMNI_TEST_VIDEO_URL;
    if (!refUrl) process.exit(1);
    params.video_url = refUrl;
  }
  const body = JSON.stringify({ params });
  console.log(`POST ${url}`);
  console.log(`Body: ${body}\n`);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${code}`,
    },
    body,
  });
  const json = (await res.json()) as PostResponse;
  if (!res.ok) {
    console.error(`POST failed: ${res.status} ${JSON.stringify(json)}`);
    process.exit(1);
  }
  const taskId = json.data?.task_id;
  if (!taskId) {
    console.error(`No task_id in response: ${JSON.stringify(json)}`);
    process.exit(1);
  }
  console.log(`✓ Task created: ${taskId}`);
  console.log(`  Balance: ${json.balance?.remainingEur} EUR remaining\n`);
  return { taskId, balanceBefore: json.balance?.remainingEur ?? null };
}

async function poll(taskId: string): Promise<PollResponse["data"]> {
  const url = `${base}/api/freepik/kling-omni/${tier}/${taskId}`;
  const startMs = Date.now();
  const MAX_MS = 5 * 60_000; // 5 min timeout
  let lastStatus = "";

  while (Date.now() - startMs < MAX_MS) {
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${code}` },
    });
    if (!res.ok) {
      console.error(`Poll failed: ${res.status} ${await res.text()}`);
      await new Promise((r) => setTimeout(r, 3_000));
      continue;
    }
    const json = (await res.json()) as PollResponse;
    const data = json.data;
    if (!data) {
      console.error(`Poll response missing data: ${JSON.stringify(json)}`);
      await new Promise((r) => setTimeout(r, 3_000));
      continue;
    }
    if (data.status !== lastStatus) {
      const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
      console.log(`[${elapsed}s] status=${data.status}`);
      lastStatus = data.status;
    }
    if (data.status === "COMPLETED") return data;
    if (data.status === "FAILED") {
      console.error(`Task FAILED: ${data.error_message ?? "(no upstream reason)"}`);
      return data;
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  console.error(`Timeout after ${MAX_MS / 1000}s`);
  return undefined;
}

async function main() {
  console.log("=== Kling Omni e2e smoke test ===");
  console.log(`Tier: ${tier}`);
  console.log(`Base: ${base}\n`);

  const { taskId, balanceBefore } = await post();
  const result = await poll(taskId);

  console.log("\n=== Result ===");
  if (!result) {
    console.log("INCONCLUSIVE — timed out, task may still complete via webhook.");
    process.exit(2);
  }
  if (result.status === "COMPLETED") {
    console.log(`✅ SUCCESS`);
    console.log(`Video URL: ${result.generated[0]}`);
    if (balanceBefore != null) {
      console.log(`Balance before: ${balanceBefore} EUR (charged ~${(0.168 * 5).toFixed(3)})`);
    }
  } else {
    console.log(`❌ ${result.status}`);
    console.log(`Reason: ${result.error_message ?? "(unknown)"}`);
  }
}

main().catch((err) => {
  console.error("e2e failed:", err);
  process.exit(1);
});
