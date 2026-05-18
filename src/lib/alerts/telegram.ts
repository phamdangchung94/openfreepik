/**
 * Telegram bot alerter — sends actionable events to the admin's
 * Telegram chat. Uses Bot API directly (no SDK; zero deps).
 *
 * Setup:
 *   1. /newbot to @BotFather → get TELEGRAM_BOT_TOKEN
 *   2. Start a chat with the bot, send /start
 *   3. curl https://api.telegram.org/bot<TOKEN>/getUpdates → grab the
 *      chat.id from result[0].message.chat.id
 *   4. vercel env add TELEGRAM_BOT_TOKEN production
 *      vercel env add TELEGRAM_CHAT_ID production
 *      Redeploy.
 *
 * Behaviour without env vars:
 *   Both vars unset → all alert calls become no-ops (with a single
 *   debug log on first call). Lets the codebase ship before the admin
 *   has wired up the bot, without breaking anything.
 *
 * Severity → emoji prefix so the message is glanceable in Telegram:
 *   info     ℹ️
 *   warn     ⚠️
 *   critical 🚨
 *
 * Rate-limited at 20 messages / minute / chat by Telegram. We don't
 * track this client-side — the codebase calls alert sparingly (only
 * for the events listed in `Alertable` below). If we ever burst over
 * the budget Telegram returns 429 and we silently drop the message
 * (still logged via `log.warn`).
 */

import { log, errFields } from "@/lib/logger";

export type AlertSeverity = "info" | "warn" | "critical";

interface AlertPayload {
  severity: AlertSeverity;
  /** Short event tag — matches a `log.*` event name when possible. */
  event: string;
  /** One-line summary, shown bold in Telegram. Max ~80 chars. */
  title: string;
  /**
   * Free-form body. Renders as monospace block under the title. Useful
   * for IDs, error messages, suggested next steps.
   */
  body?: string;
  /** Extra structured fields appended to the message as `key: value` lines. */
  fields?: Record<string, string | number | null | undefined>;
}

const SEVERITY_PREFIX: Record<AlertSeverity, string> = {
  info: "ℹ️",
  warn: "⚠️",
  critical: "🚨",
};

let warnedAboutMissingConfig = false;

function getConfig(): { token: string; chatId: string } | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    if (!warnedAboutMissingConfig) {
      log.debug("TELEGRAM_ALERTS_DISABLED", {
        reason: "TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID missing",
      });
      warnedAboutMissingConfig = true;
    }
    return null;
  }
  return { token, chatId };
}

function formatMessage(p: AlertPayload): string {
  const lines: string[] = [];
  const prefix = SEVERITY_PREFIX[p.severity];
  lines.push(`${prefix} *${escapeMarkdown(p.title)}*`);
  lines.push(`_${escapeMarkdown(p.event)}_`);
  if (p.body) {
    lines.push("```");
    lines.push(p.body);
    lines.push("```");
  }
  if (p.fields) {
    const fieldLines = Object.entries(p.fields)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => `\`${k}\`: ${escapeMarkdown(String(v))}`);
    if (fieldLines.length > 0) lines.push(...fieldLines);
  }
  return lines.join("\n");
}

/**
 * Telegram's MarkdownV2 reserves quite a few chars. We use plain
 * Markdown (legacy) so the escape rules are simpler: only `_*\`[`.
 * Anything inside a code block ``` is literal — don't double-escape.
 */
function escapeMarkdown(s: string): string {
  return s.replace(/([_*`\[])/g, "\\$1");
}

/**
 * Fire-and-forget send. Resolves to `true` if Telegram acknowledged
 * the message, `false` otherwise (network error, missing config, 4xx).
 * Never throws — callers shouldn't `await` and shouldn't depend on the
 * boolean for control flow.
 */
export async function sendAlert(payload: AlertPayload): Promise<boolean> {
  const config = getConfig();
  if (!config) return false;

  const text = formatMessage(payload);
  const url = `https://api.telegram.org/bot${config.token}/sendMessage`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // 10s timeout via AbortController — Telegram API is normally
      // sub-second but if it hangs we don't want to block the caller.
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        chat_id: config.chatId,
        text,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      log.warn("TELEGRAM_ALERT_FAILED", {
        status: res.status,
        body: body.slice(0, 200),
        event: payload.event,
      });
      return false;
    }
    return true;
  } catch (err) {
    log.warn("TELEGRAM_ALERT_ERROR", {
      ...errFields(err),
      event: payload.event,
    });
    return false;
  }
}

/**
 * Convenience wrapper for the common "log + alert" pattern. Logs at the
 * severity level, then fires a Telegram alert with the same event name.
 * Use this for events admin needs to know about RIGHT NOW (vs just
 * having in the log archive for retrospective).
 */
export function logAndAlert(
  payload: AlertPayload & { fields?: Record<string, unknown> },
): void {
  const logFields = (payload.fields ?? {}) as Record<string, unknown>;
  if (payload.severity === "critical") {
    log.error(payload.event, logFields);
  } else if (payload.severity === "warn") {
    log.warn(payload.event, logFields);
  } else {
    log.info(payload.event, logFields);
  }
  // Coerce fields to string for the Telegram message (it's a flat
  // key-value block, not structured JSON).
  const tgFields: Record<string, string> = {};
  for (const [k, v] of Object.entries(logFields)) {
    if (v !== undefined && v !== null) tgFields[k] = String(v);
  }
  // Don't await — callers should not block on alert delivery.
  void sendAlert({ ...payload, fields: tgFields });
}
