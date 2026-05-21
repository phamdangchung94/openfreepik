/**
 * Replace bucket lifecycle rules. Removes the broken `auto-delete-6h`
 * rule (prefix=" " literal space — typo from manual dashboard config)
 * and installs two scoped rules:
 *
 *   videos/  → 24h delete (output mirror)
 *   uploads/ → 1 day delete (R2 minimum; cron sweep-uploads runs every
 *              15min cleaning at 120-min TTL, lifecycle is backstop)
 *
 * Keeps the "Default Multipart Abort Rule" intact.
 *
 * Run: pnpm tsx --env-file=.env.local scripts/r2-fix-lifecycle.ts
 */

export {}; // ensure ES module — avoids global-scope const collisions with sibling scripts

const cfToken = process.env.CLOUDFLARE_API_TOKEN;
const cfAccount = process.env.CLOUDFLARE_ACCOUNT_ID;
const BUCKET = "openfreepik";

if (!cfToken || !cfAccount) {
  console.error("Missing CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID");
  process.exit(1);
}

const newRules = {
  rules: [
    // Keep the default multipart abort rule.
    {
      id: "Default Multipart Abort Rule",
      enabled: true,
      conditions: {},
      abortMultipartUploadsTransition: {
        condition: { type: "Age", maxAge: 604800 }, // 7 days
      },
    },
    // Mirror output — customer downloads within hours, 24h is generous.
    {
      id: "videos-24h",
      enabled: true,
      conditions: { prefix: "videos/" },
      deleteObjectsTransition: {
        condition: { type: "Age", maxAge: 86400 }, // 24h
      },
    },
    // Customer inputs — primary cleanup is cron sweep-uploads at 120min.
    // R2 lifecycle minimum is 1 day, so this is a backstop for any
    // object the cron misses (R2 outage, cron failure, etc.).
    {
      id: "uploads-1d-backstop",
      enabled: true,
      conditions: { prefix: "uploads/" },
      deleteObjectsTransition: {
        condition: { type: "Age", maxAge: 86400 }, // 1 day
      },
    },
  ],
};

async function main() {
  const url = `https://api.cloudflare.com/client/v4/accounts/${cfAccount}/r2/buckets/${BUCKET}/lifecycle`;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${cfToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(newRules),
  });
  const body = await res.text();
  console.log(`HTTP ${res.status}`);
  console.log(body);
  if (!res.ok) process.exit(1);
}

main().catch((err) => {
  console.error("lifecycle fix failed:", err);
  process.exit(1);
});
