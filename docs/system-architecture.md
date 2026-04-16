# OpenFreepik - System Architecture & Project Documentation

## Overview

**OpenFreepik** is a single-page web application for generating AI videos using the **Kling V3 model** via the **Freepik API**. Built with Next.js 16 (App Router + Turbopack).

| Stack | Version | Notes |
|-------|---------|-------|
| Next.js | 16.2.4 | App Router, Turbopack dev |
| React | 19.2.4 | |
| TypeScript | 5.x | Strict mode, `noUncheckedIndexedAccess` |
| Tailwind CSS | v4 | OKLCH color tokens |
| shadcn/ui | v4 (base-nova) | Uses base-ui, NOT Radix |
| Zustand | 5.0.12 | State management + localStorage persist |
| react-hook-form | 7.72.1 | Custom Zod v4 resolver |
| Zod | 4.3.6 (v4) | Schema validation |

---

## Core Features

### 1. Text-to-Video (T2V)
User writes a text prompt, selects video settings (aspect ratio, duration, quality tier), and generates a video.

### 2. Image-to-Video (I2V)
User provides a source image (upload from filesystem or paste URL), optionally with a text prompt, to animate the image into a video.

### 3. Batch Processing
Upload multiple images at once. Each image gets its own customizable prompt. All generate concurrently with configurable parallelism (1-10).

### 4. AI Prompt Enhancement
Prompts can be automatically improved using Freepik's Improve Prompt API before generation. Available as:
- Manual: "Improve" button in the prompt field opens a dialog
- Automatic: "Auto-enhance" toggle for batch processing

> **Note:** The Improve Prompt API is **text-only** -- it does NOT read/analyze images.

### 5. Per-User API Key
Each user provides their own Freepik API key. The key is stored in localStorage (persisted via Zustand) and sent as `x-api-key` header with every API request. No server-side API key needed — fully self-service.

### 6. Task History
All generation tasks are persisted in localStorage via Zustand. Users can browse history, replay previews, and delete old tasks.

### 7. Multi-Shot Mode
Create up to 6 scenes with individual prompts and durations (max 15s total combined).

### 8. Regenerate
Click "Regenerate" on any completed/failed task in the Preview panel to reload the prompt, mode, and source image back into the form for editing and re-submission.

### 9. Parallel Generation (Non-blocking)
The Generate button is **never disabled**. Users can submit multiple generation requests simultaneously. Each request runs independently as a fire-and-forget async worker. A badge shows the number of currently running tasks.

### 10. Orphan Task Recovery
When the page is reloaded or the tab is closed during generation, polling stops but tasks remain IN_PROGRESS in localStorage. On next page load, `useOrphanRecovery` detects these orphaned tasks and automatically resumes polling to fetch their results from Freepik.

---

## Architecture Diagram

```
Browser (Client)
=================
  page.tsx (3-column layout)
  |
  |-- GeneratorForm ---------> react-hook-form + Zod v4
  |   |-- ModeToggle          (T2V / I2V switch)
  |   |-- PromptField         (textarea + char counter)
  |   |-- BatchUploadZone     (drag-drop, per-image prompts)
  |   |-- Video Settings      (aspect, duration, quality, audio)
  |   |-- Advanced Settings   (cfg_scale, negative prompt)
  |   |-- Multi-Shot Editor   (up to 6 scenes)
  |   +-- Submit Button       (never disabled, shows "N running" badge)
  |
  |-- PreviewPanel ----------> Shows active task video/status + Regenerate button
  |-- HistorySidebar ---------> Lists all tasks (newest first)
  |
  Hooks:
  |-- useGenerateVideo -------> Fire-and-forget parallel generation
  |-- useBatchQueue ----------> Concurrent batch with queue (max 10 active)
  |-- useImprovePrompt -------> AI prompt enhancement
  |-- useOrphanRecovery ------> Resume orphaned tasks on page load
  |-- useKeyboardShortcuts ---> Cmd+Enter, Cmd+I
  |
  Store:
  +-- useTaskStore (Zustand) -> Tasks, queue, settings (localStorage)

         |                    |                    |
         v                    v                    v
  /api/freepik/kling-v3  /api/freepik/improve-prompt  /api/upload

Server (Next.js API Routes)
============================
  All routes read x-api-key header from client request
  API key stored in localStorage (per-user), sent via header

         |
         v
  Freepik REST API (https://api.freepik.com)
  |-- POST /v1/ai/video/kling-v3-{pro|std}   (create video task)
  |-- GET  /v1/ai/video/kling-v3/{taskId}     (poll status)
  |-- POST /v1/ai/improve-prompt              (enhance prompt)
  +-- GET  /v1/ai/improve-prompt/{taskId}     (poll enhanced text)

External Services
==================
  litterbox.catbox.moe  (temporary image hosting, 24h TTL)
```

---

## Data Flow

### Single Video Generation (Fire-and-Forget)

```
1. User fills form -> clicks "Generate Video" (or Cmd+Enter)
   - Button is NEVER disabled — user can click again immediately
2. react-hook-form validates via Zod v4 schema
3. toApiParams() maps form values to KlingV3GenerateParams
4. useGenerateVideo.generate():
   a. Creates local task in Zustand store (status: CREATED)
   b. Spawns async worker (fire-and-forget):
      - POST /api/freepik/kling-v3 { params, tier }
      - Server calls freepik.klingV3.generate() -> returns task_id
      - Store updated (status: IN_PROGRESS, taskId set)
      - pollUntilDone() loops with progressive backoff
   c. Returns localId immediately — does NOT block
5. pollUntilDone() polls GET /api/freepik/kling-v3/{taskId}
   - Interval: starts 2s, increases +500ms per attempt, max 10s
   - Timeout: 600s (10 minutes)
6. On COMPLETED:
   a. Store updated with videoUrl
   b. PreviewPanel shows video player + Download button
7. On FAILED: Store updated with error message
8. Multiple generate() calls run in parallel — each is independent
```

### Batch Processing

```
1. User uploads images via BatchUploadZone
   a. Files sent to POST /api/upload (multipart)
   b. Server uploads to litterbox.catbox.moe (no local save — serverless compatible)
   c. Returns { publicUrl, dataUri, filename }
   d. Each image becomes a BatchItem with publicUrl as imageUrl
2. User customizes per-image prompts, sets concurrency (1-10)
3. User clicks "Generate N Videos"
4. useBatchQueue.startBatch():
   a. Resets activeRef to 0, clears stale queue
   b. Creates N tasks in Zustand store (all status: CREATED)
   c. Enqueues all task IDs
   d. fillSlots() starts up to `concurrency` parallel workers
5. Each worker (runTask):
   a. If autoEnhance: POST /api/freepik/improve-prompt -> poll -> use enhanced prompt
   b. POST /api/freepik/kling-v3 with image URL + prompt
   c. pollTask() with progressive backoff until COMPLETED/FAILED
   d. On completion (success or fail): activeRef--, fillSlotsRef.current() to start next queued item
6. Queue overflow: if N > concurrency, excess tasks wait in queue
   - Example: 25 images + concurrency 10 -> 10 run immediately, 15 queued
   - As each slot frees up, next queued task starts automatically
7. Processing ends when queue is empty and all active workers finish
```

### Image Upload Pipeline

```
1. Client: File dropped/selected in BatchUploadZone
2. Client: FormData with file(s) sent to POST /api/upload
3. Server (/api/upload):
   a. Validates: image type (JPG/PNG/WebP), max 10MB, max 20 files
   b. Generates UUID filename
   c. Uploads to litterbox.catbox.moe (POST multipart, 24h expiry)
   d. Returns: { publicUrl, dataUri, filename } — no local save (serverless)
4. Client: Uses publicUrl as imageUrl for Freepik API
5. Freepik servers fetch the image via the public URL
```

### Prompt Enhancement

```
1. Manual: User clicks "Improve" button in PromptField
   -> Opens ImprovePromptDialog
   -> useImprovePrompt.improve(prompt) auto-triggers
   -> POST /api/freepik/improve-prompt { prompt, type: "video", language: "en" }
   -> Poll GET /api/freepik/improve-prompt/{taskId} every 1.5s (max 60s)
   -> Shows result in dialog
   -> User clicks "Use This Prompt" -> setValue("prompt", improved)

2. Auto (batch): autoEnhance toggle ON in BatchSettings
   -> Each batch item's prompt is enhanced before video generation
   -> Falls back to original prompt if enhancement fails
```

### Orphan Task Recovery

```
Problem:
  Page reload / tab close during generation -> polling loop killed
  -> Tasks stuck IN_PROGRESS in localStorage forever

Solution (useOrphanRecovery):
1. Runs ONCE on app mount (module-level guard, survives React Strict Mode)
2. Waits 500ms for Zustand to hydrate from localStorage
3. Scans store for tasks with status IN_PROGRESS or CREATED that have a taskId
4. For each orphaned task: resumes pollUntilDone() independently
   - Freepik may already have COMPLETED -> instant resolution
   - Still IN_PROGRESS -> continues polling with backoff
5. Tasks with CREATED status but NO taskId (never submitted) -> marked FAILED
6. Auto-save triggers if the recovered task completed with a video URL
```

### Regenerate Flow

```
1. User views a completed/failed task in PreviewPanel
2. Clicks "Regenerate" button
3. GeneratorFormHandle.loadTask() is called:
   a. Sets form mode (t2v or i2v)
   b. Sets prompt text
   c. If I2V: sets start_image_url
   d. Scrolls page to top
4. User edits prompt as needed
5. Clicks "Generate Video" to create new task
```

---

## File Structure

```
src/
├── app/
│   ├── layout.tsx                    # Root layout (fonts, theme, toaster)
│   ├── page.tsx                      # Main page (3-column grid)
│   ├── globals.css                   # Tailwind v4 + OKLCH tokens
│   └── api/
│       ├── freepik/
│       │   ├── kling-v3/
│       │   │   ├── route.ts          # POST: create video task
│       │   │   └── [taskId]/route.ts # GET: poll task status
│       │   └── improve-prompt/
│       │       ├── route.ts          # POST: create improve task
│       │       └── [taskId]/route.ts # GET: poll improve status
│       └── upload/route.ts           # POST: upload images
│
├── lib/
│   ├── freepik/                      # API client layer
│   │   ├── index.ts                  # Barrel export
│   │   ├── types.ts                  # Shared types (TaskStatus, params)
│   │   ├── base-client.ts            # HTTP wrapper (auth, errors)
│   │   ├── errors.ts                 # FreepikApiError class
│   │   ├── kling-v3.ts               # generate(), getTask(), listTasks()
│   │   ├── kling-v3-schema.ts        # Zod validation for kling routes
│   │   ├── improve-prompt.ts         # create(), getTask()
│   │   ├── improve-prompt-schema.ts  # Zod validation for improve routes
│   │   └── route-helpers.ts          # errorToResponse(), parseJsonBody(), extractApiKey()
│   │
│   ├── form/                         # Form utilities
│   │   ├── generator-schema.ts       # Zod v4 form schema + BatchItem type
│   │   ├── defaults.ts               # FORM_DEFAULTS constant
│   │   ├── to-api-params.ts          # toApiParams(), toBatchApiParams()
│   │   └── zod-resolver.ts           # Custom resolver for zod v4 + RHF
│   │
│   ├── api-headers.ts                # getApiHeaders() — client-side API key helper
│   ├── upload/
│   │   └── image-host.ts             # litterbox upload (serverless, no local save)
│   │
│   └── utils.ts                      # cn() class merge utility
│
├── store/
│   └── task-store.ts                 # Zustand store (tasks, queue, settings)
│
├── hooks/
│   ├── use-task-polling.ts           # Generic polling with backoff
│   ├── use-generate-video.ts         # Fire-and-forget parallel generation
│   ├── use-batch-queue.ts            # Concurrent batch queue (fillSlots pattern)
│   ├── use-improve-prompt.ts         # AI prompt enhancement
│   ├── use-orphan-recovery.ts        # Resume orphaned tasks on page load
│   └── use-keyboard-shortcuts.ts     # Cmd+Enter, Cmd+I
│
└── components/
    ├── generator/                    # Form controls
    │   ├── generator-form.tsx        # Main form (forwardRef + imperative handle)
    │   ├── mode-toggle.tsx           # T2V / I2V switch
    │   ├── prompt-field.tsx          # Main prompt textarea
    │   ├── negative-prompt-field.tsx  # Negative prompt
    │   ├── image-url-field.tsx       # URL input for I2V
    │   ├── aspect-ratio-picker.tsx   # 16:9 / 9:16 / 1:1
    │   ├── duration-slider.tsx       # 3-15 seconds
    │   ├── quality-tier-picker.tsx   # Pro / Standard
    │   ├── cfg-scale-slider.tsx      # 0-1 prompt adherence
    │   ├── generate-audio-switch.tsx  # Audio on/off
    │   ├── multi-shot-editor.tsx     # Multi-scene editor
    │   └── improve-prompt-dialog.tsx # AI improve dialog
    │
    ├── batch/
    │   ├── batch-upload-zone.tsx     # Drag-drop + image list
    │   └── batch-settings.tsx        # Concurrency (1-10) + toggles
    │
    ├── preview/
    │   ├── preview-panel.tsx         # Video preview + Regenerate button
    │   ├── video-player.tsx          # HTML5 video element
    │   └── status-badge.tsx          # Task status indicator
    │
    ├── history/
    │   ├── history-sidebar.tsx       # Task list + progress
    │   └── history-item.tsx          # Individual task card
    │
    ├── layout/
    │   ├── app-header.tsx            # Top navigation bar + API key input
    │   ├── api-key-input.tsx         # Per-user API key input field
    │   ├── theme-provider.tsx        # next-themes wrapper
    │   └── theme-toggle.tsx          # Light/dark toggle
    │
    └── ui/                           # 20 shadcn/ui components
        ├── button.tsx, card.tsx, dialog.tsx, ...
```

---

## State Management (Zustand)

### Store: `useTaskStore`

```typescript
interface TaskState {
  // Task records
  tasks: Record<string, GenerationTask>;
  activeTaskId: string | null;
  apiKey: string;             // Per-user Freepik API key

  // Batch queue
  queue: string[];            // IDs waiting to process
  concurrency: number;        // 1-10 (default: 5)
  isProcessing: boolean;

  // Feature toggles (persisted)
  autoEnhance: boolean;       // default: false
}
```

### GenerationTask

```typescript
interface GenerationTask {
  id: string;                              // Local UUID
  taskId: string | null;                   // Freepik API task ID
  status: GenerationTaskStatus;            // IDLE|CREATED|IN_PROGRESS|COMPLETED|FAILED|TIMEOUT
  prompt: string;
  mode: "t2v" | "i2v";
  tier: "pro" | "std";
  createdAt: number;                       // timestamp
  updatedAt: number;                       // timestamp
  videoUrl: string | null;                 // Remote video URL from Freepik
  thumbnailUrl: string | null;
  imageUrl: string | null;                 // Source image for I2V
  error: string | null;
}
```

### Persistence
- **Key:** `openfreepik-tasks` in localStorage
- **Persists:** tasks, activeTaskId, apiKey, concurrency, autoEnhance, queue
- **Does NOT persist:** isProcessing (runtime-only)

---

## API Reference

### Freepik API Endpoints (proxied)

| Client Route | Method | Freepik API | Purpose |
|---|---|---|---|
| `/api/freepik/kling-v3` | POST | `/v1/ai/video/kling-v3-{pro\|std}` | Create video task |
| `/api/freepik/kling-v3/[taskId]` | GET | `/v1/ai/video/kling-v3/{taskId}` | Poll task status |
| `/api/freepik/improve-prompt` | POST | `/v1/ai/improve-prompt` | Create improve task |
| `/api/freepik/improve-prompt/[taskId]` | GET | `/v1/ai/improve-prompt/{taskId}` | Poll improve status |

### Internal API Endpoints

| Route | Method | Purpose |
|---|---|---|
| `/api/upload` | POST | Upload images (multipart) -> public URL via litterbox |

### Kling V3 Generate Parameters

```typescript
interface KlingV3GenerateParams {
  prompt?: string;                          // Max 2500 chars
  negative_prompt?: string;                 // Max 2500 chars
  start_image_url?: string;                 // Required for I2V
  end_image_url?: string;                   // Optional end frame
  aspect_ratio?: "16:9" | "9:16" | "1:1";  // Default: 16:9
  duration?: "3"|"4"|...|"15";              // Default: 5 seconds
  cfg_scale?: number;                       // 0-1, default 0.5
  generate_audio?: boolean;                 // Default: true
  multi_shot?: boolean;
  shot_type?: "customize" | "intelligent";
  multi_prompt?: { prompt: string; duration: string }[];  // Max 6 scenes
  elements?: { frontal_image_url: string; reference_image_urls: string[] }[];
  webhook_url?: string;
}
```

### Freepik API Rate Limits

| Layer | Limit |
|---|---|
| Per-IP throttle | 50 hits/s (5s window), 10 hits/s (2min avg) |
| Daily (Free tier) | 5-20 RPD for Kling endpoints |
| Daily (Premium tier) | 50 RPD for Kling endpoints |
| Concurrent tasks | Not explicitly documented |

> No hard concurrent task limit is documented. Default concurrency is 5, max configurable to 10. 429 responses are handled but no retry-with-backoff is implemented.

### Multi-Shot: Reference Images

Multi-shot does **NOT** support per-shot reference images. The API structure is:
- `multi_prompt[].prompt` + `multi_prompt[].duration` -- per shot (text only)
- `elements[]` -- **global** character/object references (applies to all shots)
- `start_image_url` / `end_image_url` -- **global** (first frame of first shot / last frame of last shot)

To maintain visual consistency across shots, define `elements` globally with `frontal_image_url` + `reference_image_urls`, then reference them in each shot's prompt text using `@Element1`, `@Element2`, etc.

---

## Polling Strategy

```
Attempt 1:  wait 2.0s
Attempt 2:  wait 2.5s
Attempt 3:  wait 3.0s
Attempt 4:  wait 3.5s
...
Attempt 16: wait 10.0s  (capped)
Attempt 17: wait 10.0s
...
Timeout: 600s (10 minutes) total
```

Formula: `delay = min(2000 + attempt * 500, 10000)` milliseconds

---

## Concurrency Model

### Single Generation (useGenerateVideo)

```
Each generate() call spawns an independent async worker:

generate() call 1 -> worker A (POST -> poll -> complete)
generate() call 2 -> worker B (POST -> poll -> complete)
generate() call 3 -> worker C (POST -> poll -> complete)
...
All run in parallel. No blocking. No queue. No limit.
Button shows badge: "3 running"
```

### Batch Queue (useBatchQueue)

```
Queue: [A, B, C, ..., N]    Concurrency: 10

Step 1: fillSlots()
  -> Active: [A, B, C, D, E, F, G, H, I, J]    Queue: [K, ..., N]
  -> 10 workers spawned simultaneously

Step 2: A completes -> activeRef--, fillSlotsRef.current()
  -> Active: [B, C, D, E, F, G, H, I, J, K]    Queue: [L, ..., N]
  -> Slot refilled immediately

Step 3: continues until queue empty and all active workers finish
  -> setProcessing(false)
```

Key implementation details:
- `fillSlotsRef` pattern breaks circular `useCallback` dependency between `runTask` and `fillSlots`
- `activeRef.current = 0` reset in `startBatch` prevents stale counter from previous batch
- `useTaskStore.getState()` (imperative) for all store mutations inside async workers
- Queue items that exceed concurrency wait — `fillSlots()` auto-refills as slots free up

---

## Orphan Recovery

```
Problem:
  Page reload during generation -> polling stopped -> tasks stuck IN_PROGRESS

Timeline:
  1. User generates video -> task goes IN_PROGRESS -> saved to localStorage
  2. User closes/reloads tab -> polling async worker killed
  3. Freepik finishes generating -> COMPLETED on server
  4. User reopens page -> task still shows IN_PROGRESS locally

Solution (useOrphanRecovery hook):
  1. Module-level guard (let recovered = false) -> runs exactly once
  2. useEffect fires 500ms after mount (wait for Zustand hydration)
  3. Finds all tasks where:
     - status = IN_PROGRESS or CREATED
     - taskId is not null (was submitted to API)
  4. For each: spawns pollUntilDone() to check Freepik status
     - Usually resolves instantly (Freepik already COMPLETED)
     - If still processing: continues polling with normal backoff
  5. Tasks with CREATED + no taskId: marked FAILED (interrupted before API call)
```

---

## Security Model

- **API key** stored in user's localStorage, sent via `x-api-key` header per request
- Each user provides their own Freepik API key — no shared server key
- Server API routes extract `x-api-key` from request header and forward to Freepik
- API key is masked by default in the header input (password field with toggle)
- Image upload validated server-side (type, size limits)
- No server-side `.env.local` API key needed for deployment

---

## Key Technical Decisions

### 1. Custom Zod Resolver
`@hookform/resolvers` has version detection issues with Zod v4. Built a custom `customZodResolver()` that parses values and maps Zod issues to react-hook-form format.

### 2. shadcn/ui v4 (base-nova) != Radix
Components use base-ui patterns. Key difference: **no `asChild` prop** on DialogTrigger -- use `render` prop instead.

### 3. litterbox.catbox.moe for Image Hosting
Freepik API needs publicly accessible URLs for source images. Uploaded images are sent to litterbox (free, no auth, 24h expiry) to get public URLs. For production: swap to S3/R2/Cloudinary.

### 4. Imperative Store Access
All async operations (polling, batch workers, orphan recovery) use `useTaskStore.getState()` instead of reactive hooks to prevent infinite re-render loops. Reactive selectors are only used for values that drive UI rendering.

### 5. Batch Bypass Validation
In batch mode, form submission skips Zod validation because `start_image_url` is empty (images are in batch items, not the form field). Batch items carry their own `imageUrl`.

### 6. Fire-and-Forget Generation
`useGenerateVideo` spawns independent async workers per `generate()` call. No shared `pollingTaskId` state, no blocking `isGenerating` boolean. The button is never disabled — user can spam Generate freely.

### 7. fillSlotsRef Pattern
Batch queue has a circular dependency: `runTask` calls `fillSlots` on completion, `fillSlots` calls `runTask` to start new workers. Solved by storing `fillSlots` in a ref (`fillSlotsRef`) and having `runTask` call `fillSlotsRef.current()` — always gets the latest version.

### 8. GeneratorFormHandle (useImperativeHandle)
The form exposes `submit()` and `loadTask()` methods via `useImperativeHandle`, enabling:
- Keyboard shortcuts to trigger submit from outside the form
- Regenerate button to load a previous task's prompt/mode/image back into the form

---

## Keyboard Shortcuts

| Shortcut | Action | Condition |
|---|---|---|
| `Cmd/Ctrl + Enter` | Submit form (generate video) | Always enabled |
| `Cmd/Ctrl + I` | Open improve prompt dialog | Not in textarea |

---

## Environment Setup

```bash
# 1. Install dependencies
pnpm install

# 2. Start dev server (no .env.local needed — API key is per-user)
pnpm dev          # http://localhost:3000

# 3. Enter your Freepik API key in the header bar
# 4. Type check
pnpm typecheck

# 5. Production build
pnpm build && pnpm start

# 6. Deploy to Vercel (free tier)
npx vercel
```

---

## File Storage Locations

| Type | Path | Lifetime |
|---|---|---|
| Uploaded images (remote) | `https://litter.catbox.moe/*` | 24 hours |
| Generated videos (remote) | Freepik CDN URL in task result | Unknown (Freepik-managed) |
| Task history + API key | `localStorage["openfreepik-tasks"]` | Until browser clear |

> No local file storage — fully serverless compatible (Vercel free tier).

---

## Known Issues & Bug Fixes Log

### Fixed: Tasks stuck IN_PROGRESS after page reload
**Cause:** Polling loops are client-side async workers. When the page reloads, workers are killed but tasks remain IN_PROGRESS in localStorage forever.
**Fix:** `useOrphanRecovery` hook resumes polling on page load for orphaned tasks.

### Fixed: Batch queue only processing 1 task at a time
**Cause 1:** `activeRef.current` not reset to 0 in `startBatch` — stale counter from cancelled/interrupted batch reduced available slots to 0.
**Cause 2:** Circular `useCallback` dependency between `runTask` and `fillSlots` caused stale closure references.
**Fix:** Reset `activeRef.current = 0` in `startBatch`/`cancelBatch`. Introduced `fillSlotsRef` pattern to break circular dependency.

### Fixed: Generate button disabled during generation
**Cause:** `useGenerateVideo` used a single `pollingTaskId` state — only tracked one task. `isGenerating` boolean blocked the button.
**Fix:** Rewrote to fire-and-forget pattern. Each `generate()` spawns an independent async worker. No shared blocking state. Button shows "N running" badge instead.

### Fixed: Infinite re-render loops
**Cause:** Reactive Zustand selectors (e.g., `useTaskStore((s) => s.tasks)`) inside hooks that also mutated the store → mutate → re-render → mutate → loop.
**Fix:** All async operations use `useTaskStore.getState()` (imperative, non-reactive) for mutations. Reactive selectors only for render-driving values.

### Fixed: I2V batch sends data URI instead of public URL
**Cause:** Freepik API requires publicly accessible image URLs, not base64 data URIs.
**Fix:** Images uploaded to litterbox.catbox.moe (free, 24h TTL) to get public URLs.
