"use client";

import { useEffect, useState } from "react";
import { Key, LogOut, Infinity, Copy, Check, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuthStore, type ActivationMetadata } from "@/store/auth-store";
import { formatVnd } from "@/lib/format-currency";

export function ActivationCodeInput() {
  const activationCode = useAuthStore((s) => s.activationCode);
  const metadata = useAuthStore((s) => s.metadata);
  const setActivation = useAuthStore((s) => s.setActivation);
  const setMetadata = useAuthStore((s) => s.setMetadata);
  const clear = useAuthStore((s) => s.clear);

  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  // Re-validate on mount so admin-side changes (revoked, top-up) reflect
  // before the customer fires their next generation.
  useEffect(() => {
    if (!activationCode) return;
    activate(activationCode, { silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function activate(code: string, opts?: { silent?: boolean }) {
    setBusy(true);
    try {
      const res = await fetch("/api/activate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        if (!opts?.silent) {
          toast.error(json.message ?? "Kích hoạt thất bại");
        } else {
          // Silent re-validation failed (revoked/expired) — log out the client.
          clear();
          toast.error(json.message ?? "Mã kích hoạt đã bị thu hồi");
        }
        return;
      }
      const meta: ActivationMetadata = json.metadata;
      if (activationCode === code) {
        setMetadata(meta);
      } else {
        setActivation(code, meta);
        setDraft("");
        toast.success(meta.label ? `Xin chào, ${meta.label}` : "Đã kích hoạt");
      }
    } catch (err) {
      console.error("[activate]", err);
      if (!opts?.silent) toast.error("Lỗi mạng — thử lại");
    } finally {
      setBusy(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const code = draft.trim();
    if (code.length < 8) {
      toast.error("Mã quá ngắn");
      return;
    }
    activate(code);
  }

  // Activated state — show label + balance + logout
  if (activationCode && metadata) {
    return (
      <ActivatedDisplay
        metadata={metadata}
        activationCode={activationCode}
        onLogout={clear}
      />
    );
  }

  // Hydration in progress (code in localStorage but metadata not yet loaded)
  if (activationCode && !metadata) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Key className="h-4 w-4" />
        <span>Đang kích hoạt...</span>
      </div>
    );
  }

  // Not activated — show input form
  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-1.5">
      <Key className="h-4 w-4 shrink-0 text-amber-500" />
      <Input
        type="text"
        placeholder="Nhập mã kích hoạt"
        aria-label="Mã kích hoạt"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        disabled={busy}
        className="h-9 w-[180px] rounded-full px-4 text-xs font-mono sm:h-8 sm:w-[260px]"
        autoComplete="off"
        spellCheck={false}
      />
      <Button type="submit" size="sm" disabled={busy || draft.trim().length < 8}>
        {busy ? "..." : "Kích hoạt"}
      </Button>
    </form>
  );
}

function ActivatedDisplay({
  metadata,
  activationCode,
  onLogout,
}: {
  metadata: ActivationMetadata;
  activationCode: string;
  onLogout: () => void;
}) {
  const label = metadata.label ?? "Khách hàng";
  return (
    <div className="flex items-center gap-2 text-xs">
      {/* Click label/key icon → open dropdown with the full activation
          code + copy button. Lets customer copy the code to use on
          another device without re-asking support. */}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 transition-colors hover:bg-muted/60"
              aria-label="Hiển thị mã kích hoạt"
            >
              <Key className="h-4 w-4 text-green-500" />
              <span className="font-medium">{label}</span>
              <ChevronDown className="size-3 text-muted-foreground" />
            </button>
          }
        />
        <DropdownMenuContent align="end" className="w-72 p-3">
          <ActivationCodeDisplay code={activationCode} />
        </DropdownMenuContent>
      </DropdownMenu>
      <span className="text-muted-foreground">·</span>
      {/* Balance is read-only display now. Detailed usage opens via the
          dedicated UsageStatsButton in the header (see app-header.tsx). */}
      <BalanceDisplay metadata={metadata} />
      <Button
        variant="ghost"
        size="sm"
        onClick={onLogout}
        title="Đăng xuất"
        aria-label="Đăng xuất"
        className="ml-1 size-9 sm:size-7 [&_svg]:size-4 sm:[&_svg]:size-3.5"
      >
        <LogOut />
      </Button>
    </div>
  );
}

/**
 * Shows the full activation code with a copy-to-clipboard button. Used
 * inside the header dropdown so customers can copy + share/save the
 * code to use on other devices. Code itself is shown verbatim — same
 * info the customer typed in when activating, no extra secrets exposed.
 */
function ActivationCodeDisplay({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success("Đã sao chép mã kích hoạt");
      // Reset the icon after a beat so user knows next click also copies.
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Không thể sao chép — copy thủ công từ ô bên dưới");
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">
        Mã kích hoạt của bạn
      </p>
      <div className="flex items-center gap-1.5">
        <code className="flex-1 select-all rounded bg-muted px-2 py-1.5 font-mono text-xs break-all">
          {code}
        </code>
        <Button
          variant="outline"
          size="sm"
          onClick={handleCopy}
          aria-label="Sao chép mã"
          className="size-8 shrink-0 [&_svg]:size-3.5"
        >
          {copied ? <Check className="text-emerald-500" /> : <Copy />}
        </Button>
      </div>
      <p className="text-[11px] leading-snug text-muted-foreground">
        Lưu lại để dùng trên thiết bị khác. Đừng chia sẻ với người
        khác — quota dùng chung.
      </p>
    </div>
  );
}

function BalanceDisplay({ metadata }: { metadata: ActivationMetadata }) {
  if (metadata.mode === "unlimited") {
    return (
      <span className="inline-flex items-center gap-1 font-mono text-muted-foreground">
        <Infinity className="size-3.5" />
        không giới hạn
      </span>
    );
  }
  // Low-balance threshold: 1 EUR ≈ a single std-5s-no-audio video.
  // Customer sees the warning color before they're truly out.
  const lowBalance =
    metadata.remainingEur !== null && metadata.remainingEur < 1;
  return (
    <span
      className={`font-mono ${lowBalance ? "text-amber-500" : "text-muted-foreground"}`}
    >
      {formatVnd(metadata.usedEur)} /{" "}
      {metadata.quotaEur !== null ? formatVnd(metadata.quotaEur) : "?"}
    </span>
  );
}
