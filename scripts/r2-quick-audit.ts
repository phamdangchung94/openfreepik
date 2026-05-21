/**
 * Quick R2 audit via Cloudflare API (no R2 S3 secret needed).
 * Run: pnpm tsx --env-file=.env.local scripts/r2-quick-audit.ts
 *
 * Required env:
 *   CLOUDFLARE_API_TOKEN     — scoped to Workers R2 Storage:Edit
 *   CLOUDFLARE_ACCOUNT_ID    — 32-char hex account id
 */

export {}; // ensure ES module — avoids global-scope const collisions with sibling scripts

const cfToken = process.env.CLOUDFLARE_API_TOKEN;
const cfAccount = process.env.CLOUDFLARE_ACCOUNT_ID;

if (!cfToken || !cfAccount) {
  console.error("Missing CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID in .env.local");
  process.exit(1);
}

async function cf<T = unknown>(path: string): Promise<T> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${cfAccount}${path}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${cfToken}` },
  });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`CF API ${res.status} on ${path}: ${body.slice(0, 400)}`);
  }
  return JSON.parse(body) as T;
}

interface CFEnvelope<T> {
  success: boolean;
  errors: { code: number; message: string }[];
  result: T;
  result_info?: { cursor?: string; per_page?: number; count?: number };
}

interface Bucket {
  name: string;
  creation_date: string;
  location?: string;
}

interface R2Object {
  key: string;
  size: number;
  last_modified: string;
  http_metadata?: Record<string, string>;
  customMetadata?: Record<string, string>;
  etag?: string;
  version?: string;
}

async function listBuckets(): Promise<Bucket[]> {
  const env = await cf<CFEnvelope<{ buckets: Bucket[] }>>("/r2/buckets");
  return env.result.buckets;
}

async function listObjects(bucket: string, prefix: string, max = 1000): Promise<R2Object[]> {
  const all: R2Object[] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const qs = new URLSearchParams({ per_page: "1000", prefix });
    if (cursor) qs.set("cursor", cursor);
    const env = await cf<CFEnvelope<R2Object[]>>(
      `/r2/buckets/${bucket}/objects?${qs.toString()}`,
    );
    all.push(...env.result);
    cursor = env.result_info?.cursor;
    pages++;
    if (pages >= 10 || all.length >= max) break;
  } while (cursor);
  return all;
}

async function getCors(bucket: string): Promise<unknown> {
  try {
    return await cf(`/r2/buckets/${bucket}/cors`);
  } catch (err) {
    return { error: String(err) };
  }
}

async function getLifecycle(bucket: string): Promise<unknown> {
  try {
    return await cf(`/r2/buckets/${bucket}/lifecycle`);
  } catch (err) {
    return { error: String(err) };
  }
}

function summarize(objects: R2Object[]): {
  total: number;
  totalSizeMB: number;
  ageBuckets: Record<string, number>;
  oldest: { key: string; ageHours: number; sizeMB: number } | null;
  newest: { key: string; ageHours: number; sizeMB: number } | null;
  samplesByPrefix: Record<string, number>;
} {
  const now = Date.now();
  const ageBuckets: Record<string, number> = {
    "<=2h": 0,
    "2-24h": 0,
    "24-48h": 0,
    ">48h": 0,
  };
  let totalSize = 0;
  let oldest: R2Object | null = null;
  let newest: R2Object | null = null;
  const samplesByPrefix: Record<string, number> = {};
  for (const o of objects) {
    const ts = new Date(o.last_modified).getTime();
    const ageH = (now - ts) / 3_600_000;
    totalSize += o.size;
    if (ageH <= 2) ageBuckets["<=2h"]!++;
    else if (ageH <= 24) ageBuckets["2-24h"]!++;
    else if (ageH <= 48) ageBuckets["24-48h"]!++;
    else ageBuckets[">48h"]!++;
    if (!oldest || ts < new Date(oldest.last_modified).getTime()) oldest = o;
    if (!newest || ts > new Date(newest.last_modified).getTime()) newest = o;
    const top = o.key.split("/")[0] + "/";
    samplesByPrefix[top] = (samplesByPrefix[top] ?? 0) + 1;
  }
  const fmt = (o: R2Object | null) =>
    o
      ? {
          key: o.key,
          ageHours: Number(((now - new Date(o.last_modified).getTime()) / 3_600_000).toFixed(2)),
          sizeMB: Number((o.size / 1_048_576).toFixed(3)),
        }
      : null;
  return {
    total: objects.length,
    totalSizeMB: Number((totalSize / 1_048_576).toFixed(2)),
    ageBuckets,
    oldest: fmt(oldest),
    newest: fmt(newest),
    samplesByPrefix,
  };
}

async function main() {
  console.log("=== Cloudflare R2 audit ===");
  console.log(`Account: ${cfAccount!.slice(0, 8)}...\n`);

  const buckets = await listBuckets();
  console.log(`Found ${buckets.length} bucket(s):`);
  for (const b of buckets) {
    console.log(`  - ${b.name} (created ${b.creation_date}, location ${b.location ?? "?"})`);
  }

  for (const b of buckets) {
    console.log(`\n=== Bucket: ${b.name} ===`);

    console.log("\n--- CORS ---");
    console.log(JSON.stringify(await getCors(b.name), null, 2));

    console.log("\n--- Lifecycle ---");
    console.log(JSON.stringify(await getLifecycle(b.name), null, 2));

    console.log("\n--- Whole bucket sample (1000 max) ---");
    const all = await listObjects(b.name, "", 1000);
    console.log(JSON.stringify(summarize(all), null, 2));

    console.log("\n--- prefix: uploads/ ---");
    const uploads = await listObjects(b.name, "uploads/", 1000);
    console.log(JSON.stringify(summarize(uploads), null, 2));

    console.log("\n--- prefix: videos/ ---");
    const videos = await listObjects(b.name, "videos/", 1000);
    console.log(JSON.stringify(summarize(videos), null, 2));
  }
}

main().catch((err) => {
  console.error("audit failed:", err);
  process.exit(1);
});
