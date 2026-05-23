"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  Eye,
  EyeOff,
  Play,
  RefreshCw,
  Check,
  Copy,
  KeyRound,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Interactive API tester — paste an API key + body, hit Send, see the
 * live response. Inspired by Mintlify's right-panel playground.
 *
 * State persistence:
 *   - API key: localStorage so the user doesn't re-enter on every
 *     endpoint AND a custom event syncs all open TryIt panels on the
 *     page (typing in panel A updates B/C/D instantly).
 *   - Body: per-component (resets on page reload — that's intentional,
 *     a stale body from a different endpoint would surprise the user).
 *
 * Safety:
 *   - Requests fire from the user's browser directly to the same origin
 *     hosting this docs page → no CORS, no proxying.
 *   - The API key never leaves the browser except in the Authorization
 *     header sent to /api/v1/*.
 */

const API_KEY_STORAGE = "video_api_docs_key";
const API_KEY_LEGACY_STORAGE = "openfreepik_docs_api_key"; // back-compat
const API_KEY_CHANGE_EVENT = "video-api-key-change";

interface ApiKeyChangeDetail {
  value: string;
}

interface TryItProps {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  /** Pre-filled JSON body. Only rendered for POST/PATCH. */
  defaultBody?: string;
  /** Extra header inputs (e.g. "Idempotency-Key" for POST endpoints). */
  optionalHeaders?: readonly ("Idempotency-Key")[];
  /** Suggest a smaller default-open posture for high-cost endpoints. */
  defaultOpen?: boolean;
}

interface TryItResponse {
  status: number;
  statusText: string;
  body: string;
  headers: Record<string, string>;
  durationMs: number;
  isJson: boolean;
}

export function TryIt({
  method,
  path,
  defaultBody,
  optionalHeaders = [],
  defaultOpen = false,
}: TryItProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [apiKey, setApiKeyLocal] = useState("");
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [body, setBody] = useState(defaultBody ?? "");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [headerValues, setHeaderValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<TryItResponse | null>(null);
  const [bodyError, setBodyError] = useState<string | null>(null);

  // Setter that broadcasts to all other TryIt panels on the page so
  // typing the key once in section #1 propagates to section #2/#3/...
  // immediately, no reload needed.
  const setApiKey = useCallback((value: string) => {
    setApiKeyLocal(value);
    if (typeof window === "undefined") return;
    if (value) {
      window.localStorage.setItem(API_KEY_STORAGE, value);
    } else {
      window.localStorage.removeItem(API_KEY_STORAGE);
    }
    window.dispatchEvent(
      new CustomEvent<ApiKeyChangeDetail>(API_KEY_CHANGE_EVENT, {
        detail: { value },
      }),
    );
  }, []);

  // Load persisted API key on mount + subscribe to cross-panel updates.
  useEffect(() => {
    if (typeof window === "undefined") return;
    // Try the canonical key first, fall back to legacy name for users
    // who saved under the old `openfreepik_*` storage key.
    const stored =
      window.localStorage.getItem(API_KEY_STORAGE) ??
      window.localStorage.getItem(API_KEY_LEGACY_STORAGE);
    if (stored) setApiKeyLocal(stored);

    const onChange = (e: Event) => {
      const ce = e as CustomEvent<ApiKeyChangeDetail>;
      if (typeof ce.detail?.value === "string") {
        setApiKeyLocal(ce.detail.value);
      }
    };
    window.addEventListener(API_KEY_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(API_KEY_CHANGE_EVENT, onChange);
  }, []);

  const hasBody = method === "POST" || method === "PATCH";

  // Validate JSON body on edit (so the Send button can disable on bad
  // JSON before fetch fires).
  useEffect(() => {
    if (!hasBody || !body.trim()) {
      setBodyError(null);
      return;
    }
    try {
      JSON.parse(body);
      setBodyError(null);
    } catch (err) {
      setBodyError(
        err instanceof Error ? err.message : "Invalid JSON",
      );
    }
  }, [body, hasBody]);

  const sendRequest = useCallback(async () => {
    if (!apiKey.trim()) return;
    setLoading(true);
    setResponse(null);

    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey.trim()}`,
    };
    if (hasBody) headers["Content-Type"] = "application/json";
    for (const name of optionalHeaders) {
      const v = headerValues[name]?.trim();
      if (v) headers[name] = v;
    }

    const url =
      typeof window !== "undefined"
        ? `${window.location.origin}${path}`
        : path;

    const t0 = performance.now();
    try {
      const res = await fetch(url, {
        method,
        headers,
        body: hasBody && body.trim() ? body : undefined,
      });
      const responseText = await res.text();
      const respHeaders: Record<string, string> = {};
      res.headers.forEach((value, key) => {
        respHeaders[key] = value;
      });
      // Try pretty-print if JSON; otherwise show as-is.
      let prettyBody = responseText;
      let isJson = false;
      try {
        prettyBody = JSON.stringify(JSON.parse(responseText), null, 2);
        isJson = true;
      } catch {
        // not JSON, that's fine
      }
      setResponse({
        status: res.status,
        statusText: res.statusText,
        body: prettyBody,
        headers: respHeaders,
        durationMs: Math.round(performance.now() - t0),
        isJson,
      });
    } catch (err) {
      setResponse({
        status: 0,
        statusText: "Network error",
        body:
          err instanceof Error ? err.message : "Failed to reach the server",
        headers: {},
        durationMs: Math.round(performance.now() - t0),
        isJson: false,
      });
    } finally {
      setLoading(false);
    }
  }, [apiKey, body, hasBody, headerValues, method, optionalHeaders, path]);

  const generatedCurl = useMemo(
    () => buildCurl({ method, path, apiKey, body: hasBody ? body : undefined, headers: headerValues, optionalHeaders }),
    [method, path, apiKey, body, hasBody, headerValues, optionalHeaders],
  );

  return (
    <div className="rounded-lg border bg-muted/20">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-medium hover:bg-muted/40"
      >
        <span className="flex items-center gap-2">
          <Play className="size-3.5 text-emerald-500" />
          Test endpoint trực tiếp
        </span>
        <ChevronDown
          className={cn("size-4 transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div className="space-y-3 border-t bg-background/40 p-3">
          <ApiKeyField
            value={apiKey}
            onChange={setApiKey}
            visible={apiKeyVisible}
            onToggleVisible={() => setApiKeyVisible((v) => !v)}
          />

          {hasBody && (
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Body (JSON)
              </label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={10}
                spellCheck={false}
                className={cn(
                  "w-full rounded-md border bg-background px-2 py-1.5 font-mono text-[11px] leading-relaxed",
                  "focus:border-foreground focus:outline-none",
                  bodyError && "border-destructive",
                )}
              />
              {bodyError && (
                <p className="mt-1 text-[10px] text-destructive">
                  JSON lỗi: {bodyError}
                </p>
              )}
            </div>
          )}

          {optionalHeaders.length > 0 && (
            <div className="rounded-md border bg-muted/20">
              <button
                type="button"
                onClick={() => setShowAdvanced((s) => !s)}
                className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-[11px] text-muted-foreground hover:bg-muted/40"
              >
                <span>Tuỳ chọn nâng cao</span>
                <ChevronDown
                  className={cn(
                    "size-3 transition-transform",
                    showAdvanced && "rotate-180",
                  )}
                />
              </button>
              {showAdvanced && (
                <div className="space-y-2 border-t bg-background/40 px-2 py-2">
                  {optionalHeaders.map((name) => (
                    <OptionalHeaderField
                      key={name}
                      name={name}
                      value={headerValues[name] ?? ""}
                      onChange={(v) =>
                        setHeaderValues((prev) => ({ ...prev, [name]: v }))
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-between gap-2">
            <Button
              size="sm"
              onClick={sendRequest}
              disabled={loading || !apiKey.trim() || !!bodyError}
              className="gap-1.5"
            >
              {loading ? (
                <RefreshCw className="size-3.5 animate-spin" />
              ) : (
                <Play className="size-3.5" />
              )}
              {loading ? "Đang gửi…" : "Send"}
            </Button>
            {!apiKey.trim() && (
              <span className="text-[10px] text-muted-foreground">
                Nhập API key để bật Send
              </span>
            )}
          </div>

          {response && <ResponseViewer response={response} curl={generatedCurl} />}
        </div>
      )}
    </div>
  );
}

function ApiKeyField({
  value,
  onChange,
  visible,
  onToggleVisible,
}: {
  value: string;
  onChange: (v: string) => void;
  visible: boolean;
  onToggleVisible: () => void;
}) {
  return (
    <div>
      <label className="mb-1 flex items-center justify-between text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <span className="flex items-center gap-1">
          <KeyRound className="size-3" />
          API key
        </span>
        {value && (
          <span className="flex items-center gap-1 text-[10px] normal-case tracking-normal text-emerald-600 dark:text-emerald-400">
            <Check className="size-3" />
            Đã lưu (localStorage)
          </span>
        )}
      </label>
      <div className="flex gap-1.5">
        <Input
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="sk_..."
          autoComplete="off"
          spellCheck={false}
          className="h-8 flex-1 font-mono text-[11px]"
        />
        <Button
          variant="outline"
          size="icon"
          className="size-8 shrink-0"
          onClick={onToggleVisible}
          title={visible ? "Ẩn" : "Hiện"}
          type="button"
        >
          {visible ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
        </Button>
      </div>
    </div>
  );
}

function OptionalHeaderField({
  name,
  value,
  onChange,
}: {
  name: "Idempotency-Key";
  value: string;
  onChange: (v: string) => void;
}) {
  function generateUuid() {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      onChange(crypto.randomUUID());
    } else {
      onChange(`${Date.now()}-${Math.random().toString(36).slice(2)}`);
    }
  }
  return (
    <div>
      <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {name}
      </label>
      <p className="mb-1 text-[10px] leading-snug text-muted-foreground">
        Chống double-charge khi retry mạng. Gửi cùng key + cùng body 2 lần ={" "}
        trả response cũ. Bỏ trống nếu chỉ test thử.
      </p>
      <div className="flex gap-1.5">
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="UUID hoặc chuỗi unique"
          spellCheck={false}
          className="h-8 flex-1 font-mono text-[11px]"
        />
        <Button
          variant="outline"
          size="sm"
          className="h-8 shrink-0 text-[11px]"
          onClick={generateUuid}
          type="button"
        >
          Generate
        </Button>
      </div>
    </div>
  );
}

function ResponseViewer({
  response,
  curl,
}: {
  response: TryItResponse;
  curl: string;
}) {
  const [tab, setTab] = useState<"body" | "headers" | "curl">("body");
  const [copied, setCopied] = useState(false);

  const tone =
    response.status === 0
      ? "destructive"
      : response.status >= 500
        ? "destructive"
        : response.status >= 400
          ? "secondary"
          : response.status >= 300
            ? "outline"
            : "default";

  async function copyTabContent() {
    const text = tab === "headers" ? JSON.stringify(response.headers, null, 2) : tab === "curl" ? curl : response.body;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }

  return (
    <div className="space-y-2 rounded-md border bg-background p-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant={tone} className="text-[10px]">
            {response.status === 0 ? "Network" : response.status} {response.statusText}
          </Badge>
          <span className="text-[10px] text-muted-foreground">
            {response.durationMs}ms
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setTab("body")}
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px]",
              tab === "body" ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/40",
            )}
          >
            Body
          </button>
          <button
            type="button"
            onClick={() => setTab("headers")}
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px]",
              tab === "headers" ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/40",
            )}
          >
            Headers
          </button>
          <button
            type="button"
            onClick={() => setTab("curl")}
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px]",
              tab === "curl" ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/40",
            )}
          >
            cURL
          </button>
          <Button
            variant="ghost"
            size="icon"
            className="size-6 shrink-0"
            onClick={copyTabContent}
            title="Copy"
            type="button"
          >
            {copied ? (
              <Check className="size-3 text-emerald-500" />
            ) : (
              <Copy className="size-3" />
            )}
          </Button>
        </div>
      </div>
      <pre className="max-h-80 overflow-auto rounded bg-muted/50 p-2 font-mono text-[10px] leading-relaxed">
        {tab === "headers"
          ? Object.entries(response.headers)
              .map(([k, v]) => `${k}: ${v}`)
              .join("\n")
          : tab === "curl"
            ? curl
            : response.body || "(empty)"}
      </pre>
    </div>
  );
}

function buildCurl(opts: {
  method: string;
  path: string;
  apiKey: string;
  body: string | undefined;
  headers: Record<string, string>;
  optionalHeaders: readonly string[];
}): string {
  const origin =
    typeof window !== "undefined" ? window.location.origin : "https://video.chugax.io.vn";
  const lines = [`curl -X ${opts.method} ${origin}${opts.path}`];
  if (opts.apiKey) lines.push(`  -H "Authorization: Bearer ${opts.apiKey}"`);
  if (opts.body) lines.push(`  -H "Content-Type: application/json"`);
  for (const h of opts.optionalHeaders) {
    const v = opts.headers[h]?.trim();
    if (v) lines.push(`  -H "${h}: ${v}"`);
  }
  if (opts.body) {
    // Compact body to single line for readability
    const compact = opts.body.replace(/\s+/g, " ").trim();
    lines.push(`  -d '${compact}'`);
  }
  return lines.join(" \\\n");
}
