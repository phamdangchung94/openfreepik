# OpenFreepik

SaaS wrapper around the Freepik Kling V3 video generation API. Customers
authenticate with an admin-issued activation code; the server pools
multiple Freepik API keys behind the scenes and meters per-customer
usage.

**Live**: https://video.chugax.io.vn
**Admin**: https://video.chugax.io.vn/dashboard

## Stack

- Next.js 16 (App Router, Turbopack)
- React 19
- Drizzle ORM + Supabase Postgres
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

> **Database safety**: after the Supabase cutover, `.env.local`
> should point to a Supabase non-production database when doing local
> development. Before running `pnpm db:migrate`, `pnpm db:seed-pricing`,
> or arbitrary SQL, verify the host in `DATABASE_URL`. See
> [`docs/RUNBOOK.md#database-management`](docs/RUNBOOK.md) for the
> production-safe workflow.

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
