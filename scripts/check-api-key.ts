/**
 * Sanity check — verifies the Magnific API key is valid by calling a
 * zero-cost list endpoint. Run: pnpm check:api
 *
 * Defaults to Magnific (api.magnific.com); override via env vars if you
 * need to test against api.freepik.com.
 */
import "dotenv/config";

const API_BASE_URL = process.env.FREEPIK_API_BASE_URL ?? "https://api.magnific.com";
const API_KEY_HEADER = process.env.FREEPIK_API_KEY_HEADER ?? "x-magnific-api-key";
const API_KEY = process.env.FREEPIK_API_KEY;

async function main() {
  if (!API_KEY) {
    console.error("FAIL: FREEPIK_API_KEY is not set. Check .env.local");
    process.exit(1);
  }

  console.log(`Checking API key: ${API_KEY.slice(0, 8)}...`);

  try {
    const res = await fetch(
      `${API_BASE_URL}/v1/ai/video/kling-v3?limit=1`,
      {
        headers: { [API_KEY_HEADER]: API_KEY },
      }
    );

    const body = await res.text();

    if (res.ok) {
      console.log(`OK (status=${res.status}) — API key is valid, Kling 3 access confirmed.`);
    } else if (res.status === 404 && body.includes("Tasks not found")) {
      // 404 "Tasks not found" means auth works, just no previous tasks exist
      console.log(`OK (status=${res.status}) — API key is valid. No previous tasks found (expected for new keys).`);
    } else if (res.status === 401) {
      console.error("FAIL: Invalid API key. Check FREEPIK_API_KEY in .env.local");
      process.exit(1);
    } else {
      console.error(`FAIL: HTTP ${res.status}`);
      console.error(body);
      process.exit(1);
    }
  } catch (err) {
    console.error("FAIL: Network error —", err);
    process.exit(1);
  }
}

main();
