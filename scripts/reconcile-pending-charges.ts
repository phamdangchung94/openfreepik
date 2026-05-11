/**
 * Reconcile abandoned 'pending' usage_logs rows.
 *
 * The normal lifecycle is: POST inserts the row as 'pending', GET poll
 * flips it to 'succeeded' (URL persisted) or 'refunded' (Magnific
 * failed / empty generated[]). This script catches the edge cases:
 *
 *   - customer closed the tab before polling started, orphan recovery
 *     never ran
 *   - Vercel function got killed mid-poll, retry attempts exhausted
 *   - Magnific glitch caused the poll handler to throw without
 *     finalizing
 *
 * Strategy: for each pending row older than `CUTOFF_HOURS`, probe the
 * upstream task status with a pool key and call finalizeUsageOnPoll to
 * either succeed (persist URL + magnific_video_url) or refund. Rows
 * still genuinely IN_PROGRESS upstream are skipped — re-run the script
 * later and they'll likely have terminated.
 *
 * Safe to run repeatedly: finalizeUsageOnPoll is idempotent (guards on
 * status='pending'). Concurrent polls + script can't double-refund.
 *
 * Usage: pnpm admin:reconcile [--hours N] [--limit N] [--dry-run]
 */

import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "../src/lib/db/client";
import { usageLogs } from "../src/lib/db/schema";
import { pickActiveKey } from "../src/lib/freepik/key-pool";
import { freepik } from "../src/lib/freepik";
import { FreepikApiError } from "../src/lib/freepik/errors";
import { finalizeUsageOnPoll } from "../src/lib/freepik/orchestrator-helpers";
import { VIDEO_URL_TTL_MS } from "../src/lib/video-url-ttl";

interface Args {
  hours: number;
  limit: number;
  dryRun: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  let hours = 1;
  let limit = 500;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--hours" && argv[i + 1]) hours = Number(argv[++i]);
    else if (a === "--limit" && argv[i + 1]) limit = Number(argv[++i]);
    else if (a === "--dry-run") dryRun = true;
  }
  if (!Number.isFinite(hours) || hours <= 0) throw new Error("--hours must be > 0");
  if (!Number.isFinite(limit) || limit <= 0) throw new Error("--limit must be > 0");
  return { hours, limit, dryRun };
}

async function probeAndFinalize(row: {
  freepikTaskId: string;
  endpoint: string;
  apiKey: string;
  dryRun: boolean;
}): Promise<"succeeded" | "refunded" | "in_progress" | "error"> {
  let getter: ((taskId: string, opts: { apiKey: string }) => Promise<{
    status: string;
    generated: string[];
  }>) | null = null;

  if (row.endpoint === "kling-v3") getter = freepik.klingV3.getTask;
  else if (row.endpoint === "wan-v27") getter = freepik.wanV27.getTask;

  if (!getter) {
    console.warn(`  ! unknown endpoint "${row.endpoint}" — skipping`);
    return "error";
  }

  try {
    const data = await getter(row.freepikTaskId, { apiKey: row.apiKey });

    if (data.status === "COMPLETED") {
      const url = data.generated[0];
      if (!url) {
        if (row.dryRun) {
          console.log(`  → would refund (COMPLETED without URL)`);
          return "refunded";
        }
        await finalizeUsageOnPoll({
          freepikTaskId: row.freepikTaskId,
          outcome: "failed",
          failureReason: "RECONCILE_COMPLETED_WITHOUT_URL",
        });
        return "refunded";
      }
      if (row.dryRun) {
        console.log(`  → would succeed (URL: ${url.slice(0, 60)}...)`);
        return "succeeded";
      }
      // No R2 mirror here — script gives the customer the Magnific URL.
      // The 24h Magnific TTL is enough for a customer who finds an
      // orphaned task in their history.
      await finalizeUsageOnPoll({
        freepikTaskId: row.freepikTaskId,
        outcome: "succeeded",
        videoUrl: url,
        magnificVideoUrl: url,
        videoUrlExpiresAt: new Date(Date.now() + VIDEO_URL_TTL_MS),
      });
      return "succeeded";
    }

    if (data.status === "FAILED") {
      if (row.dryRun) {
        console.log(`  → would refund (FAILED)`);
        return "refunded";
      }
      await finalizeUsageOnPoll({
        freepikTaskId: row.freepikTaskId,
        outcome: "failed",
        failureReason: "RECONCILE_MAGNIFIC_FAILED",
      });
      return "refunded";
    }

    // IN_PROGRESS / CREATED — still running upstream. Leave alone.
    console.log(`  → still ${data.status}, skipping`);
    return "in_progress";
  } catch (err) {
    // Magnific 404 → task no longer exists (gc'd or never existed) →
    // treat as failed so customer gets their money back.
    if (err instanceof FreepikApiError && err.status === 404) {
      if (row.dryRun) {
        console.log(`  → would refund (upstream 404)`);
        return "refunded";
      }
      await finalizeUsageOnPoll({
        freepikTaskId: row.freepikTaskId,
        outcome: "failed",
        failureReason: "RECONCILE_UPSTREAM_NOT_FOUND",
      });
      return "refunded";
    }
    console.error(`  ! probe error:`, err instanceof Error ? err.message : err);
    return "error";
  }
}

async function main() {
  const args = parseArgs();
  console.log(
    `Scanning usage_logs.status='pending' older than ${args.hours}h${args.dryRun ? " (dry run)" : ""}...`,
  );

  const rows = await db
    .select({
      id: usageLogs.id,
      codeId: usageLogs.codeId,
      endpoint: usageLogs.endpoint,
      freepikTaskId: usageLogs.freepikTaskId,
      costEur: usageLogs.costEur,
      createdAt: usageLogs.createdAt,
    })
    .from(usageLogs)
    .where(
      and(
        eq(usageLogs.status, "pending"),
        lt(usageLogs.createdAt, sql`now() - (${args.hours} || ' hours')::interval`),
      ),
    )
    .limit(args.limit);

  console.log(`Found ${rows.length} candidate(s)`);
  if (rows.length === 0) return;

  let succeeded = 0;
  let refunded = 0;
  let stillRunning = 0;
  let errored = 0;

  for (const row of rows) {
    if (!row.freepikTaskId) {
      console.log(`! row ${row.id} has no freepik_task_id — treat as failed`);
      if (!args.dryRun) {
        // No task ID to probe — Magnific never confirmed. Refund.
        await finalizeUsageOnPoll({
          freepikTaskId: "",
          outcome: "failed",
          failureReason: "RECONCILE_NO_TASK_ID",
        });
      }
      refunded++;
      continue;
    }
    // Use a pool key to query Magnific. We don't have a way to know
    // which key originally served this task — any active key with quota
    // can fetch task status, since task IDs are scoped to the Magnific
    // account, not the key. The pool's LRU will hand back keys fairly.
    const key = await pickActiveKey(0);
    if (!key) {
      console.error("No active keys in pool — aborting");
      break;
    }
    console.log(
      `[${row.endpoint}] ${row.freepikTaskId} (created ${row.createdAt.toISOString()}, ${row.costEur} EUR)`,
    );
    const outcome = await probeAndFinalize({
      freepikTaskId: row.freepikTaskId,
      endpoint: row.endpoint,
      apiKey: key.decryptedKey,
      dryRun: args.dryRun,
    });
    if (outcome === "succeeded") succeeded++;
    else if (outcome === "refunded") refunded++;
    else if (outcome === "in_progress") stillRunning++;
    else errored++;
  }

  console.log(
    `\nDone. succeeded=${succeeded} refunded=${refunded} stillRunning=${stillRunning} errored=${errored}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
