"use client";

import { useEffect, useState } from "react";
import { Key, LogOut, Infinity } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAuthStore, type ActivationMetadata } from "@/store/auth-store";

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
          toast.error(json.message ?? "Activation failed");
        } else {
          // Silent re-validation failed (revoked/expired) — log out the client.
          clear();
          toast.error(json.message ?? "Activation revoked");
        }
        return;
      }
      const meta: ActivationMetadata = json.metadata;
      if (activationCode === code) {
        setMetadata(meta);
      } else {
        setActivation(code, meta);
        setDraft("");
        toast.success(meta.label ? `Welcome, ${meta.label}` : "Activated");
      }
    } catch (err) {
      console.error("[activate]", err);
      if (!opts?.silent) toast.error("Network error — please retry");
    } finally {
      setBusy(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const code = draft.trim();
    if (code.length < 8) {
      toast.error("Code looks too short");
      return;
    }
    activate(code);
  }

  // Activated state — show label + balance + logout
  if (activationCode && metadata) {
    return <ActivatedDisplay metadata={metadata} onLogout={clear} />;
  }

  // Hydration in progress (code in localStorage but metadata not yet loaded)
  if (activationCode && !metadata) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Key className="h-4 w-4" />
        <span>Activating...</span>
      </div>
    );
  }

  // Not activated — show input form
  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-1.5">
      <Key className="h-4 w-4 shrink-0 text-amber-500" />
      <Input
        type="text"
        placeholder="Enter activation code"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        disabled={busy}
        className="h-8 w-[260px] text-xs font-mono"
        autoComplete="off"
        spellCheck={false}
      />
      <Button type="submit" size="xs" disabled={busy || draft.trim().length < 8}>
        {busy ? "..." : "Activate"}
      </Button>
    </form>
  );
}

function ActivatedDisplay({
  metadata,
  onLogout,
}: {
  metadata: ActivationMetadata;
  onLogout: () => void;
}) {
  const label = metadata.label ?? "Customer";
  return (
    <div className="flex items-center gap-2 text-xs">
      <Key className="h-4 w-4 text-green-500" />
      <span className="font-medium">{label}</span>
      <span className="text-muted-foreground">·</span>
      <BalanceDisplay metadata={metadata} />
      <Button
        variant="ghost"
        size="xs"
        onClick={onLogout}
        title="Log out"
        className="ml-1"
      >
        <LogOut className="size-3.5" />
      </Button>
    </div>
  );
}

function BalanceDisplay({ metadata }: { metadata: ActivationMetadata }) {
  if (metadata.mode === "unlimited") {
    return (
      <span className="inline-flex items-center gap-1 font-mono text-muted-foreground">
        <Infinity className="size-3.5" />
        unlimited
      </span>
    );
  }
  const used = metadata.usedEur.toFixed(2);
  const quota = metadata.quotaEur?.toFixed(2) ?? "?";
  const lowBalance =
    metadata.remainingEur !== null && metadata.remainingEur < 1;
  return (
    <span
      className={`font-mono ${lowBalance ? "text-amber-500" : "text-muted-foreground"}`}
    >
      {used} / {quota} EUR
    </span>
  );
}
