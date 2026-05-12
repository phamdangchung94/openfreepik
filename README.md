# OpenFreepik

SaaS wrapper around the Freepik Kling V3 video generation API. Customers
authenticate with an admin-issued activation code; the server pools
multiple Freepik API keys behind the scenes and meters per-customer
usage.

**Live**: https://openfreepik.vercel.app
**Admin**: https://openfreepik.vercel.app/dashboard

## Stack

- Next.js 16 (App Router, Turbopack)
- React 19
- Drizzle ORM + Neon Postgres
- Zustand (client state)
- TailwindCSS + Base UI components
- Vercel deploy + Cron

## Local development

```bash
pnpm install
cp .env.example .env.local      # then fill the 5 secrets
pnpm db:migrate                  # apply schema to your DB
pnpm db:seed-pricing             # seed the pricing matrix
pnpm dev                         # http://localhost:3000
```

> 🌿 **Local dev talks to the Neon `dev` branch, not production** (since
> 2026-05-12). Pasting `pnpm db:migrate` / `pnpm db:seed-pricing` /
> arbitrary SQL won't touch real customer data. The dev branch is a
> copy-on-write snapshot of prod taken at branch creation; reset it
> from the Neon Console any time it drifts: project → Branches → `dev`
> → "Reset from parent". See [`docs/RUNBOOK.md#separate-the-dev-database-from-production-audit-2`](docs/RUNBOOK.md)
> for the workflow.

## Operations

[`docs/RUNBOOK.md`](docs/RUNBOOK.md) covers rollback, env rotation,
adding Freepik keys, revoking codes, migrations, monitoring, and
common incident responses. Read this first when something breaks.

## Audit reports

Post-launch audits live in [`plans/audits/`](plans/audits/). Open issues
are tracked on GitHub with `audit` label.

## Project conventions

- File size ≤ 200 lines (split anything larger)
- Server-side: structured JSON logs via [`src/lib/logger.ts`](src/lib/logger.ts)
- Money-touching paths: covered by [`scripts/audit-orchestrator-stress.ts`](scripts/audit-orchestrator-stress.ts)
- AGENTS.md notes: this is a Next.js 16 codebase, APIs may differ from
  what training data assumes — read `node_modules/next/dist/docs/`
  before guessing
