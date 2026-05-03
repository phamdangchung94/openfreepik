/**
 * AES-256-GCM encrypt/decrypt using the Web Crypto API.
 *
 * Works in any runtime that exposes globalThis.crypto.subtle:
 * Node 20+, Vercel serverless, Vercel Edge, browsers.
 *
 * Output format: base64( iv (12 bytes) || ciphertext+tag )
 * AES-GCM auto-appends a 16-byte authentication tag to the ciphertext.
 */

const IV_LENGTH = 12;

function getSubtle(): SubtleCrypto {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    throw new Error(
      "Web Crypto API not available. Requires Node 20+ or a modern runtime.",
    );
  }
  return crypto.subtle;
}

async function importKey(secretBase64: string): Promise<CryptoKey> {
  if (!secretBase64) {
    throw new Error("KEY_ENCRYPTION_SECRET is empty");
  }
  const raw = base64ToBytes(secretBase64);
  if (raw.length !== 32) {
    throw new Error(
      `KEY_ENCRYPTION_SECRET must decode to 32 bytes, got ${raw.length}`,
    );
  }
  return getSubtle().importKey(
    "raw",
    raw as BufferSource,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encrypt(plaintext: string): Promise<string> {
  const secret = process.env.KEY_ENCRYPTION_SECRET;
  if (!secret) throw new Error("KEY_ENCRYPTION_SECRET not set");

  const key = await importKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const data = new TextEncoder().encode(plaintext);

  const ciphertext = await getSubtle().encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    data as BufferSource,
  );

  const out = new Uint8Array(IV_LENGTH + ciphertext.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ciphertext), IV_LENGTH);
  return bytesToBase64(out);
}

export async function decrypt(ciphertextBase64: string): Promise<string> {
  const secret = process.env.KEY_ENCRYPTION_SECRET;
  if (!secret) throw new Error("KEY_ENCRYPTION_SECRET not set");

  const key = await importKey(secret);
  const all = base64ToBytes(ciphertextBase64);
  if (all.length <= IV_LENGTH) {
    throw new Error("Ciphertext too short to contain IV + data");
  }

  const iv = all.slice(0, IV_LENGTH);
  const data = all.slice(IV_LENGTH);

  const plaintext = await getSubtle().decrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    data as BufferSource,
  );

  return new TextDecoder().decode(plaintext);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}
