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
