# Audit Report — S1: Dev/Prod secret isolation

**Date**: 2026-05-02
**Scope**: All 4 secrets in `.env.local` vs Vercel production env
**Severity**: 🔴 **P0 — CRITICAL**
**Status**: Confirmed broken

## Finding

All 4 production secrets are identical to my local development `.env.local`:

| Secret | Shared? | Evidence |
|--------|---------|----------|
| `DATABASE_URL` | 🔴 YES | Production reads activation code `FK-UQCRP-U15C3-4BECF-ECQIL-QERR4-GG` (only created in local) and returns matching `usedEur=5.95` |
| `KEY_ENCRYPTION_SECRET` | 🔴 YES | Production successfully decrypts the Freepik key I added locally (real generation worked) |
| `ADMIN_PASSWORD` | 🔴 YES | Same `vHjrAZJXql2b7g0g` works for both `localhost:3000/dashboard/login` and `openfreepik.vercel.app/dashboard/login` |
| `ADMIN_SESSION_SECRET` | 🔴 YES | Provenance: Phase 11b commits used `echo -n "..." \| vercel env add` with the local `.env.local` values verbatim |

Vercel `env pull` masks encrypted vars to `""` so the file diff alone wasn't conclusive — confirmation is via behavioral proof (production reads my locally-created code) and the deploy commit history.

## Why this is dangerous

### 1. Local dev writes to production DB
Every time I run `pnpm db:status`, `pnpm dev`, or any test script that touches the DB, it hits the same Neon database that customers use. Already happened during this audit:
- `usage_logs` row count went from 7 (post-deploy) → 15 (during audit) due to local + production traffic mixing
- A failed local test could insert garbage rows visible to customers
- `pnpm db:migrate` would apply schema changes to production without warning
- Worst case: a `DROP TABLE` in a local script wipes production

### 2. Single password for prod admin
`vHjrAZJXql2b7g0g` was generated as a *convenience* password for local dev. It now also gates the production `/dashboard`. If:
- The password leaks via local screen-share, terminal scrollback, or unencrypted backup → prod admin compromised
- A teammate borrows my laptop → they have prod admin access

### 3. Encryption secret reuse
`KEY_ENCRYPTION_SECRET` is the AES key that encrypts every Freepik API key in the database. With a shared secret:
- A local DB dump (e.g., for debugging) contains decryptable production keys
- If my laptop is compromised, attacker decrypts every Freepik key in the pool

### 4. Session secret reuse
Theoretically allows a session token minted on local to be valid on production (and vice versa). Less impactful than the others because sessions are also stored in DB and validated server-side, but still a needless coupling.

## Recommended fix

### Phase A — Isolate production secrets (1-2h)

1. **Create a separate Neon project for production**
   - Neon dashboard → New project → name `openfreepik-prod`
   - Get pooled connection string for the new project

2. **Generate fresh production secrets**
   ```bash
   openssl rand -base64 32  # KEY_ENCRYPTION_SECRET
   openssl rand -base64 32  # ADMIN_SESSION_SECRET
   openssl rand -base64 18 | tr -d '/+=' | cut -c1-20  # ADMIN_PASSWORD
   ```

3. **Replace each Vercel production env var**
   ```bash
   for var in DATABASE_URL KEY_ENCRYPTION_SECRET ADMIN_PASSWORD ADMIN_SESSION_SECRET; do
     pnpm dlx vercel env rm $var production --yes
     # Then add fresh value via prompt
     pnpm dlx vercel env add $var production
   done
   ```

4. **Apply migration to fresh prod DB**
   ```bash
   DATABASE_URL=<prod-url> pnpm tsx scripts/db-migrate.ts
   DATABASE_URL=<prod-url> pnpm tsx scripts/seed-pricing.ts
   ```

5. **Re-add production Freepik key + activation code via admin dashboard**
   - Visit `https://openfreepik.vercel.app/dashboard` (with NEW admin password)
   - Add Freepik key
   - Mint a new activation code for the customer

6. **Redeploy to pick up new env**
   ```bash
   pnpm dlx vercel deploy --prod --yes
   ```

### Phase B — Prevent regression (30 min)

1. **Add `.env.local` warning banner** to `package.json` script:
   ```json
   "predev": "node -e \"if (require('fs').readFileSync('.env.local', 'utf8').includes('ep-gentle-forest-am1ybwsu')) console.warn('\\n⚠️  Local .env.local still points to PRODUCTION DB. Fix before running.\\n')\""
   ```

2. **Document in `docs/secrets.md`**:
   - Local secrets MUST come from a separate Neon project
   - Production rotation playbook
   - Never `vercel env pull` into `.env.local` — keeps separation

3. **Update Phase 9's `.env.example`** to mention this:
   ```
   # IMPORTANT: do NOT use the same DATABASE_URL for local + production.
   # Create separate Neon projects.
   ```

### Phase C — Forensic / cleanup (optional, 1h)

The shared DB has been "polluted" with local test data. Decide:
- **Option 1 (recommended)**: Treat current Neon project as "prod" since it has the real Freepik key + 1 paying-ish customer code. Spin up fresh Neon for *new local dev*. Old test data (failed tasks, refunded rows) becomes part of audit trail.
- **Option 2 (clean slate)**: Spin up new Neon for prod, migrate the Freepik key + active codes manually, leave the polluted DB as local-dev sandbox.

## Acceptance criteria

- [ ] Production `DATABASE_URL` points to a Neon project where local dev has zero credentials
- [ ] Production `KEY_ENCRYPTION_SECRET` differs from local (regenerate locally too)
- [ ] Production `ADMIN_PASSWORD` differs from local
- [ ] Production `ADMIN_SESSION_SECRET` differs from local
- [ ] `pnpm db:status` from this worktree shows DIFFERENT row counts than `https://openfreepik.vercel.app/api/admin/overview`
- [ ] Logging into local `/dashboard/login` with the local password no longer works on production

## Effort estimate

~2 hours total (most is Vercel env juggling + careful rotation).

## Out of scope

- Multi-environment promotion strategy (preview/staging deploys) — separate audit
- Secret rotation cadence — separate operational ticket
