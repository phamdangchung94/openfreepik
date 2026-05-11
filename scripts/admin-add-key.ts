/**
 * Add a Freepik API key to the encrypted pool.
 *
 * Usage:
 *   pnpm tsx --env-file=.env.local scripts/admin-add-key.ts \
 *     --label="Account 1 - tom@example.com" \
 *     --key="FPSXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \
 *     [--assigned=500] \
 *     [--notes="500 EUR free credit account"]
 *
 * The key is AES-GCM encrypted with KEY_ENCRYPTION_SECRET before storage,
 * so anyone with DB access alone can't read it.
 */

import { addKey } from "../src/lib/freepik/key-pool";

interface Args {
  label: string;
  key: string;
  webhookSecret: string | undefined;
  assigned: number;
  notes: string | undefined;
}

function parseArgs(): Args {
  const args: Record<string, string> = {};
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--([^=]+)=(.+)$/);
    if (m && m[1] && m[2]) args[m[1]] = m[2];
  }

  if (!args.label) {
    console.error("--label=<text> is required");
    process.exit(1);
  }
  if (!args.key) {
    console.error("--key=<freepik-api-key> is required");
    process.exit(1);
  }

  return {
    label: args.label,
    key: args.key,
    webhookSecret: args["webhook-secret"],
    assigned: args.assigned ? Number(args.assigned) : 500,
    notes: args.notes,
  };
}

async function main() {
  const args = parseArgs();
  const { id } = await addKey({
    label: args.label,
    plaintextKey: args.key,
    webhookSecret: args.webhookSecret,
    assignedEur: args.assigned,
    notes: args.notes,
  });

  console.log("Key added to pool:");
  console.table({
    id,
    label: args.label,
    assignedEur: args.assigned,
    keyPreview: args.key.slice(0, 6) + "***" + args.key.slice(-4),
    webhookConfigured: args.webhookSecret ? "yes" : "no",
  });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Failed to add key:", err);
    process.exit(1);
  });
