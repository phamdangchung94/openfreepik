/**
 * Empirical pricing calibration — measures the EXACT EUR cost Magnific
 * bills for each tier × audio combination by submitting a test task,
 * having admin compare the Magnific dashboard balance before/after,
 * and using the delta as ground truth.
 *
 * Why this exists: public docs and reseller pricing pages disagreed
 * with what Magnific actually charges (resellers showed 0.336 EUR/s
 * for pro+audio, real bill was ~0.46 EUR/s). The only reliable
 * source is the dashboard itself, and Magnific exposes no balance API,
 * so we read it from the human.
 *
 * Strategy:
 *   1. Run 4 baseline tests at 5s — one per (tier × audio) combo.
 *      (text-to-video and image-to-video share rates per user spec, so
 *      we only test t2v.)
 *   2. Compute per-second rate = delta / 5 for each combo.
 *   3. Extrapolate to all durations 3-15s. Magnific docs imply linear
 *      duration-cost; we verify by sampling 1 extra test at 10s.
 *   4. UPSERT the resulting 26 kling-v3 rules into pricing_rules.
 *
 * Total Magnific cost for full calibration ≈ 5 EUR (4 baseline × ~1
 * EUR each + 1 verification at 10s ≈ 2 EUR). Tasks DO generate real
 * videos — admin can delete them from the Magnific dashboard after.
 *
 * Usage:
 *   FREEPIK_API_KEY=FPSX...  DATABASE_URL=postgres://...  pnpm tsx scripts/calibrate-pricing.ts
 *
 * Prompts:
 *   - Pre-test: "Số dư hiện tại trên Magnific dashboard? (EUR)"
 *   - Post-test: "Refresh dashboard. Số dư mới? (EUR)"
 *   - Final:    "Cập nhật vào pricing_rules? [y/N]"
 */

import postgres from "postgres";
import { createInterface } from "node:readline/promises";

const API_BASE_URL = process.env.FREEPIK_API_BASE_URL ?? "https://api.magnific.com";
const API_KEY_HEADER = process.env.FREEPIK_API_KEY_HEADER ?? "x-magnific-api-key";

const apiKey = process.env.FREEPIK_API_KEY;
if (!apiKey) {
  console.error("FREEPIK_API_KEY not set");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, {
  prepare: false,
  max: 1,
  idle_timeout: 10,
  ssl: "require",
  connect_timeout: 5,
});
const rl = createInterface({ input: process.stdin, output: process.stdout });

interface ComboKey {
  tier: "std" | "pro";
  audio: boolean;
}

const COMBOS: ComboKey[] = [
  { tier: "std", audio: false },
  { tier: "std", audio: true },
  { tier: "pro", audio: false },
  { tier: "pro", audio: true },
];

const DURATIONS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;

const TEST_PROMPT =
  "A test video used for empirical pricing calibration. A red apple " +
  "rotating slowly on a white background.";

async function ask(prompt: string): Promise<string> {
  const a = await rl.question(prompt);
  return a.trim();
}

async function askNumber(prompt: string): Promise<number> {
  for (;;) {
    const raw = await ask(prompt);
    // Accept "487.50", "487,50", "487.5 EUR"
    const cleaned = raw.replace(/[^\d.,-]/g, "").replace(",", ".");
    const n = Number(cleaned);
    if (Number.isFinite(n) && n >= 0) return n;
    console.log(`  ⚠ "${raw}" không parse được — nhập lại số.`);
  }
}

async function submitTask(combo: ComboKey, duration: number): Promise<string> {
  const path = `/v1/ai/video/kling-v3-${combo.tier}`;
  const body = {
    prompt: TEST_PROMPT,
    duration: String(duration),
    generate_audio: combo.audio,
    aspect_ratio: "16:9",
  };

  const res = await fetch(API_BASE_URL + path, {
    method: "POST",
    headers: {
      [API_KEY_HEADER]: apiKey!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  let json: { data?: { task_id?: string } };
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response: ${text.slice(0, 200)}`);
  }
  if (!json.data?.task_id) {
    throw new Error(`No task_id in response: ${text.slice(0, 200)}`);
  }
  return json.data.task_id;
}

interface Measurement {
  tier: "std" | "pro";
  audio: boolean;
  duration: number;
  costEur: number;
  taskId: string;
}

async function measureCombo(
  combo: ComboKey,
  duration: number,
  prevBalance: number,
): Promise<{ measurement: Measurement; newBalance: number }> {
  const label = `${combo.tier}/${duration}s/${combo.audio ? "audio" : "no-audio"}`;
  console.log(`\n──────────────────────────────────────────────────────`);
  console.log(`Test:  ${label}`);
  console.log(`Số dư trước: ${prevBalance.toFixed(2)} EUR`);
  await ask(`> Sẵn sàng submit task? Enter để chạy... `);

  let taskId: string;
  try {
    taskId = await submitTask(combo, duration);
  } catch (err) {
    console.error(`✗ Submit failed: ${err instanceof Error ? err.message : err}`);
    throw err;
  }
  console.log(`✓ Task submitted: ${taskId}`);
  console.log(`  Refresh Magnific dashboard ngay (số dư cập nhật ~10s).`);

  const newBalance = await askNumber(`> Số dư mới (EUR): `);
  const delta = prevBalance - newBalance;

  if (delta <= 0) {
    console.log(`⚠ Delta = ${delta.toFixed(4)} (không trừ tiền?). Skip combo này.`);
    throw new Error("Delta <= 0");
  }
  console.log(`✓ ${label} = ${delta.toFixed(4)} EUR`);

  return {
    measurement: { ...combo, duration, costEur: delta, taskId },
    newBalance,
  };
}

async function upsertRules(perSecondRates: Record<string, number>): Promise<void> {
  const rules: Array<{
    endpoint: string;
    tier: "std" | "pro";
    duration: number;
    withAudio: boolean;
    costEur: number;
  }> = [];

  for (const combo of COMBOS) {
    const key = `${combo.tier}_${combo.audio ? "audio" : "noaudio"}`;
    const rate = perSecondRates[key];
    if (rate === undefined) continue;
    for (const d of DURATIONS) {
      rules.push({
        endpoint: "kling-v3",
        tier: combo.tier,
        duration: d,
        withAudio: combo.audio,
        costEur: Number((rate * d).toFixed(2)),
      });
    }
  }

  console.log(`\nUPSERT ${rules.length} kling-v3 rules...`);
  for (const r of rules) {
    await sql`
      INSERT INTO pricing_rules (endpoint, tier, duration_seconds, with_audio, cost_eur)
      VALUES (${r.endpoint}, ${r.tier}, ${r.duration}, ${r.withAudio}, ${r.costEur.toFixed(2)})
      ON CONFLICT (endpoint, tier, duration_seconds, with_audio)
      DO UPDATE SET cost_eur = EXCLUDED.cost_eur, updated_at = now()
    `;
  }
  console.log(`✓ Done. Sample:`);
  const sample = await sql`
    SELECT tier, duration_seconds, with_audio, cost_eur
    FROM pricing_rules
    WHERE endpoint = 'kling-v3'
    ORDER BY tier, duration_seconds, with_audio
    LIMIT 8
  `;
  for (const row of sample) {
    console.log(`  ${row.tier}/${row.duration_seconds}s/audio=${row.with_audio}: ${row.cost_eur} EUR`);
  }
}

async function main() {
  console.log("Magnific pricing calibration\n");
  console.log(`Endpoint: ${API_BASE_URL}`);
  console.log(`Key:      ${apiKey!.slice(0, 6)}…${apiKey!.slice(-4)}`);
  console.log(`Plan:     4 tests at 5s + 1 verification at 10s = 5 tasks (~5 EUR)\n`);

  const initialBalance = await askNumber(
    "> Số dư hiện tại trên Magnific dashboard? (EUR): ",
  );

  let balance = initialBalance;
  const measurements: Measurement[] = [];

  // Phase 1: 4 baseline tests at 5s
  for (const combo of COMBOS) {
    try {
      const { measurement, newBalance } = await measureCombo(combo, 5, balance);
      measurements.push(measurement);
      balance = newBalance;
    } catch (err) {
      console.error(`Skipping combo ${combo.tier}/${combo.audio}: ${err instanceof Error ? err.message : err}`);
    }
  }

  if (measurements.length === 0) {
    console.error("\n✗ Không có measurement nào succeeded. Exit.");
    rl.close();
    process.exit(1);
  }

  // Phase 2: verify linearity with 1 test at 10s on the most expensive combo
  console.log(`\n──────────────────────────────────────────────────────`);
  console.log(`Verify duration linearity: 1 test ở 10s (pro+audio)`);
  let linearityOk = true;
  let perSecondPro = 0;
  try {
    const { measurement, newBalance } = await measureCombo(
      { tier: "pro", audio: true },
      10,
      balance,
    );
    balance = newBalance;
    const baselineProAudio = measurements.find(
      (m) => m.tier === "pro" && m.audio === true,
    );
    if (baselineProAudio) {
      const expected = (baselineProAudio.costEur / 5) * 10;
      const drift = Math.abs(measurement.costEur - expected) / expected;
      perSecondPro = baselineProAudio.costEur / 5;
      console.log(`  Expected (linear): ${expected.toFixed(4)} EUR`);
      console.log(`  Actual:            ${measurement.costEur.toFixed(4)} EUR`);
      console.log(`  Drift:             ${(drift * 100).toFixed(1)}%`);
      if (drift > 0.05) {
        linearityOk = false;
        console.log(`⚠ Drift > 5% — duration không thuần linear.`);
        console.log(`  Bạn nên test thêm các duration khác. Tạm thời extrapolate linear.`);
      } else {
        console.log(`✓ Linear OK.`);
      }
    }
  } catch (err) {
    console.log(`Skipped 10s verification: ${err instanceof Error ? err.message : err}`);
  }

  // Build per-second rates
  const perSecondRates: Record<string, number> = {};
  console.log(`\n──────────────────────────────────────────────────────`);
  console.log(`Per-second rates derived:`);
  for (const m of measurements) {
    const key = `${m.tier}_${m.audio ? "audio" : "noaudio"}`;
    const rate = m.costEur / m.duration;
    perSecondRates[key] = rate;
    console.log(`  ${key}: ${rate.toFixed(4)} EUR/s  (from ${m.costEur.toFixed(4)} / ${m.duration}s)`);
  }
  void perSecondPro;
  void linearityOk;

  // Build full rules table for preview
  console.log(`\nFull pricing table (extrapolated):`);
  console.log(`  duration  std-noaudio  std-audio  pro-noaudio  pro-audio`);
  for (const d of DURATIONS) {
    const c0 = perSecondRates.std_noaudio ? (perSecondRates.std_noaudio * d).toFixed(2) : "—";
    const c1 = perSecondRates.std_audio ? (perSecondRates.std_audio * d).toFixed(2) : "—";
    const c2 = perSecondRates.pro_noaudio ? (perSecondRates.pro_noaudio * d).toFixed(2) : "—";
    const c3 = perSecondRates.pro_audio ? (perSecondRates.pro_audio * d).toFixed(2) : "—";
    console.log(`  ${String(d).padStart(2, " ")}s       ${c0.padStart(10)}  ${c1.padStart(9)}  ${c2.padStart(11)}  ${c3.padStart(9)}`);
  }
  console.log(`\nMagnific balance changed: ${initialBalance.toFixed(2)} → ${balance.toFixed(2)} EUR (spent ${(initialBalance - balance).toFixed(2)})`);

  const confirm = await ask(`\n> Cập nhật pricing_rules với rates ở trên? [y/N]: `);
  if (confirm.toLowerCase() === "y" || confirm.toLowerCase() === "yes") {
    await upsertRules(perSecondRates);
    console.log(`\n✓ Pricing đã được cập nhật. Refresh /dashboard/pricing để xem.`);
  } else {
    console.log(`Skipped DB update. Rates đã hiển thị ở trên.`);
  }

  rl.close();
  await sql.end();
}

main().catch(async (err) => {
  console.error("Calibration failed:", err);
  rl.close();
  await sql.end();
  process.exit(1);
});
