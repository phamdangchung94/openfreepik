"use client";

import { useEffect, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

interface KeyRow {
  id: string;
  label: string;
  assignedEur: string;
  usedEur: string;
  isActive: boolean;
  notes: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

export default function AdminKeysPage() {
  const [rows, setRows] = useState<KeyRow[]>([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/keys");
      const json = await res.json();
      if (json.ok) setRows(json.keys);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-4 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Freepik keys</h1>
          <p className="text-sm text-muted-foreground">
            {rows.length} {rows.length === 1 ? "key" : "keys"} in the rotation
            pool. Spend tracked locally — Freepik exposes no balance API, so
            verify against the Magnific dashboard periodically.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={load}
            disabled={loading}
          >
            <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <AddKeyDialog onAdded={load} />
        </div>
      </header>

      <div className="grid gap-3 md:grid-cols-2">
        {rows.map((k) => (
          <KeyCard key={k.id} row={k} onChanged={load} />
        ))}
        {rows.length === 0 && (
          <Card className="md:col-span-2">
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              No Freepik keys yet — add one so customers can generate.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function KeyCard({ row, onChanged }: { row: KeyRow; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const used = Number(row.usedEur);
  const assigned = Number(row.assignedEur);
  const pct = assigned > 0 ? (used / assigned) * 100 : 0;

  async function toggle() {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/keys/${row.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isActive: !row.isActive }),
      });
      if (!res.ok) toast.error("Update failed");
      else {
        toast.success(row.isActive ? "Key deactivated" : "Key reactivated");
        onChanged();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-medium">{row.label}</h3>
            {row.notes && (
              <p className="text-[11px] text-muted-foreground">{row.notes}</p>
            )}
          </div>
          <Badge
            variant={row.isActive ? "default" : "secondary"}
            className="text-[10px]"
          >
            {row.isActive ? "active" : "inactive"}
          </Badge>
        </div>

        <div className="space-y-1">
          <div className="flex items-baseline justify-between text-xs">
            <span className="text-muted-foreground">Spent</span>
            <span className="font-mono">
              {used.toFixed(2)} / {assigned.toFixed(2)} EUR
            </span>
          </div>
          <Progress value={pct} className="h-1.5" />
        </div>

        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>
            Last used:{" "}
            {row.lastUsedAt
              ? new Date(row.lastUsedAt).toLocaleString()
              : "never"}
          </span>
          <Button
            variant="ghost"
            size="xs"
            onClick={toggle}
            disabled={busy}
          >
            {row.isActive ? "Deactivate" : "Reactivate"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function AddKeyDialog({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [plaintextKey, setPlaintextKey] = useState("");
  const [assignedEur, setAssignedEur] = useState("500");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/admin/keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          label,
          plaintextKey,
          assignedEur: Number(assignedEur),
          notes: notes || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json.message ?? "Add failed");
        return;
      }
      toast.success("Key added");
      setLabel("");
      setPlaintextKey("");
      setAssignedEur("500");
      setNotes("");
      setOpen(false);
      onAdded();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm">
            <Plus className="size-3.5" />
            Add key
          </Button>
        }
      />
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Freepik key</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Label</Label>
            <Input
              placeholder="e.g. Account 2 — alice@example.com"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Freepik API key (plaintext)</Label>
            <Input
              type="password"
              placeholder="FPSX..."
              value={plaintextKey}
              onChange={(e) => setPlaintextKey(e.target.value)}
              required
              autoComplete="off"
            />
            <p className="text-[10px] text-muted-foreground">
              Stored AES-GCM encrypted. Plaintext is never persisted in logs.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Assigned budget (EUR)</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={assignedEur}
              onChange={(e) => setAssignedEur(e.target.value)}
            />
            <p className="text-[10px] text-muted-foreground">
              Default 500 — Freepik&apos;s free-tier credit per account.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Notes (optional)</Label>
            <Textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Adding..." : "Add key"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
