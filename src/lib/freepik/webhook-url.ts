/**
 * Resolve the public URL Magnific should POST back to when a task
 * changes status. Returns null when we shouldn't request webhook
 * delivery (local dev, preview deploys without an explicit override).
 *
 * Priority:
 *   1. WEBHOOK_BASE_URL — explicit override (set this for custom domains
 *      or to point preview deploys at a tunnel like ngrok).
 *   2. VERCEL_PROJECT_PRODUCTION_URL — Vercel-managed stable URL of the
 *      production environment. Only used when we ARE running in
 *      production (VERCEL_ENV='production') so preview deploys don't
 *      hijack the production callback path.
 *   3. otherwise null (no webhook_url in upstream requests; client
 *      polling drives finalization).
 *
 * The path component is fixed — Magnific calls `/api/freepik/webhook`
 * regardless of which model/endpoint produced the task.
 */
export function getWebhookUrl(): string | null {
  const override = process.env.WEBHOOK_BASE_URL;
  if (override) {
    return joinPath(override);
  }
  if (process.env.VERCEL_ENV === "production") {
    const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;
    if (vercelHost) {
      return joinPath(`https://${vercelHost}`);
    }
  }
  return null;
}

function joinPath(base: string): string {
  return base.replace(/\/+$/, "") + "/api/freepik/webhook";
}

/**
 * Conditionally add `webhook_url` to a Freepik request payload. Used
 * inside the orchestrator's `callFreepik` callback so the decision can
 * factor in which key got picked.
 *
 * Skips injection when:
 *   - `webhookUrl` is null (local dev / preview without override) — no
 *     URL to deliver to.
 *   - The picked key has no `webhook_secret_encrypted` — Magnific would
 *     deliver, our verify would 401, customer ends up waiting for
 *     orphan-sweeper. Polling-only is strictly better here.
 *
 * 2026-05-23: introduced after tracking down a stuck task on key
 * `3518` (no secret) — Magnific retried 8 webhook deliveries, all
 * 401'd, task sat pending until manual investigation.
 */
export function withConditionalWebhook<T extends object>(
  params: T,
  webhookUrl: string | null,
  ctx: { hasWebhookSecret: boolean },
): T {
  if (!webhookUrl || !ctx.hasWebhookSecret) return params;
  return { ...params, webhook_url: webhookUrl };
}
