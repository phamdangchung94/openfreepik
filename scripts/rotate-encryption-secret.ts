/**
 * One-shot script to re-encrypt every freepik_keys row when KEY_ENCRYPTION_SECRET
 * is rotated. Audit #2: needed when rotating secrets so that re-deployed
 * Vercel functions can still decrypt the existing Freepik keys.
 *
 * Usage:
 *   pnpm tsx scripts/rotate-encryption-secret.ts \
 *     --url=postgres://... \
 *     --old-secret=<old base64 32-byte> \
 *     --new-secret=<new base64 32-byte>
 *
 * IMPORTANT: run BEFORE updating Vercel env to the new secret. The
 * re-encryption uses both secrets simultaneously (old to decrypt, new to
 * encrypt). After this script succeeds, the DB is on the new secret and
 * the Vercel env update is purely a configuration swap.
 *
 * Idempotency: if all keys are already on the new secret, the script
 * detects decryption failures with --old-secret and reports zero changes.
 */

import postgres from "postgres";

interface Args {
  url: string;
  oldSecret: string;
  newSecret: string;
}

function parseArgs(): Args {
  const args: Record<string, string> = {};
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--([^=]+)=(.+)$/);
    if (m && m[1] && m[2]) args[m[1]] = m[2];
  }
  if (!args.url || !args["old-secret"] || !args["new-secret"]) {
    console.error(
      "Usage: tsx scripts/rotate-encryption-secret.ts --url=... --old-secret=... --new-secret=...",
    );
    process.exit(1);
  }
  return {
    url: args.url,
    oldSecret: args["old-secret"]!,
    newSecret: args["new-secret"]!,
  };
}

const IV_LENGTH = 12;

async function importKey(secretBase64: string): Promise<CryptoKey> {
  const raw = base64ToBytes(secretBase64);
  if (raw.length !== 32) {
    throw new Error(`Secret must decode to 32 bytes, got ${raw.length}`);
  }
  return crypto.subtle.importKey(
    "raw",
    raw as BufferSource,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

async function decrypt(ciphertextBase64: string, secret: string): Promise<string> {
  const key = await importKey(secret);
  const all = base64ToBytes(ciphertextBase64);
  if (all.length <= IV_LENGTH) throw new Error("Ciphertext too short");
  const iv = all.slice(0, IV_LENGTH);
  const data = all.slice(IV_LENGTH);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    data as BufferSource,
  );
  return new TextDecoder().decode(plain);
}

async function encrypt(plaintext: string, secret: string): Promise<string> {
  const key = await importKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const data = new TextEncoder().encode(plaintext);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    data as BufferSource,
  );
  const out = new Uint8Array(IV_LENGTH + ct.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ct), IV_LENGTH);
  return bytesToBase64(out);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

async function main() {
  const { url, oldSecret, newSecret } = parseArgs();
  if (oldSecret === newSecret) {
    console.error("old-secret and new-secret must differ");
    process.exit(1);
  }

  const sql = postgres(url, { prepare: false, max: 1, idle_timeout: 10 });
  const rows = await sql<
    { id: string; label: string; key_encrypted: string }[]
  >`SELECT id, label, key_encrypted FROM freepik_keys`;

  console.log(`Found ${rows.length} freepik_keys row(s) on this DB`);
  let rotated = 0;
  let failed = 0;
  let alreadyNew = 0;

  for (const row of rows) {
    let plaintext: string;
    try {
      plaintext = await decrypt(row.key_encrypted, oldSecret);
    } catch (err) {
      // Maybe already on the new secret? Try it.
      try {
        await decrypt(row.key_encrypted, newSecret);
        console.log(`  SKIP ${row.id} (${row.label}) — already on new secret`);
        alreadyNew++;
        continue;
      } catch {
        console.error(`  FAIL ${row.id} (${row.label}) — old-secret decrypt failed:`, err);
        failed++;
        continue;
      }
    }

    const reEncrypted = await encrypt(plaintext, newSecret);
    await sql`UPDATE freepik_keys SET key_encrypted = ${reEncrypted} WHERE id = ${row.id}`;
    console.log(`  ROTATED ${row.id} (${row.label})`);
    rotated++;
  }

  console.log("");
  console.log(`Summary: rotated=${rotated}, alreadyNew=${alreadyNew}, failed=${failed}`);
  await sql.end();
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Rotation script failed:", err);
  process.exit(1);
});
