/**
 * Create an activation code via CLI (until the admin dashboard exists in Phase 10).
 *
 * Usage:
 *   pnpm tsx --env-file=.env.local scripts/admin-create-code.ts \
 *     --mode=quota --quota=200 --label="Khách A"
 *
 *   pnpm tsx --env-file=.env.local scripts/admin-create-code.ts \
 *     --mode=unlimited --label="Internal test"
 *
 *   pnpm tsx --env-file=.env.local scripts/admin-create-code.ts \
 *     --mode=topup --quota=50 --label="Pay-as-you-go user"
 *
 * Prints the generated code on success — copy it to give to the customer.
 */

import { randomBytes } from "node:crypto";
import { db } from "../src/lib/db/client";
import { activationCodes, type NewActivationCode } from "../src/lib/db/schema";

interface Args {
  mode: "unlimited" | "quota" | "topup";
  quota: string | null;
  label: string | null;
  expiresInDays: number | null;
}

function parseArgs(): Args {
  const args: Record<string, string> = {};
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--([^=]+)=(.+)$/);
    if (m && m[1] && m[2]) args[m[1]] = m[2];
  }

  const mode = args.mode as Args["mode"];
  if (mode !== "unlimited" && mode !== "quota" && mode !== "topup") {
    console.error("--mode must be one of: unlimited, quota, topup");
    process.exit(1);
  }

  if (mode !== "unlimited" && !args.quota) {
    console.error(`--quota=<EUR> is required for mode=${mode}`);
    process.exit(1);
  }

  return {
    mode,
    quota: args.quota ?? null,
    label: args.label ?? null,
    expiresInDays: args["expires-in-days"]
      ? Number(args["expires-in-days"])
      : null,
  };
}

/** 32 bytes → 51-char base32-ish code, prefixed for human recognition. */
function generateCode(): string {
  const random = randomBytes(20).toString("base64url").toUpperCase();
  // Group into 4 dashes-of-5 for readability: FK-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-XX
  const chunks = random.match(/.{1,5}/g) ?? [];
  return `FK-${chunks.join("-")}`;
}

async function main() {
  const args = parseArgs();

  const expiresAt = args.expiresInDays
    ? new Date(Date.now() + args.expiresInDays * 86_400_000)
    : null;

  const newRow: NewActivationCode = {
    code: generateCode(),
    mode: args.mode,
    quotaEur: args.quota,
    customerLabel: args.label,
    expiresAt,
  };

  const [inserted] = await db
    .insert(activationCodes)
    .values(newRow)
    .returning();

  if (!inserted) {
    console.error("Insert returned no rows");
    process.exit(1);
  }

  console.log("");
  console.log("Activation code created:");
  console.log("");
  console.log(`  ${inserted.code}`);
  console.log("");
  console.table({
    id: inserted.id,
    label: inserted.customerLabel ?? "(none)",
    mode: inserted.mode,
    quotaEur: inserted.quotaEur ?? "(unlimited)",
    expiresAt: inserted.expiresAt?.toISOString() ?? "(never)",
  });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Failed to create code:", err);
    process.exit(1);
  });
