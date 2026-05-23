/**
 * Single-shot AI prompt template — covers the entire public API so a
 * developer can paste it into ChatGPT / Claude / Cursor / Copilot
 * and get working integration code without further roundtrips.
 *
 * Design notes:
 *   - Markdown only — every modern LLM parses MD natively
 *   - Self-contained: no external links the AI would need to fetch
 *   - Front-loaded with the most important conventions (auth, error
 *     shape, polling pattern) so a short-context paste still works
 *   - Concrete cURL/JS/Python samples for every endpoint
 *   - Pricing table so AI can warn the developer about cost
 *   - "Implementation kit" footer with prompt scaffolds for common
 *     tasks ("build me a CLI that…")
 *
 * Kept as a function (not a static const) so we can interpolate the
 * canonical host + version + current pricing if it ever moves to
 * runtime configuration.
 */

const CANONICAL_HOST = "https://video.chugax.io.vn";

export function buildAiPrompt(): string {
  return `# Video AI API — Integration guide for AI coding assistants

You are helping a developer integrate with **Video AI**, a REST API for
AI video generation (Kling 3, Kling 3 4K, Kling Motion Control). Write
production-quality code using the spec below.

## TL;DR

- **Base URL**: \`${CANONICAL_HOST}/api/v1\`
- **Auth**: header \`Authorization: Bearer sk_...\` on every request
- **Standard flow**: POST /video/* → poll GET /tasks/{task_id} every 2s
  until \`status === "COMPLETED"\` → use \`generated[0]\` as video URL
- **Video URLs expire after 24 hours** — download if you need long-term
- **All money is in EUR internally** (1 EUR ≈ 1000 VND)

## Standard response shapes

### Success (POST /video/*)
\`\`\`json
{
  "ok": true,
  "task_id": "uuid-here",
  "balance": {
    "mode": "topup" | "quota" | "unlimited",
    "usedEur": 1.23,
    "quotaEur": 10.0,
    "remainingEur": 8.77
  }
}
\`\`\`

### Task status (GET /tasks/{task_id})
\`\`\`json
{
  "ok": true,
  "task_id": "uuid-here",
  "status": "CREATED" | "IN_PROGRESS" | "COMPLETED" | "FAILED",
  "generated": ["https://cdn.../video.mp4"],
  "error_message": null
}
\`\`\`

### Error (any 4xx/5xx)
\`\`\`json
{
  "ok": false,
  "error": "AUTH" | "BAD_REQUEST" | "RATE_LIMIT" | "INSUFFICIENT_BALANCE" | "PRICING_MISSING" | "NO_KEYS_AVAILABLE" | "NOT_FOUND" | "IDEMPOTENCY_CONFLICT" | "INTERNAL",
  "message": "Human-readable description",
  "request_id": "uuid — quote in support tickets"
}
\`\`\`

## Standard headers

Every response includes:
- \`X-Request-Id\`: per-request UUID (for support / log correlation)
- \`X-RateLimit-Limit\`: max requests in the current window
- \`X-RateLimit-Remaining\`: requests left in the current window
- \`X-RateLimit-Reset\`: seconds until the window resets
- \`Retry-After\` (on 429): seconds to wait

## Optional headers customers can send

- \`Idempotency-Key: <uuid>\` — retry-safety on POST endpoints.
  Same key + same body within 24h returns cached response;
  same key + different body returns 409 IDEMPOTENCY_CONFLICT.

## Endpoints

### Auth & discovery (no charge)

#### \`GET /me\`
Returns the authenticated key's owner info + balance.
\`\`\`bash
curl ${CANONICAL_HOST}/api/v1/me \\
  -H "Authorization: Bearer sk_your_key_here"
\`\`\`
Response: \`{ ok: true, key: { id, label, rateLimitPerMin }, balance: {...} }\`

#### \`GET /models\` (no auth required)
Lists available models + per-second pricing. AI tools call this for
auto-discovery.
\`\`\`bash
curl ${CANONICAL_HOST}/api/v1/models
\`\`\`

#### \`GET /usage?limit=50&since=2026-05-01\`
Self-serve spend history for the authenticated key's activation code.
Returns \`{ ok, usage: [...], summary: { total_count, total_cost_eur, by_status }, balance }\`.

### Video generation (charges balance)

#### \`POST /video/kling-3\` — The do-everything endpoint
Supports 5 modes in the same body shape: T2V, I2V first-frame only,
I2V first+last-frame interpolation, multi-shot (up to 6 sequential
scenes), and identity-locked elements.

Full \`params\` field reference:
\`\`\`
prompt              text ≤2500 chars (skip when using multi_prompt)
negative_prompt     text ≤2500 chars (things you DON'T want)
start_image_url     URL of first frame (I2V mode). Omit for T2V.
end_image_url       URL of last frame — model interpolates between start and end
multi_shot          boolean — set true to enable multi-shot mode
shot_type           "customize" (you control each shot) | "intelligent" (AI cuts)
multi_prompt        array of up to 6 { prompt, duration } objects
elements            array of identity refs { frontal_image_url, reference_image_urls[] }
aspect_ratio        "16:9" | "9:16" | "1:1"
duration            string "3" through "15" (seconds)
cfg_scale           0.0–1.0 (higher = stricter prompt adherence, default ~0.5)
generate_audio      boolean (price ×1.5 when true)
\`\`\`

Body: \`{ tier: "std" | "pro", params: {...} }\`

Pricing: std 0.018 €/s, pro 0.063 €/s. Multi-shot bills sum of all
shot durations. Audio +50%.

Examples:

\`\`\`bash
# T2V
curl -X POST ${CANONICAL_HOST}/api/v1/video/kling-3 \\
  -H "Authorization: Bearer sk_..." \\
  -H "Content-Type: application/json" \\
  -d '{"tier":"pro","params":{"prompt":"Cat surfing","duration":"5","aspect_ratio":"16:9"}}'

# I2V with first + last frame interpolation
curl -X POST ${CANONICAL_HOST}/api/v1/video/kling-3 \\
  -H "Authorization: Bearer sk_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "tier":"pro",
    "params":{
      "prompt":"Smooth zoom in",
      "start_image_url":"https://cdn/wide.jpg",
      "end_image_url":"https://cdn/closeup.jpg",
      "duration":"8"
    }
  }'

# Multi-shot (3 sequential scenes, each with own prompt + duration)
curl -X POST ${CANONICAL_HOST}/api/v1/video/kling-3 \\
  -H "Authorization: Bearer sk_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "tier":"pro",
    "params":{
      "multi_shot":true,
      "shot_type":"customize",
      "multi_prompt":[
        {"prompt":"Wide shot of city at dawn","duration":"5"},
        {"prompt":"Zoom into coffee shop","duration":"5"},
        {"prompt":"Close-up of latte art","duration":"5"}
      ]
    }
  }'

# Elements (lock a character's identity across frames)
curl -X POST ${CANONICAL_HOST}/api/v1/video/kling-3 \\
  -H "Authorization: Bearer sk_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "tier":"pro",
    "params":{
      "prompt":"@Element1 walking through Tokyo at night",
      "elements":[{
        "frontal_image_url":"https://cdn/char-front.jpg",
        "reference_image_urls":["https://cdn/char-side.jpg","https://cdn/char-back.jpg"]
      }],
      "duration":"5"
    }
  }'
\`\`\`

#### \`POST /video/kling-3-4k-text\` — 4K text-to-video
Body: \`{ params: { prompt, negative_prompt?, aspect_ratio?, duration, cfg_scale?, generate_audio? } }\`
Duration: "3" to "15" (string). Rate: 0.252 €/s.
No multi-shot / no start-end frame on 4K — use Kling 3 std/pro for those.

#### \`POST /video/kling-3-4k-image\` — 4K image-to-video
Body: \`{ params: { image, prompt?, duration, cfg_scale?, negative_prompt? } }\`
\`image\` required (URL or base64 data URI). Rate: 0.252 €/s.

#### \`POST /video/kling-motion/{tier}\` — Apply motion from a reference video to a character
Path \`{tier}\`: \`v2-6-std\` | \`v2-6-pro\` | \`v3-std\` | \`v3-pro\`
Body:
\`\`\`json
{
  "params": {
    "image_url": "https://your-cdn.com/character.jpg",
    "video_url": "https://your-cdn.com/motion-reference.mp4",
    "prompt": "anime style, vibrant colors",
    "character_orientation": "video" | "image",
    "cfg_scale": 0.5
  },
  "output_duration": 5
}
\`\`\`
- \`character_orientation: "video"\` → output 5/10/15/20/25/30 seconds
- \`character_orientation: "image"\` → output capped at 10 seconds
- Rates: v2-6-std 0.059, v2-6-pro 0.118, v3-std 0.126, v3-pro 0.168 €/s

### Utilities

#### \`POST /prompt/improve\` (free)
Expand a short prompt into a detailed one. Body: \`{ prompt, type: "video" | "image", language?: "vi" | "en" }\`.
Returns \`task_id\` — poll the same way, result text in \`generated[0]\`.

#### \`POST /upload\` — Get a presigned URL to upload an image/video
Returns \`{ ok, upload_url, public_url, key, expires_at }\`. PUT the file
to \`upload_url\` with the matching Content-Type. The \`public_url\` is
what you pass back as \`image_url\` / \`video_url\` to Motion endpoints.
- Image cap: 15MB. Video cap: 60MB. File auto-deletes after 2 hours.

### Polling

#### \`GET /tasks/{task_id}\` — Universal poll for every model
Returns the task status. Poll every 2 seconds until \`status\` reaches
\`COMPLETED\` (use \`generated[0]\`) or \`FAILED\` (read \`error_message\`).

## Optional: server-push completion via \`webhook_url\`

Add \`webhook_url: "https://your-server.com/webhook?token=xyz"\` to the
top level of any POST /video/* body. When the task finishes, the server
POSTs the status payload to that URL:
\`\`\`json
{
  "task_id": "uuid",
  "status": "COMPLETED" | "FAILED",
  "endpoint": "kling-v3",
  "video_url": "https://cdn.../video.mp4",
  "video_url_expires_at": "2026-05-24T...",
  "error_message": null,
  "finalized_at": "2026-05-23T..."
}
\`\`\`
Header on the delivery: \`X-Webhook-Event: task.succeeded\` or \`task.failed\`.

Best-effort fire-and-forget (10s timeout, no retries). Poll \`/tasks/{id}\`
as a backup if delivery fails.

## Pricing summary (EUR/second × duration)

| Model | Tier | EUR/sec | Example 5s | Example 10s |
|---|---|---|---|---|
| Kling 3 | std | 0.018 | 0.09 € | 0.18 € |
| Kling 3 | pro | 0.063 | 0.315 € | 0.63 € |
| Kling 3 4K | 4k | 0.252 | 1.26 € | 2.52 € |
| Motion 2.6 | std | 0.059 | 0.295 € | 0.59 € |
| Motion 2.6 | pro | 0.118 | 0.59 € | 1.18 € |
| Motion 3.0 | std | 0.126 | 0.63 € | 1.26 € |
| Motion 3.0 | pro | 0.168 | 0.84 € | 1.68 € |
| Prompt enhance | — | 0 (free) | — | — |

VND conversion: roughly 1 EUR ≈ 1,000 VND.

## Sample integration (Python, complete + idiomatic)

\`\`\`python
import os
import time
import requests
from uuid import uuid4

BASE = "${CANONICAL_HOST}/api/v1"
API_KEY = os.environ["VIDEO_API_KEY"]  # sk_...
HEADERS = {"Authorization": f"Bearer {API_KEY}"}


def generate_video(prompt: str, tier: str = "std", duration: int = 5) -> str:
    """Submit a Kling 3 video, poll until done, return the MP4 URL."""
    # Idempotency-Key makes the call retry-safe on network flake.
    idem = str(uuid4())
    resp = requests.post(
        f"{BASE}/video/kling-3",
        headers={**HEADERS, "Idempotency-Key": idem, "Content-Type": "application/json"},
        json={
            "tier": tier,
            "params": {
                "prompt": prompt,
                "aspect_ratio": "16:9",
                "duration": str(duration),
                "generate_audio": False,
            },
        },
        timeout=30,
    )
    if resp.status_code == 429:
        # Honor rate-limit: wait then retry once.
        retry_after = int(resp.headers.get("Retry-After", "5"))
        time.sleep(retry_after)
        return generate_video(prompt, tier, duration)
    resp.raise_for_status()
    task_id = resp.json()["task_id"]
    print(f"Task started: {task_id}")

    # Poll every 2 seconds. Cap at 5 minutes total — Kling typically
    # finishes in 30-90 seconds; 5 min covers Magnific upstream queueing.
    deadline = time.time() + 300
    while time.time() < deadline:
        time.sleep(2)
        s = requests.get(f"{BASE}/tasks/{task_id}", headers=HEADERS).json()
        if s["status"] == "COMPLETED":
            return s["generated"][0]
        if s["status"] == "FAILED":
            raise RuntimeError(s.get("error_message") or "Task failed")
    raise TimeoutError(f"Task {task_id} did not finish within 5 min")


if __name__ == "__main__":
    url = generate_video("A cinematic shot of a Vietnamese street food market at night")
    print(f"Video ready: {url}")
\`\`\`

## Sample integration (JavaScript / Node)

\`\`\`javascript
const BASE = "${CANONICAL_HOST}/api/v1";
const API_KEY = process.env.VIDEO_API_KEY;

async function generateVideo(prompt, { tier = "std", duration = 5 } = {}) {
  const idem = crypto.randomUUID();
  const res = await fetch(\`\${BASE}/video/kling-3\`, {
    method: "POST",
    headers: {
      Authorization: \`Bearer \${API_KEY}\`,
      "Idempotency-Key": idem,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      tier,
      params: {
        prompt,
        aspect_ratio: "16:9",
        duration: String(duration),
        generate_audio: false,
      },
    }),
  });

  if (res.status === 429) {
    const wait = Number(res.headers.get("Retry-After") ?? 5);
    await new Promise((r) => setTimeout(r, wait * 1000));
    return generateVideo(prompt, { tier, duration });
  }
  if (!res.ok) throw new Error(\`HTTP \${res.status}: \${await res.text()}\`);

  const { task_id } = await res.json();

  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const status = await fetch(\`\${BASE}/tasks/\${task_id}\`, {
      headers: { Authorization: \`Bearer \${API_KEY}\` },
    }).then((r) => r.json());
    if (status.status === "COMPLETED") return status.generated[0];
    if (status.status === "FAILED") throw new Error(status.error_message ?? "FAILED");
  }
  throw new Error(\`Task \${task_id} timed out\`);
}
\`\`\`

## Implementation patterns to keep in mind

1. **Always handle 429**: read \`Retry-After\` header and back off. Don't
   tight-loop retry; you'll get rate-limit-banned by the upstream.
2. **Use Idempotency-Key on every POST in production**: network retries
   should never charge twice. UUID v4 per logical request.
3. **Download videos within 24h**: \`video_url_expires_at\` tells you when
   the URL stops working. Mirror to your own storage for long-term use.
4. **Free tier exists**: \`/prompt/improve\` is free + returns a task_id.
   Use it to expand vague user inputs before generating expensive videos.
5. **Quote request_id in support tickets**: every response includes one
   in headers (\`X-Request-Id\`) AND error body (\`request_id\` field).
6. **Pool keys at the customer level, not per-request**: \`GET /me\`
   shows the balance shared across all API tokens linked to the same
   activation code. Customers can issue multiple tokens (e.g. mobile +
   server) that share the same wallet.

## When the developer asks you to build something

Use this skeleton:
- **Confirm the goal** in one sentence
- **Pick the right endpoint** from the list above based on input/output
- **Show full working code** using the Python or JS skeleton above as a
  starting point. Don't omit error handling.
- **Mention the cost** before generating — e.g. "This will cost ~0.09 €
  (about 90 VND) per video at std tier."
- **Suggest the Idempotency-Key + Retry-After patterns** for production
  use even if the developer didn't ask.

---

Source: https://video.chugax.io.vn/docs/api · Version 1.1 · Updated 2026-05-23
`;
}
