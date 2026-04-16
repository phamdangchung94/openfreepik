# Phase 4 — Improve Prompt Integration

**Status:** ☐ Not started
**Priority:** High
**Depends on:** Phase 2, Phase 3

## Overview

Wire the "Improve Prompt" button in the generator form to Freepik's `/v1/ai/improve-prompt` endpoint. The endpoint is async, so we:

1. POST the current prompt → receive `task_id`.
2. Poll `GET /v1/ai/improve-prompt/{task_id}` until `COMPLETED` or `FAILED`.
3. On success, replace the textarea value with the improved prompt (preserving undo).
4. On failure, show a toast and keep the original prompt.

This phase also introduces the reusable **task polling hook** (`useTaskPolling`) that Phase 5 will reuse for Kling generation.

## Key Insights

- The improve-prompt task is cheap and usually completes in 3–15 seconds — a good testbed for the polling hook before we wire it to Kling.
- The API's `generated` array contains **text** (the improved prompt), not URLs — despite the OpenAPI schema showing `uri`. We'll handle both (string that starts with `http` → treat as URL; else treat as text) and log a warning if we ever get a URL.
- "Improve" is an **idempotent replacement**, but the user may prefer to review before replacing. We show a diff-preview dialog with Accept / Reject buttons. (Simple: just show old + new side by side; no real diff needed.)
- Undo: we keep the old prompt in local component state and add a small "Undo" button in a toast that lasts 8 seconds after accept.

## Requirements

### Functional
- Clicking "Improve Prompt" (or pressing ⌘/Ctrl + I) on the prompt field:
  1. Disables the button, shows a spinner inside it.
  2. Calls `POST /api/freepik/improve-prompt` with `{ prompt, type: 'video', language: 'en' }`.
  3. Receives `task_id`, starts polling `GET /api/freepik/improve-prompt/[taskId]` every 2s, up to 60s.
  4. On `COMPLETED`:
     - Opens a modal: "Here's your improved prompt" — shows original and improved side by side (readonly).
     - Buttons: **Accept** (replaces form value, closes modal, shows undo toast) | **Reject** (closes modal, no change).
  5. On `FAILED` or timeout: toast error, re-enable button.
- Button is disabled when:
  - A polling operation is in flight, OR
  - The prompt is empty (nothing to improve), OR
  - The form is mid-generation (Phase 5 will read this).
- The undo toast has a button that restores the previous prompt value.

### Non-functional
- The improve-prompt hook and the Kling-generation hook (Phase 5) share the same `useTaskPolling` primitive.
- Polling uses `setTimeout` chained (not `setInterval`) to avoid overlapping requests.
- On unmount, polling is cancelled cleanly (no "setState on unmounted component" warnings).

## Architecture

```
src/
├── hooks/
│   ├── use-task-polling.ts              ← generic polling primitive
│   └── use-improve-prompt.ts            ← domain hook using polling
├── components/
│   └── generator/
│       ├── prompt-field.tsx             ← MODIFY: add Improve button + hotkey
│       └── improve-prompt-dialog.tsx    ← NEW: modal w/ side-by-side preview
```

### `useTaskPolling` signature

```ts
interface UseTaskPollingOptions<T> {
  taskId: string | null;
  fetcher: (taskId: string) => Promise<Task<T>>;
  intervalMs?: number;            // default 2000
  timeoutMs?: number;             // default 120000
  backoff?: (attempt: number) => number; // default linear + cap at 10s
  onCompleted?: (result: T[]) => void;
  onFailed?: (error: string) => void;
  enabled?: boolean;
}
interface UseTaskPollingResult<T> {
  status: TaskStatus | 'IDLE' | 'TIMEOUT';
  result: T[] | null;
  error: string | null;
  cancel: () => void;
}
export function useTaskPolling<T = string>(opts: UseTaskPollingOptions<T>): UseTaskPollingResult<T>;
```

Key behaviors:
- Returns `'IDLE'` until `taskId` is set + `enabled`.
- Internally stores an attempt counter, a `cancelled` flag, and a `AbortController` for the in-flight fetch.
- Cleans up on unmount via `useEffect` return.
- Re-running (new taskId) resets state.

### `useImprovePrompt` domain hook

```ts
export function useImprovePrompt() {
  const [taskId, setTaskId] = useState<string | null>(null);
  const [originalPrompt, setOriginalPrompt] = useState<string>('');
  const polling = useTaskPolling({
    taskId,
    fetcher: (id) => fetch(`/api/freepik/improve-prompt/${id}`).then(asTask),
    intervalMs: 2000,
    timeoutMs: 60000,
    enabled: taskId !== null,
  });

  async function improve(prompt: string) {
    setOriginalPrompt(prompt);
    const res = await fetch('/api/freepik/improve-prompt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, type: 'video', language: 'en' }),
    });
    const { data } = await res.json();
    setTaskId(data.task_id);
  }

  function reset() { setTaskId(null); }

  return { improve, reset, status: polling.status, result: polling.result, originalPrompt };
}
```

## Related Code Files

### Create
- `src/hooks/use-task-polling.ts`
- `src/hooks/use-improve-prompt.ts`
- `src/components/generator/improve-prompt-dialog.tsx`

### Modify
- `src/components/generator/prompt-field.tsx` — add "Improve" button + keyboard shortcut listener + modal trigger.
- shadcn: add `dialog` and `sonner` components if not already: `pnpm dlx shadcn@latest add dialog sonner`
- `src/app/layout.tsx` — mount `<Toaster />` from sonner

## Implementation Steps

1. **Add sonner + dialog**: `pnpm dlx shadcn@latest add sonner dialog`. Mount `<Toaster position="bottom-right" richColors />` in root layout.

2. **Write `useTaskPolling.ts`**:
   - `useEffect` triggered on `taskId` + `enabled`.
   - Uses a mutable ref for `cancelled` and `attempt`.
   - Schedules next call via `setTimeout`; each tick aborts any in-flight request.
   - On COMPLETED → setStatus + call `onCompleted` + stop scheduling.
   - On FAILED → same pattern, call `onFailed`.
   - On timeout → setStatus TIMEOUT + onFailed('timeout').
   - Returns `cancel()` that sets cancelled flag and aborts.

3. **Write `useImprovePrompt.ts`** using `useTaskPolling`. Expose `improve(prompt)` and `reset()`.

4. **Build `improve-prompt-dialog.tsx`** — shadcn `<Dialog>` with two `<pre>`/`<Textarea readOnly>` panels (Original / Improved), an explanation sentence, and Accept/Reject buttons.

5. **Modify `prompt-field.tsx`**:
   - Pull `useImprovePrompt()` and `useFormContext()`.
   - Render an Improve button (sparkle icon + text) to the right of the label.
   - On click: `improve(currentPrompt)`.
   - On completion: open the dialog with original + improved (pull from polling result).
   - Accept handler: `setValue('prompt', improved)` + toast with Undo button (revert on undo).
   - Reject handler: close dialog + reset hook.
   - Keyboard: `Mod+I` globally in the textarea triggers the same flow.

6. **Loading & disabled states**:
   - Button shows spinner + "Improving…" while polling.
   - Button disabled if prompt empty or length > 2500 (can't improve an already-overflowing prompt).

7. **Error handling**:
   - 401 → toast "API key invalid — check .env.local"
   - 5xx → toast "Freepik is having issues — try again"
   - Timeout → toast "Improvement is taking too long. Canceled."

8. **Manual smoke test**:
   - Type "a cat playing with a ball" → click Improve → dialog opens with a richer version → Accept → textarea updates → Undo → reverts.
   - Type an empty prompt → button disabled.
   - Disconnect internet mid-poll → error toast shown.

## Todo List

- [ ] `pnpm dlx shadcn@latest add sonner dialog`
- [ ] Mount `<Toaster />` in root layout
- [ ] `hooks/use-task-polling.ts` (with abort + cleanup)
- [ ] `hooks/use-improve-prompt.ts`
- [ ] `components/generator/improve-prompt-dialog.tsx`
- [ ] Modify `prompt-field.tsx` to add Improve button + hotkey
- [ ] Wire Accept/Reject → form value / undo
- [ ] Map error classes to toast messages
- [ ] Smoke test end-to-end with real Freepik API
- [ ] `pnpm tsc --noEmit` passes

## Success Criteria

- Real API returns an improved prompt for at least 3 distinct test inputs.
- Polling stops as soon as status transitions; no overlapping fetches in the network panel.
- Accept replaces the prompt; Undo within 8s restores it.
- Unmounting the page mid-poll leaves no warnings in console.
- Empty prompt disables the button.
- Timeout after 60s is observable (can be tested by mocking the fetcher to never resolve).

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Improve endpoint returns a non-string in `generated` | Defensive parse: accept `string | string[]`; fallback to first element joined by newline |
| User clicks Improve repeatedly during a poll | Button is disabled while polling; also tracked via `inFlight` ref |
| Long prompts blow through Freepik's 2500 char limit after improvement | Show warning toast + truncate to 2500 with a "…" marker, ask user to review |
| Polling hook leaks memory if the user navigates away | `cancel()` called in `useEffect` cleanup; `AbortController` aborts in-flight |

## Security Considerations

- No new routes — reuses Phase 2 proxy.
- Input is user prompt text; passed as JSON body, not interpolated into any URL.
- Dialog renders improved text via `{value}` — safe (React escapes by default).

## Next Steps

Proceed to [phase-05-task-polling-history-player.md](./phase-05-task-polling-history-player.md): reuse the polling hook for real Kling 3 video generation, persist tasks, and play back the results.
