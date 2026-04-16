# Phase 1 — Foundation & Setup

**Status:** ☐ Not started
**Priority:** Critical (blocks all other phases)
**Depends on:** —

## Overview

Scaffold a clean Next.js 15 workspace with the exact tooling chosen in `plan.md`, wire up shadcn/ui, set environment variables, and run a single "sanity ping" to Freepik to confirm the API key is valid **before** burning credits on real generation calls.

## Key Insights

- `create-next-app` with the App Router + TS template gives us 90% of what we need; shadcn is added on top via its CLI.
- The sanity ping should use a **list** endpoint (`GET /v1/ai/video/kling-v3`) rather than a POST — listing is free and instantly verifies both auth and plan access.
- We use `pnpm` so the lockfile is deterministic and shadcn's codegen is fast.
- We create `docs/` immediately so future phases can drop code standards / architecture notes there without friction.

## Requirements

### Functional
- Running `pnpm dev` starts the Next.js server on http://localhost:3000 with no errors.
- shadcn/ui is installed and at least one component (`Button`) renders on the landing page.
- `.env.local` holds `FREEPIK_API_KEY` and is gitignored.
- A one-shot CLI script verifies the API key by hitting the Freepik list endpoint.
- TypeScript strict mode is ON.

### Non-functional
- Cold boot time of `pnpm dev` < 10s on a normal laptop.
- Repo contains **only** the files necessary for this phase — no premature abstraction.

## Architecture

```
OpenFreepik1/
├── .env.local              ← FREEPIK_API_KEY=FPSX...
├── .env.example            ← checked in, no real value
├── .gitignore              ← Next.js defaults + .env.local
├── next.config.ts
├── tsconfig.json           ← strict: true
├── tailwind.config.ts
├── postcss.config.mjs
├── package.json            ← pnpm
├── components.json         ← shadcn config
├── public/
│   └── favicon.ico
├── src/
│   ├── app/
│   │   ├── layout.tsx      ← Root layout, dark mode class, Inter font
│   │   ├── page.tsx        ← Placeholder "Kling 3 Video Generator" landing
│   │   └── globals.css     ← Tailwind directives + shadcn tokens
│   ├── components/
│   │   └── ui/             ← shadcn components (empty for now, only button)
│   └── lib/
│       └── utils.ts        ← shadcn `cn` helper
├── scripts/
│   └── check-api-key.ts    ← sanity ping script
└── docs/
    ├── system-architecture.md   ← skeleton
    ├── code-standards.md        ← skeleton
    ├── development-roadmap.md   ← skeleton w/ phase 1 done
    └── project-changelog.md     ← skeleton
```

## Related Code Files

### Create
- `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `postcss.config.mjs`
- `.env.example`, `.gitignore`
- `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`
- `src/lib/utils.ts`, `src/components/ui/button.tsx` (via shadcn CLI)
- `components.json` (shadcn config)
- `scripts/check-api-key.ts`
- `docs/system-architecture.md`, `docs/code-standards.md`, `docs/development-roadmap.md`, `docs/project-changelog.md`
- `README.md` (brief: what this project is + `pnpm dev`)

### Modify — none (new project)
### Delete — none

## Implementation Steps

1. **Init Next.js**
   ```bash
   pnpm create next-app@latest . --ts --tailwind --app --src-dir --no-eslint --import-alias "@/*"
   ```
   Accept defaults where prompted.

2. **Pin Node engine** — add `"engines": { "node": ">=20" }` to `package.json`.

3. **Install shadcn/ui**
   ```bash
   pnpm dlx shadcn@latest init -d
   pnpm dlx shadcn@latest add button
   ```
   Confirm `components.json` and `src/components/ui/button.tsx` exist.

4. **Add environment config**
   - Create `.env.example`:
     ```env
     FREEPIK_API_KEY=FPSX_REPLACE_ME
     ```
   - Create `.env.local` with the real key (user-supplied `FPSXd1dda352ac8ea6af8699402a4ad1ecd1`).
   - Confirm `.env.local` is in `.gitignore` (Next default covers it — verify).

5. **Enable TypeScript strict mode** — in `tsconfig.json` set `"strict": true, "noUncheckedIndexedAccess": true`.

6. **Write the sanity-ping script** (`scripts/check-api-key.ts`)
   - Uses native `fetch` (Node 20+).
   - Reads `FREEPIK_API_KEY` from `process.env`.
   - Calls `GET https://api.freepik.com/v1/ai/video/kling-v3?limit=1`.
   - Prints `OK (status=200)` on success, `FAIL: <status> <body>` otherwise.
   - Add npm script: `"check:api": "tsx scripts/check-api-key.ts"`.
   - Install `tsx` as dev dep.

7. **Wire placeholder landing page** (`src/app/page.tsx`)
   - Centered hero: "Kling 3 Video Generator" + tagline "Powered by Freepik AI".
   - A disabled `<Button>` "Coming soon" — just to prove shadcn renders.

8. **Scaffold `docs/` skeletons** — one-paragraph placeholders each, with a note "Filled in during Phase X". Mark Phase 1 checklist as done in `development-roadmap.md`.

9. **Write minimal README.md**
   - Title, one-paragraph description.
   - "Setup": `pnpm install`, copy `.env.example` → `.env.local`, `pnpm check:api`, `pnpm dev`.
   - Link to `plans/20260415-1200-kling-3-video-generator-ui/plan.md`.

10. **Local verification**
    - `pnpm install` clean.
    - `pnpm check:api` → `OK`.
    - `pnpm dev` → http://localhost:3000 renders hero + button.
    - `pnpm tsc --noEmit` → no errors.

## Todo List

- [ ] `pnpm create next-app` with TS + Tailwind + App Router + src dir
- [ ] Install shadcn/ui + `Button` component
- [ ] Add `.env.example` and `.env.local` (gitignored)
- [ ] Enable TS strict mode
- [ ] Write `scripts/check-api-key.ts` + `pnpm check:api` alias
- [ ] Replace default landing page with Kling 3 hero placeholder
- [ ] Scaffold `docs/` skeleton files
- [ ] Write `README.md`
- [ ] Run `pnpm check:api` and confirm `OK`
- [ ] Run `pnpm dev`, open http://localhost:3000, verify no errors
- [ ] Run `pnpm tsc --noEmit` — passes

## Success Criteria

- `pnpm check:api` returns HTTP 200 from Freepik — **hard gate** before moving to Phase 2.
- `pnpm dev` boots cleanly with a visible shadcn Button.
- `src/` tree matches the architecture diagram above.
- No TypeScript errors.
- No real API key is committed.

## Risk Assessment

| Risk | Mitigation |
|---|---|
| User's API key is invalid or lacks Kling 3 access | The sanity-ping script will fail loudly — we stop and escalate before writing more code |
| shadcn CLI prompt hangs on non-interactive shells | Pass `-d` (defaults) to `init`; pass `--yes` to `add` if needed |
| Tailwind v4 vs v3 config drift | Pin `tailwindcss@latest` from Next.js template — it ships v4 |

## Security Considerations

- `.env.local` **must** be gitignored (verify before first commit).
- The sanity-ping script runs locally only; API key never logged.
- No client-side env vars — only `FREEPIK_API_KEY` (server-side).

## Next Steps

Once Phase 1 is green: proceed to [phase-02-freepik-api-layer.md](./phase-02-freepik-api-layer.md) to build the typed API client and proxy route handlers.
