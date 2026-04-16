# Phase 5 — Task Polling, History & Video Player

**Status:** ☐ Not started
**Priority:** Critical (this is the core loop)
**Depends on:** Phase 2, Phase 3, Phase 4

## Overview

Close the loop. The generator form now actually submits to Freepik, polls for the result, shows a live status badge, and plays the generated MP4 inline. A persistent history sidebar lets users re-run or revisit any previous generation across browser sessions.

## Key Insights

- Kling 3 generation is slow: typical 30–120s for a 5s video, longer for 15s multi-shot. Polling interval needs back-off (2s → 5s → 10s) to stay gentle on the API.
- Re-running the same params is a very common need during prompt iteration — history must make this one-click.
- We persist to `localStorage` via Zustand's `persist` middleware. No server DB.
- A single "active task" state drives: preview panel, status badge, polling hook, disable-generate-button. Other history items are inert until clicked.
- When a user clicks a history item, the preview panel shows that item; if it's still `IN_PROGRESS`, we resume polling for it.
- On page load, any tasks that were `CREATED` / `IN_PROGRESS` automatically resume polling (great UX — you can close the tab and come back).

## Requirements

### Functional
- Submitting the generator form (Phase 3):
  1. Calls `POST /api/freepik/kling-v3` with the param object + `tier`.
  2. On success, pushes a new `GenerationTask` to the Zustand store and sets it as **active**.
  3. Closes/locks the form — "Generation in progress…" banner replaces the generate button with a Cancel option.
  4. Polling starts automatically via `useTaskPolling`.
  5. The preview panel shows a skeleton with a status badge (`CREATED` → `IN_PROGRESS` → `COMPLETED`/`FAILED`).
  6. On `COMPLETED`, the `<video>` element loads the result URL with controls; confetti optional.
  7. On `FAILED`, shows a retry button that re-submits with the same params.
- **Task history sidebar** (right column on desktop, drawer on mobile):
  - Lists all tasks sorted by newest first.
  - Each row: thumbnail (poster from video), tier badge, status badge, time, duration, prompt preview (truncated).
  - Click → loads that task into the preview panel.
  - Right-click / menu: **Re-run with same params**, **Copy task_id**, **Delete**.
  - Clear-all button with confirmation.
- **Video player**:
  - Native `<video controls loop>` tag.
  - Below: Download button, open in new tab, copy URL button.
- **Resume on reload**: on app mount, iterate through persisted tasks. For any with status `CREATED` or `IN_PROGRESS`, resume polling (one polling hook instance per active task — rare in practice since we only generate one at a time in the UI, but the store must support it).

### Non-functional
- Task store file < 200 LOC.
- Video player component < 150 LOC.
- No memory leaks — cancel polling on unmount, on "make this task inactive", or on delete.
- Every Freepik request is still proxied — no fetch to `api.freepik.com` from the browser.

## Architecture

```
src/
├── store/
│   ├── task-store.ts                 ← Zustand + persist middleware
│   └── task-types.ts                 ← GenerationTask type
├── hooks/
│   ├── use-task-polling.ts           ← (reused from Phase 4)
│   ├── use-submit-generation.ts      ← POST + push to store
│   └── use-resume-polling.ts         ← on-mount hook to rehydrate active tasks
├── components/
│   ├── preview/
│   │   ├── preview-panel.tsx         ← current/selected task view
│   │   ├── status-badge.tsx
│   │   ├── generation-skeleton.tsx   ← animated placeholder while CREATED/IN_PROGRESS
│   │   ├── video-player.tsx
│   │   └── video-actions.tsx         ← download/copy/open
│   └── history/
│       ├── history-sidebar.tsx       ← list + clear button
│       ├── history-item.tsx          ← single row
│       └── history-item-menu.tsx     ← context menu
└── lib/
    └── tasks/
        ├── generation-task.ts        ← factory + helpers
        └── poster.ts                 ← generate a poster from video URL (first frame)
```

### `GenerationTask` type

```ts
interface GenerationTask {
  id: string;                          // local UUID
  freepikTaskId: string;               // from Freepik
  modelId: 'kling-v3-pro' | 'kling-v3-std';  // future-proofed union
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
  params: KlingV3GenerateParams;       // snapshot for re-run
  formValues: GeneratorFormValues;     // snapshot for re-load into form
  result?: { videoUrl: string; posterUrl?: string };
  error?: string;
}
```

### Zustand store shape

```ts
interface TaskStore {
  tasks: GenerationTask[];
  activeTaskId: string | null;
  addTask: (t: GenerationTask) => void;
  updateTask: (id: string, patch: Partial<GenerationTask>) => void;
  deleteTask: (id: string) => void;
  clearAll: () => void;
  setActive: (id: string | null) => void;
  getActive: () => GenerationTask | undefined;
  getActiveTasks: () => GenerationTask[]; // CREATED or IN_PROGRESS
}
```

Uses `persist` middleware with `name: 'kling-video-history-v1'`, serializing to localStorage.

## Related Code Files

### Create
- Everything under `src/store/`, `src/hooks/use-submit-generation.ts`, `src/hooks/use-resume-polling.ts`, `src/components/preview/*`, `src/components/history/*`, `src/lib/tasks/*`

### Modify
- `src/components/generator/generator-form.tsx` — on submit → call `useSubmitGeneration().submit(values)`; disable while any active task exists.
- `src/components/generator/generate-button.tsx` — swap between "Generate" / "Generating…" / "Cancel" states.
- `src/app/page.tsx` — three-column layout: history sidebar | form | preview panel (on desktop), stacked on mobile.
- `package.json` — add `zustand`, `uuid` (or use `crypto.randomUUID()` if targeting only modern browsers — preferred)

## Implementation Steps

1. **Install dependencies**: `pnpm add zustand`. We'll use `crypto.randomUUID()` — no extra uuid package.

2. **Write `task-store.ts`** with `persist` middleware and the shape above. Add hand-rolled rehydration: on `onRehydrateStorage`, migrate any `IN_PROGRESS` tasks to a "resume" queue.

3. **Write `use-submit-generation.ts`**:
   ```ts
   async function submit(values: GeneratorFormValues) {
     const params = toApiParams(values);
     const tier = values.tier;
     const res = await fetch('/api/freepik/kling-v3', { method: 'POST', body: JSON.stringify({ params, tier }) });
     if (!res.ok) throw ...;
     const { data } = await res.json();
     const task = createGenerationTask({ freepikTaskId: data.task_id, modelId: `kling-v3-${tier}`, params, formValues: values, status: data.status });
     store.addTask(task);
     store.setActive(task.id);
   }
   ```

4. **Polling glue**:
   - A new component `<ActivePollingWorker />` mounted once in the page. It reads `activeTaskId` from the store, pulls the task, and runs `useTaskPolling` against `GET /api/freepik/kling-v3/[freepikTaskId]`.
   - On status change → `store.updateTask(id, { status, updatedAt: now })`.
   - On COMPLETED → set `result.videoUrl = generated[0]` + generate a poster (Phase 5 extra).
   - On FAILED → set `error`.

5. **Write `use-resume-polling.ts`** — mounts once at root, iterates store.getActiveTasks(), marks the first one as active if nothing is currently active. If multiple, we pick the most recent and show a "You have N background tasks" badge in the sidebar header.

6. **Write the preview panel**:
   - If no active task → empty state ("Your video will appear here").
   - If CREATED/IN_PROGRESS → `<GenerationSkeleton />` with shimmering aspect-ratio box, big status badge, elapsed time counter, cancel button.
   - If COMPLETED → `<VideoPlayer src={result.videoUrl} />` + actions.
   - If FAILED → error block + Retry button.

7. **Write `video-player.tsx`** — thin wrapper: `<video src controls loop autoPlay={false} className="w-full rounded-lg">`. Uses the preview panel's aspect-ratio hint to avoid layout shift.

8. **Write `video-actions.tsx`** — three buttons: Download (native `<a download>` hack or fetch-as-blob fallback), Open in new tab, Copy URL (toast "Copied!").

9. **Write `poster.ts`** — accepts a video URL, uses a hidden `<video>` + `<canvas>` in the client to grab the first frame, returns a data URL. Best-effort — if it fails (CORS), skip.

10. **History sidebar**:
    - List with virtualized scroll **not** required (history will be small).
    - `<HistoryItem onClick={setActive} onReRun={reRun} onDelete={delete} />`.
    - "Re-run with same params" loads the `formValues` snapshot back into the form and submits again.

11. **Three-column layout** — on desktop (`lg:`): `grid lg:grid-cols-[320px_1fr_420px] gap-6 h-[calc(100vh-4rem)]` — each column scrolls independently. On mobile: tabs (History | Generate | Preview).

12. **Cancel**: On the preview panel skeleton, a Cancel button calls `polling.cancel()` and sets `store.setActive(null)`. The Freepik API has no cancel endpoint, so the task remains on their side but our UI forgets it. Note this in tooltip: "Canceling stops us from polling — Freepik may still charge you".

13. **Manual end-to-end test**:
    - T2V simple: generate "a cinematic shot of a cat on mars", 5s, 16:9, Pro → wait ~60s → video plays.
    - I2V: submit with a public image URL → get transition video.
    - Multi-shot: define 3 scenes summing to 12s → generate → works.
    - Reload mid-generation → task resumes polling automatically.
    - Delete a task → gone from sidebar + localStorage.

## Todo List

- [ ] `pnpm add zustand`
- [ ] `store/task-types.ts`
- [ ] `store/task-store.ts` (with persist)
- [ ] `lib/tasks/generation-task.ts` factory
- [ ] `lib/tasks/poster.ts` best-effort first-frame capture
- [ ] `hooks/use-submit-generation.ts`
- [ ] `hooks/use-resume-polling.ts`
- [ ] `components/preview/preview-panel.tsx`
- [ ] `components/preview/status-badge.tsx`
- [ ] `components/preview/generation-skeleton.tsx`
- [ ] `components/preview/video-player.tsx`
- [ ] `components/preview/video-actions.tsx`
- [ ] `components/history/history-sidebar.tsx`
- [ ] `components/history/history-item.tsx`
- [ ] `components/history/history-item-menu.tsx`
- [ ] `ActivePollingWorker` component mounted in page.tsx
- [ ] Three-column layout on desktop, tabs on mobile
- [ ] Re-run from history works (loads form values + submits)
- [ ] Reload mid-generation resumes polling (manual verification)
- [ ] `pnpm tsc --noEmit` passes

## Success Criteria

- Happy path: prompt → generate → see live "Generating…" → video plays — all without a page reload.
- History persists across browser reloads.
- An in-progress task resumes polling after a reload.
- Re-run from a history item submits identical params and produces a new task.
- No duplicate network requests (verified in DevTools Network tab).
- No fetch calls go directly to `api.freepik.com` from the browser.
- Delete + Clear-all work and free up localStorage entries.

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Freepik generation fails silently (returns COMPLETED but empty `generated`) | Treat empty `generated` as FAILED with error "Freepik returned no video URL" |
| localStorage overflows on many history items | Limit history to 50 items by default; clear oldest when over cap |
| Multiple background tasks accidentally spawned (rapid clicks) | Disable generate button while any task is `CREATED`/`IN_PROGRESS`; also debounce on the submit handler |
| CORS blocks `<video>` playback of Freepik URLs | Freepik serves public CDN URLs — should be fine; if not, proxy via `/api/freepik/asset` route (stretch) |
| Poster generation fails due to cross-origin video | Fallback: use a first-frame placeholder asset (static SVG) |

## Security Considerations

- localStorage is domain-scoped — no cross-site leakage.
- Downloaded files use the plain MP4 URL — no auth header needed (Freepik URLs are public once generated).
- Never log entire task bodies to the console in production; guard with `process.env.NODE_ENV !== 'production'`.

## Next Steps

Proceed to [phase-06-polish-error-handling-qa.md](./phase-06-polish-error-handling-qa.md): wrap up with error messages, empty states, keyboard shortcuts, dark mode, and a manual QA pass.
