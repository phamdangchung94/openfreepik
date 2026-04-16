# Plan: Kling 3.0 Video Generator UI (Freepik API)

**Created:** 2026-04-15
**Owner:** @phamdangchung
**Status:** ✅ Approved — implementing
**Goal:** Build a polished local web interface that generates videos via Freepik's Kling 3 API, with integrated Improve Prompt enhancement, **local image upload**, and a **batch processing pipeline** (upload multiple images, custom prompt per image, configurable concurrency). First iteration focuses *only* on Kling 3; architecture is designed so additional models can be plugged in later.

---

## 1. Context

- Freepik has just released **Kling 3** (`kling-v3-pro` / `kling-v3-std`) — the newest generation video model with T2V, I2V, multi-shot (up to 6 scenes), first/end frame control, element consistency, and native audio.
- Freepik also exposes a separate **Improve Prompt** endpoint that rewrites a rough idea into a rich prompt optimized for image or video generation — async, task-based.
- Both APIs are async (task-based) and require the header `x-freepik-api-key`.
- User has a valid API key (`FPSX…`) stored server-side via `.env.local`.
- User wants a clean foundation that will scale to more models **after** Kling is working end-to-end.

## 2. Non-goals (explicitly out of scope for v1)

- Other video models (Hailuo, Seedance, Runway, WAN, Pixverse, LTX) — phase 2 expansion.
- User authentication / multi-tenant accounts.
- Server database (we persist history to `localStorage`).
- Production deployment pipelines — this is a local/dev tool first.
- Billing dashboards, usage analytics.
- Webhook receiver (we poll; webhook support is a stretch goal in Phase 6).

## 3. Tech Stack

| Concern | Choice | Reason |
|---|---|---|
| Framework | **Next.js 15 (App Router)** + TypeScript | File-based routing, server-side API proxy to hide API key, React Server Components where useful |
| Styling | **Tailwind CSS v4** + **shadcn/ui** (Radix) | Polished, accessible primitives; matches "giao diện hoàn thiện" request |
| State | **Zustand** (persisted) | Dead-simple, works for task history w/ localStorage middleware |
| Fetch / polling | Native `fetch` + a custom `useTaskPolling` hook (exponential back-off, max attempts) | SWR/React Query is overkill for a handful of endpoints |
| Icons | **lucide-react** | Default for shadcn |
| Notifications | **sonner** (shadcn toast) | Lightweight, shadcn-native |
| Form validation | **zod** + **react-hook-form** | Strong types shared between client/server |
| Video player | Native `<video>` (HTML5) | Freepik returns plain MP4 URLs — no need for hls.js etc. |
| Package manager | **pnpm** | Fast, predictable lockfile |
| Node | `>= 20 LTS` | Next.js 15 requirement |

## 4. High-level Architecture

```
Browser (React UI)
    │  (client calls same-origin routes — API key never exposed)
    ▼
Next.js route handlers  (app/api/freepik/**)
    │  (adds x-freepik-api-key header from env)
    ▼
Freepik API  (https://api.freepik.com/v1/ai/*)
```

**Key design decisions**

1. **API key lives only server-side.** Every call to Freepik goes through a Next.js route handler in `app/api/freepik/**`. The browser never sees the key.
2. **Typed Freepik client.** One `lib/freepik/client.ts` wraps all endpoints with TypeScript types generated from the OpenAPI specs. Each feature module imports from this client.
3. **Polling, not webhooks (v1).** The UI spins up a `useTaskPolling` hook with 2s interval, back-off to 10s, and a 10-minute ceiling. Webhook receiver is deferred to Phase 6 stretch.
4. **Model abstraction ready from day 1.** Even though only Kling 3 ships in v1, the generator form reads a `modelId` prop and the form schema is derived from a per-model config. Adding a new model = new config + new route handler.
5. **Local-first storage.** Task history (task_id, params snapshot, result URL, timestamps) goes to `localStorage` via Zustand persist. No DB dependency in v1.
6. **Image upload + hosting.** Users upload images from local filesystem. Our Next.js API route (`/api/upload`) receives the file, converts to **base64 data URI**, and attempts to pass it directly. If Freepik rejects data URIs for Kling v3's `start_image_url`, we fall back to uploading via a free image hosting API (ImgBB or similar). The upload service is abstracted behind an `ImageHostService` interface so backends can be swapped.
7. **Batch processing pipeline.** Users can upload **multiple images at once**, assign a **custom prompt per image** (or use a shared default), and configure **batch size** (concurrency: 1–5). A queue processor runs N jobs in parallel; as each finishes, the next pending item starts. Pause/cancel controls available. All batch items share the Zustand task store and show real-time status.

## 5. Feature Matrix (v1)

| Feature | Phase | Notes |
|---|---|---|
| Kling 3 Pro — text-to-video | P3 | Primary path |
| Kling 3 Std — text-to-video | P3 | Toggle Pro↔Std |
| Kling 3 — image-to-video (start frame) | P3 | URL input OR local upload |
| Kling 3 — start + end frame transition | P3 | URL input OR local upload |
| **Local image upload (single)** | P2/P3 | Upload → base64 → Freepik |
| **Batch upload (multiple images)** | P3/P5 | Drag & drop zone, thumbnails |
| **Per-image custom prompt** | P3 | Editable per batch item |
| **Batch size / concurrency control** | P5 | Slider 1–5, run until queue empty |
| **Batch progress tracking** | P5 | Overall + per-item status |
| Aspect ratio picker (16:9 / 9:16 / 1:1) | P3 | Visual buttons |
| Duration control (3–15s) | P3 | Slider + numeric |
| CFG scale (0–1) | P3 | Slider with tooltip |
| Negative prompt | P3 | Optional |
| Generate audio toggle | P3 | Default on |
| Multi-shot editor (up to 6 scenes) | P3 | Collapsible |
| Intelligent vs customize shot type | P3 | Radio |
| Element references (character consistency) | P3 (basic) | Optional advanced panel |
| **Improve Prompt** | P4 | Loader + replace, with undo |
| Task submission + polling | P5 | Created→InProgress→Completed/Failed |
| Task history sidebar (persistent) | P5 | Replay params, re-run, delete |
| Inline video player + download | P5 | MP4 `<video>` with download btn |
| Toast error handling | P6 | 400/401/500/503 mapped |
| Loading skeletons & empty states | P6 |  |
| Keyboard shortcut ⌘+Enter to generate | P6 | Nice polish |
| Dark mode (default) | P1 | shadcn dark theme |

## 6. Phase Breakdown

| # | Phase | File | Status | Depends on |
|---|---|---|---|---|
| 1 | Foundation & Setup | [phase-01-foundation-and-setup.md](./phase-01-foundation-and-setup.md) | ☐ | — |
| 2 | Freepik API Layer | [phase-02-freepik-api-layer.md](./phase-02-freepik-api-layer.md) | ☐ | 1 |
| 3 | Generator Form UI | [phase-03-generator-form-ui.md](./phase-03-generator-form-ui.md) | ☐ | 2 |
| 4 | Improve Prompt Integration | [phase-04-improve-prompt-integration.md](./phase-04-improve-prompt-integration.md) | ☐ | 2, 3 |
| 5 | Task Polling, History & Player | [phase-05-task-polling-history-player.md](./phase-05-task-polling-history-player.md) | ☐ | 2, 3 |
| 6 | Polish, Error Handling & QA | [phase-06-polish-error-handling-qa.md](./phase-06-polish-error-handling-qa.md) | ☐ | all |

## 7. Definition of Done (v1)

- [ ] User can enter a text prompt and generate a Kling 3 video end-to-end (Pro & Std).
- [ ] User can switch to I2V mode, paste start (and optionally end) image URL, and generate.
- [ ] User can click "Improve Prompt" and see the prompt replaced with an enhanced version.
- [ ] Multi-shot mode lets the user define up to 6 scenes with prompts + durations (total ≤ 15s).
- [ ] Task history persists across reloads; completed videos are playable inline.
- [ ] API key is never exposed in the browser (verified via DevTools Network tab).
- [ ] All 400/401/500/503 Freepik errors surface as readable toasts, not console stack traces.
- [ ] Dev server starts cleanly: `pnpm dev` → http://localhost:3000 with no TypeScript errors.
- [ ] Dark mode toggle works.
- [ ] README has a 30-second "how to use" section.

## 8. Risks & Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Freepik API key has insufficient credits / wrong plan for Kling 3 Pro | Medium | Phase 1 sanity-call hits `GET /v1/ai/video/kling-v3` (list) — cheap/free — to verify auth before any paid generation |
| Task polling spins forever on a stuck job | Low | 10-minute ceiling + cancel button in UI |
| Image URL not publicly accessible from Freepik's servers | High | Clear UX copy: "must be a publicly reachable HTTPS URL"; provide upload helper w/ caveats in docs |
| 2500-char prompt limit hit by Improve Prompt output | Low | Enforce clientside counter + truncate with warning |
| API schema changes | Low | Types centralized in `lib/freepik/types.ts`; any breaking change is one-file update |
| Generation takes >2 min | Medium | Polling handles it; toast "Still working…" at 60s; let user close tab, resume from history |

## 9. Research References (full content cached in `research/`)

- [Kling 3 overview](https://docs.freepik.com/api-reference/video/kling-v3/overview) — endpoints, features, FAQ
- [Kling 3 Pro generate](https://docs.freepik.com/api-reference/video/kling-v3/generate-pro) — full OpenAPI schema
- [Kling 3 task status](https://docs.freepik.com/api-reference/video/kling-v3/task-by-id) — polling response shape
- [Improve Prompt](https://docs.freepik.com/api-reference/improve-prompt/post-improve-prompt) — request + examples
- [Freepik authentication](https://docs.freepik.com/authentication) — `x-freepik-api-key` header
- Kling 3.0 marketing page — [freepik.com/kling-3-0](https://www.freepik.com/kling-3-0)

## 10. After v1 — Expansion Roadmap (not in this plan)

Once Kling 3 ships, the model abstraction makes it straightforward to add:

1. Kling 3 **Omni** variants (reference-video motion guidance)
2. Hailuo 02 / 2.3 (1080p, cheap)
3. Seedance Pro 1080p
4. Runway Gen 4 Turbo + Runway Act Two
5. WAN 2.5 / 2.6 (text-to-video)
6. Pixverse, LTX-2 Pro
7. Text-to-video for Kling via direct T2V mode

Expansion will reuse: API proxy pattern, polling hook, task store, video player, history sidebar. Only new per-model: config + form schema + API route handler.
