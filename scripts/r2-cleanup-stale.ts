/**
 * One-shot cleanup of stale objects in the R2 bucket via Cloudflare
 * API. Deletes objects in `videos/` + `uploads/` older than --maxAgeHours
 * (default 24 — matches new lifecycle TTL).
 *
 * Why this exists: the old lifecycle rule was broken (prefix=" " typo
 * — see r2-fix-lifecycle.ts) so ~889 objects accumulated. New rules
 * apply going forward but Cloudflare won't retroactively sweep — needs
 * this one-shot to clear the backlog.
 *
 * Run (DRY RUN by default):
 *   pnpm tsx --env-file=.env.local scripts/r2-cleanup-stale.ts
 *   pnpm tsx --env-file=.env.local scripts/r2-cleanup-stale.ts --live
 *   pnpm tsx --env-file=.env.local scripts/r2-cleanup-stale.ts --live --maxAgeHours=24
 */

const cfToken = process.env.CLOUDFLARE_API_TOKEN;
const cfAccount = process.env.CLOUDFLARE_ACCOUNT_ID;
const BUCKET = "openfreepik";

if (!cfToken || !cfAccount) {
  console.error("Missing CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID");
  process.exit(1);
}

const args = process.argv.slice(2);
const isLive = args.includes("--live");
const ageArg = args.find((a) => a.startsWith("--maxAgeHours="));
const maxAgeHours = ageArg ? Number(ageArg.split("=")[1]) : 24;
const PREFIXES = ["videos/", "uploads/"];

async function cf<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${cfAccount}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${cfToken}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`CF ${res.status} ${path}: ${body.slice(0, 300)}`);
  return JSON.parse(body) as T;
}

interface CFEnvelope<T> {
  success: boolean;
  result: T;
  result_info?: { cursor?: string };
}
interface R2Object { key: string; size: number; last_modified: string }

async function listAll(prefix: string): Promise<R2Object[]> {
  const all: R2Object[] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const qs = new URLSearchParams({ per_page: "1000", prefix });
    if (cursor) qs.set("cursor", cursor);
    const env = await cf<CFEnvelope<R2Object[]>>(
      `/r2/buckets/${BUCKET}/objects?${qs.toString()}`,
    );
    all.push(...env.result);
    cursor = env.result_info?.cursor;
    pages++;
    if (pages >= 20) break; // cap 20K
  } while (cursor);
  return all;
}

async function deleteOne(key: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await cf(`/r2/buckets/${BUCKET}/objects/${encodeURIComponent(key)}`, {
      method: "DELETE",
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function main() {
  console.log("=== R2 stale cleanup ===");
  console.log(`Mode: ${isLive ? "LIVE (deletes)" : "DRY RUN (no deletes)"}`);
  console.log(`Bucket: ${BUCKET}`);
  console.log(`Max age: ${maxAgeHours}h`);
  console.log("");

  const cutoffMs = Date.now() - maxAgeHours * 3_600_000;
  let totalScanned = 0;
  let totalMatched = 0;
  let totalDeleted = 0;
  let totalSizeMB = 0;

  for (const prefix of PREFIXES) {
    console.log(`\n--- prefix: ${prefix} ---`);
    const objects = await listAll(prefix);
    totalScanned += objects.length;
    const matches = objects.filter((o) => new Date(o.last_modified).getTime() <= cutoffMs);
    totalMatched += matches.length;
    const sizeMB = matches.reduce((s, o) => s + o.size, 0) / 1_048_576;
    totalSizeMB += sizeMB;
    console.log(`  scanned: ${objects.length}, stale: ${matches.length}, sizeMB: ${sizeMB.toFixed(2)}`);
    if (matches[0]) console.log(`  oldest: ${matches[0].key} (${matches[0].uploaded})`);

    if (!isLive) continue;

    // Batch delete one-at-a-time (CF API doesn't have bulk delete for R2 yet).
    // ~889 objects × ~50ms each = ~45 sec. Acceptable.
    let deleted = 0;
    let errors = 0;
    for (let i = 0; i < matches.length; i++) {
      const m = matches[i]!;
      const res = await deleteOne(m.key);
      if (res.ok) deleted++;
      else {
        errors++;
        if (errors <= 3) console.log(`  err: ${m.key} → ${res.error}`);
      }
      if ((i + 1) % 50 === 0) {
        console.log(`  progress: ${i + 1}/${matches.length} (${deleted} deleted, ${errors} errors)`);
      }
    }
    totalDeleted += deleted;
    console.log(`  done: ${deleted} deleted, ${errors} errors`);
  }

  console.log("\n=== Summary ===");
  console.log(`  scanned: ${totalScanned}`);
  console.log(`  stale (>${maxAgeHours}h): ${totalMatched} (${totalSizeMB.toFixed(2)} MB)`);
  if (isLive) {
    console.log(`  deleted: ${totalDeleted}`);
  } else {
    console.log("  (DRY RUN — pass --live to actually delete)");
  }
}

main().catch((err) => {
  console.error("cleanup failed:", err);
  process.exit(1);
});
