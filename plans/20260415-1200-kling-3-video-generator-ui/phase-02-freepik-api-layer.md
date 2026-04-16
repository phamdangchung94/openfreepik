# Phase 2 — Freepik API Layer

**Status:** ☐ Not started
**Priority:** Critical
**Depends on:** Phase 1

## Overview

Build the thin, strongly-typed server-side layer that every UI feature will call. Two pieces:

1. **Typed Freepik client** (`src/lib/freepik/*`) — one function per endpoint, zero UI coupling.
2. **Next.js API route handlers** (`src/app/api/freepik/*`) — thin proxies that the browser hits; they attach the `x-freepik-api-key` header from the server env and pass the request body through.

The browser calls same-origin `/api/freepik/*` routes. The Freepik API key never leaves the server.

## Key Insights

- Freepik uses a single consistent shape: `POST` creates a task → returns `{ data: { task_id, status, generated } }`. We can model this generically.
- All polling responses share the same `task-detail` schema → one `TaskStatus<T>` type covers everything.
- We do NOT import the Freepik SDK (there isn't an official one). Native `fetch` is plenty.
- Zod schemas double as runtime validation for both incoming requests (client → our API) and outgoing responses (Freepik → us).
- Route handlers use the `Route Handler` convention (`export async function POST`), not the deprecated API routes.

## Requirements

### Functional
- A single import (`import { freepik } from '@/lib/freepik'`) exposes:
  - `freepik.klingV3.generate(params, { tier: 'pro' | 'std' })` → task
  - `freepik.klingV3.getTask(taskId)` → task status
  - `freepik.klingV3.listTasks(opts)` → paginated list
  - `freepik.improvePrompt.create(params)` → task
  - `freepik.improvePrompt.getTask(taskId)` → task status
- Each call throws a `FreepikApiError` with `.status`, `.code`, `.message`, `.invalidParams[]` for 400 errors.
- Four Next.js route handlers exist:
  1. `POST /api/freepik/kling-v3` (body: params + `tier`)
  2. `GET  /api/freepik/kling-v3/[taskId]`
  3. `POST /api/freepik/improve-prompt`
  4. `GET  /api/freepik/improve-prompt/[taskId]`
- Every route validates its input with zod and returns typed JSON.

### Non-functional
- No file in `lib/freepik/` exceeds 200 LOC (per project rules).
- 100% of Freepik responses parse successfully — malformed responses surface as `FreepikApiError` with code `INVALID_RESPONSE`.
- A single constant `FREEPIK_BASE_URL` is the only place the base URL is hardcoded.

## Architecture

```
src/
├── lib/
│   └── freepik/
│       ├── index.ts              ← barrel export: `export const freepik = { klingV3, improvePrompt }`
│       ├── base-client.ts        ← shared `request<T>()` w/ fetch, headers, error mapping
│       ├── errors.ts             ← `FreepikApiError` class + error code enum
│       ├── types.ts              ← shared Task, TaskStatus, AspectRatio, Duration enums
│       ├── kling-v3.ts           ← `generate()`, `getTask()`, `listTasks()` + params type
│       ├── kling-v3-schema.ts    ← zod schemas for kling-v3 request + response
│       ├── improve-prompt.ts     ← `create()`, `getTask()` + params type
│       └── improve-prompt-schema.ts  ← zod schemas
└── app/
    └── api/
        └── freepik/
            ├── kling-v3/
            │   ├── route.ts              ← POST: generate
            │   └── [taskId]/route.ts     ← GET: task status
            └── improve-prompt/
                ├── route.ts              ← POST: create
                └── [taskId]/route.ts     ← GET: task status
```

### Data shapes (excerpt)

```ts
// src/lib/freepik/types.ts
export type TaskStatus = 'CREATED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
export interface Task<T = string> {
  task_id: string;
  status: TaskStatus;
  generated: T[];
}
export interface FreepikResponse<T> { data: T }

// src/lib/freepik/kling-v3.ts
export type KlingV3Tier = 'pro' | 'std';
export type KlingV3AspectRatio = '16:9' | '9:16' | '1:1';
export type KlingV3Duration = '3'|'4'|'5'|'6'|'7'|'8'|'9'|'10'|'11'|'12'|'13'|'14'|'15';
export type KlingV3ShotType = 'customize' | 'intelligent';
export interface KlingV3Element {
  reference_image_urls?: string[];
  frontal_image_url?: string;
}
export interface KlingV3MultiPromptItem {
  prompt?: string;
  duration?: KlingV3Duration;
}
export interface KlingV3GenerateParams {
  prompt?: string;
  negative_prompt?: string;
  start_image_url?: string;
  end_image_url?: string;
  elements?: KlingV3Element[];
  multi_shot?: boolean;
  shot_type?: KlingV3ShotType;
  multi_prompt?: KlingV3MultiPromptItem[];
  aspect_ratio?: KlingV3AspectRatio;
  duration?: KlingV3Duration;
  cfg_scale?: number;  // 0..1
  generate_audio?: boolean;
  webhook_url?: string;
}
```

## Related Code Files

### Create (all new)
- `src/lib/freepik/index.ts`
- `src/lib/freepik/base-client.ts`
- `src/lib/freepik/errors.ts`
- `src/lib/freepik/types.ts`
- `src/lib/freepik/kling-v3.ts`
- `src/lib/freepik/kling-v3-schema.ts`
- `src/lib/freepik/improve-prompt.ts`
- `src/lib/freepik/improve-prompt-schema.ts`
- `src/app/api/freepik/kling-v3/route.ts`
- `src/app/api/freepik/kling-v3/[taskId]/route.ts`
- `src/app/api/freepik/improve-prompt/route.ts`
- `src/app/api/freepik/improve-prompt/[taskId]/route.ts`

### Modify
- `package.json` — add `zod` as runtime dep

## Implementation Steps

1. **Install zod**: `pnpm add zod`

2. **`errors.ts`** — define `FreepikApiError extends Error` with fields: `status`, `code` (`INVALID_RESPONSE | AUTH | BAD_REQUEST | SERVER | NETWORK | UNKNOWN`), `message`, `invalidParams?: { name: string; reason: string }[]`.

3. **`base-client.ts`** — single `request<T>({ method, path, body, schema })`:
   - Builds URL: `${FREEPIK_BASE_URL}${path}`.
   - Attaches `x-freepik-api-key` header from `process.env.FREEPIK_API_KEY`. Throws if missing.
   - Attaches `Content-Type: application/json` for POST.
   - Maps HTTP 401 → AUTH error, 400 → BAD_REQUEST (parse `invalid_params`), 5xx → SERVER, non-JSON/parse fail → INVALID_RESPONSE.
   - Validates response with `schema.parse()` — zod throw → INVALID_RESPONSE.

4. **`types.ts`** — shared enums and `Task`, `FreepikResponse<T>`.

5. **`kling-v3-schema.ts`** — zod for:
   - `klingV3GenerateRequest` (mirrors OpenAPI; all fields optional; cfg_scale `number().min(0).max(1)`)
   - `klingV3GenerateResponse` (`data: task`)
   - `klingV3TaskResponse` (same as above)

6. **`kling-v3.ts`** — three functions:
   - `generate(params, { tier })`: path = `/v1/ai/video/kling-v3-${tier}`, method POST.
   - `getTask(taskId)`: path = `/v1/ai/video/kling-v3/${taskId}`, method GET.
   - `listTasks({ page = 1, perPage = 20 } = {})`: path with query string, GET.

7. **`improve-prompt-schema.ts`** — zod for request (`prompt`, `type: 'image'|'video'`, optional `language`, `webhook_url`) and response (same task shape).

8. **`improve-prompt.ts`** — `create(params)` (POST `/v1/ai/improve-prompt`), `getTask(taskId)` (GET `/v1/ai/improve-prompt/${taskId}`).

9. **`index.ts`** — `export const freepik = { klingV3, improvePrompt }`; also re-export error class and common types.

10. **Route handlers** — one per endpoint, ~30 LOC each:
    ```ts
    // app/api/freepik/kling-v3/route.ts (pseudocode)
    export async function POST(req: NextRequest) {
      const body = await req.json();
      const parsed = routeInputSchema.safeParse(body); // { params, tier }
      if (!parsed.success) return NextResponse.json({ error: 'bad-input' }, { status: 400 });
      try {
        const task = await freepik.klingV3.generate(parsed.data.params, { tier: parsed.data.tier });
        return NextResponse.json({ data: task });
      } catch (e) {
        return errorToResponse(e);
      }
    }
    ```
    Shared helper `errorToResponse(err)` maps `FreepikApiError` to an `NextResponse` with matching status.

11. **Verify end-to-end** with a quick `curl` against the local routes:
    ```bash
    curl -X POST http://localhost:3000/api/freepik/improve-prompt \
      -H 'content-type: application/json' \
      -d '{"prompt":"A cat","type":"video"}'
    ```
    Expect `{ data: { task_id: "...", status: "CREATED", generated: [] } }`.

12. **Unit-free smoke test**: also add a `scripts/smoke-api.ts` that imports `freepik` and calls `klingV3.listTasks({ perPage: 1 })`, prints the first result. Add to package.json as `"smoke:api"`. This is manual — not in CI, just for devs.

## Todo List

- [ ] `pnpm add zod`
- [ ] `errors.ts`
- [ ] `types.ts`
- [ ] `base-client.ts`
- [ ] `kling-v3-schema.ts`
- [ ] `kling-v3.ts`
- [ ] `improve-prompt-schema.ts`
- [ ] `improve-prompt.ts`
- [ ] `index.ts` barrel
- [ ] Route handler: `POST /api/freepik/kling-v3`
- [ ] Route handler: `GET /api/freepik/kling-v3/[taskId]`
- [ ] Route handler: `POST /api/freepik/improve-prompt`
- [ ] Route handler: `GET /api/freepik/improve-prompt/[taskId]`
- [ ] Smoke test via `curl` for improve-prompt (cheapest path)
- [ ] `pnpm tsc --noEmit` passes

## Success Criteria

- All 4 routes callable via `curl` and return valid JSON.
- Missing API key server-side → clean 500 with message `missing FREEPIK_API_KEY`.
- Invalid body → 400 with zod error array.
- `curl` to improve-prompt returns a real `task_id` — verifies auth + cheapest endpoint.
- No TypeScript errors.

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Freepik schema drift breaks zod parse | Schemas are thin — only fields we actually use are validated; unknowns are passed through via `.passthrough()` |
| Route handler accidentally leaks env key into response body | Every error mapper uses an allowlist of fields (status, code, message) |
| `tier` is a free-form string leading to path injection | `routeInputSchema` enforces `z.enum(['pro', 'std'])` |

## Security Considerations

- API key read **once** per request from `process.env` — never cached in a client bundle.
- Reject requests without `Content-Type: application/json` on POST routes.
- Do not echo the incoming body in error responses (could leak PII if user types secrets into prompts).
- Rate limiting is out of scope for v1 (local tool) — note in docs.

## Next Steps

Proceed to [phase-03-generator-form-ui.md](./phase-03-generator-form-ui.md): build the form that will call these routes.
