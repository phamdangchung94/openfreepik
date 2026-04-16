# Freepik API — Research Summary (cached from official docs, 2026-04-15)

Authoritative snapshot of the endpoints used by this project. Source-of-truth for Phase 2 implementation.

## Authentication & Base

- Base URL: `https://api.freepik.com`
- Auth header: `x-freepik-api-key: <your-key>`
- Content-Type: `application/json` for all POST bodies
- All AI endpoints are **asynchronous** — POST returns a `task_id`, you poll with GET `{endpoint}/{task_id}`.

## Task Lifecycle (shared)

```
CREATED → IN_PROGRESS → COMPLETED      (generated[] populated)
                     ↘ FAILED
```

Response envelope for every task endpoint:
```json
{
  "data": {
    "task_id": "uuid",
    "status": "CREATED|IN_PROGRESS|COMPLETED|FAILED",
    "generated": []
  }
}
```

---

## Kling 3 Video Generation

### Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/ai/video/kling-v3-pro` | Generate video (Pro tier, higher fidelity) |
| POST | `/v1/ai/video/kling-v3-std` | Generate video (Standard tier, faster/cheaper) |
| GET  | `/v1/ai/video/kling-v3` | List all Kling 3 tasks |
| GET  | `/v1/ai/video/kling-v3/{task-id}` | Task status / result |

### Request body (both tiers share the schema)

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `prompt` | string (≤2500) | T2V: yes; I2V: optional | — | Describe subject, motion, camera, atmosphere. Reference elements via `@Element1`. |
| `negative_prompt` | string (≤2500) | no | `"blur, distort, and low quality"` | What to avoid |
| `start_image_url` | string (URL) | I2V: yes | — | First frame. Public HTTPS. JPG/JPEG/PNG. ≥300×300, ≤10MB, aspect 1:2.5 to 2.5:1 |
| `end_image_url` | string (URL) | no | — | End frame (for transition video). Same rules. |
| `elements` | array | no | — | Consistency references. Each item: `{ reference_image_urls?: string[], frontal_image_url?: string }`. When set, request is processed as I2V. |
| `generate_audio` | boolean | no | `true` | Native audio |
| `multi_shot` | boolean | no | `false` | Enable scene-based mode |
| `shot_type` | `customize` \| `intelligent` | no | `customize` | Manual scenes vs AI-segmented |
| `multi_prompt` | array (≤6) | no | — | Each item: `{ prompt?: string, duration?: '3'..'15' }`. Total ≤ 15s |
| `aspect_ratio` | `16:9` \| `9:16` \| `1:1` | no | `16:9` | |
| `duration` | `'3'`..`'15'` | no | `'5'` | Seconds (as string enum) |
| `cfg_scale` | number 0..1 | no | `0.5` | Prompt adherence. Kling 3 caps at 1 (unlike 1.x which allowed 2) |
| `webhook_url` | string (URL) | no | — | Async notification |

### Response

```json
{
  "data": {
    "task_id": "046b6c7f-0b8a-43b9-b35d-6489e6daee91",
    "status": "CREATED"
  }
}
```

Poll `GET /v1/ai/video/kling-v3/{task-id}`. When `status=COMPLETED`, `data.generated[0]` is the video URL (MP4).

### Tier differences

| | Pro | Standard |
|---|---|---|
| Quality | Higher fidelity | Good, cost-effective |
| Speed | Standard | Faster |
| Best for | Premium content | High-volume, testing |

### Typical latency

30–120s for 5s video; longer for 15s or multi-shot.

---

## Improve Prompt

### Endpoint

| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/ai/improve-prompt` | Submit a rough prompt for AI enhancement |
| GET  | `/v1/ai/improve-prompt/{task-id}` | Task status / improved prompt (follows same pattern as other task endpoints — confirmed by Freepik's consistent API design) |

### Request body

| Field | Type | Required | Notes |
|---|---|---|---|
| `prompt` | string (≤2500) | yes | Can be empty string to let the AI generate a creative prompt from scratch |
| `type` | `image` \| `video` | yes | We use `video` for our use case |
| `language` | string (ISO 639-1) | no | Defaults to `en`. We pass `en`. |
| `webhook_url` | string (URL) | no | |

### Example request

```bash
curl --request POST \
  --url https://api.freepik.com/v1/ai/improve-prompt \
  --header 'x-freepik-api-key: <api-key>' \
  --header 'content-type: application/json' \
  --data '{ "prompt": "A cat playing with a ball", "type": "video", "language": "en" }'
```

### Response (same task envelope)

On COMPLETED, `data.generated` contains the improved prompt. The OpenAPI schema labels it as URI but real responses return **text**. Our parser must accept both; default to treating it as text.

---

## Error codes (shared)

| Status | Meaning | Our handling |
|---|---|---|
| 400 | Invalid request (bad param) | Parse `invalid_params[]`, show specific toast |
| 401 | Missing / invalid API key | Hard error — tell user to fix `.env.local` |
| 429 | Rate limited (implied, not documented) | Back off, retry after delay |
| 500 | Server error | Retryable toast |
| 503 | Service unavailable | Retryable toast with longer delay |

---

## Notes / gotchas

- Kling 3 `cfg_scale` max is **1**, not 2 (Kling 1.x only).
- `duration` is a string enum, not a number — validate accordingly.
- Images for I2V must be at **publicly reachable URLs** — localhost won't work unless tunneled (ngrok etc.).
- `generate_audio` defaults to **true** — user must opt out if they want silent video.
- Multi-shot: total duration ≤ 15s, each shot 3–15s, max 6 shots.
- Elements (character consistency) require at least one `frontal_image_url` for best results.
- Polling pattern: 2s interval with linear back-off to 10s, 10-minute ceiling for Kling.
