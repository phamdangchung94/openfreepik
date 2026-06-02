/**
 * One-shot apply of empirically-measured Magnific rates (2026-05-06).
 * Generated from 5-test calibration run by user — see chat transcript
 * around commit 24a7a70.
 *
 * Linearity verified at pro+audio (5s vs 10s): 0% drift.
 *
 * Run once:
 *   DATABASE_URL=postgres://... pnpm tsx scripts/upsert-calibrated-pricing.ts
 *
 * Will overwrite previously-seeded values (UPSERT). After this, future
 * runs of pnpm db:seed-pricing will use these rates per the bumped
 * constants in scripts/seed-pricing.ts.
 */

import postgres from "postgres";

const RATES = {
  std_noaudio: 0.168,
  std_audio: 0.308,
  pro_noaudio: 0.224,
  pro_audio: 0.392,
} as const;

const DURATIONS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }
  const sql = postgres(process.env.DATABASE_URL, {
    prepare: false,
    max: 1,
    idle_timeout: 10,
  });

  let count = 0;
  for (const tier of ["std", "pro"] as const) {
    for (const duration of DURATIONS) {
      for (const audio of [false, true]) {
        const key = `${tier}_${audio ? "audio" : "noaudio"}` as keyof typeof RATES;
        const cost = (RATES[key] * duration).toFixed(2);
        await sql`
          INSERT INTO pricing_rules (endpoint, tier, duration_seconds, with_audio, cost_eur)
          VALUES ('kling-v3', ${tier}, ${duration}, ${audio}, ${cost})
          ON CONFLICT (endpoint, tier, duration_seconds, with_audio)
          DO UPDATE SET cost_eur = EXCLUDED.cost_eur, updated_at = now()
        `;
        count++;
      }
    }
  }

  // improve-prompt is free
  await sql`
    INSERT INTO pricing_rules (endpoint, tier, duration_seconds, with_audio, cost_eur)
    VALUES ('improve-prompt', NULL, NULL, false, '0.00')
    ON CONFLICT (endpoint, tier, duration_seconds, with_audio)
    DO UPDATE SET cost_eur = EXCLUDED.cost_eur, updated_at = now()
  `;

  console.log(`Upserted ${count + 1} rules.`);
  const verify = await sql`
    SELECT tier, duration_seconds, with_audio, cost_eur
    FROM pricing_rules
    WHERE endpoint = 'kling-v3' AND duration_seconds = 5
    ORDER BY tier, with_audio
  `;
  console.log("\nVerification (5s rates):");
  for (const r of verify) {
    console.log(`  ${r.tier}/5s/audio=${r.with_audio}: ${r.cost_eur} EUR`);
  }
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
