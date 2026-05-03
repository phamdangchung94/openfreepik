"use client";

import { useEffect, useState } from "react";
import { RefreshCw, Save, Volume2, VolumeX } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

interface PricingRow {
  id: string;
  endpoint: string;
  tier: "pro" | "std" | null;
  durationSeconds: number | null;
  withAudio: boolean;
  costEur: string;
}

export default function AdminPricingPage() {
  const [rows, setRows] = useState<PricingRow[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/pricing");
      const json = await res.json();
      if (json.ok) {
        setRows(json.rules);
        setDraft({});
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function save(id: string) {
    const value = draft[id];
    if (value === undefined) return;
    const cost = Number(value);
    if (!Number.isFinite(cost) || cost < 0) {
      toast.error("Invalid cost");
      return;
    }
    setSaving(id);
    try {
      const res = await fetch(`/api/admin/pricing/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ costEur: cost }),
      });
      if (!res.ok) {
        toast.error("Save failed");
      } else {
        toast.success("Updated");
        await load();
      }
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="space-y-4 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Pricing rules</h1>
          <p className="text-sm text-muted-foreground">
            Edit cost per (endpoint × tier × duration × audio). Changes apply
            to the next request.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={load}
          disabled={loading}
        >
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </header>

      <Card>
        <CardContent className="p-0">
          <ScrollArea className="max-h-[calc(100vh-200px)]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/60 backdrop-blur">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Endpoint</th>
                  <th className="px-3 py-2 text-left font-medium">Tier</th>
                  <th className="px-3 py-2 text-left font-medium">Duration</th>
                  <th className="px-3 py-2 text-left font-medium">Audio</th>
                  <th className="px-3 py-2 text-right font-medium">Cost (EUR)</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const dirty = draft[r.id] !== undefined && draft[r.id] !== r.costEur;
                  return (
                    <tr key={r.id} className="border-t">
                      <td className="px-3 py-2 font-mono text-[11px]">
                        {r.endpoint}
                      </td>
                      <td className="px-3 py-2">
                        {r.tier ? (
                          <Badge variant="secondary" className="text-[10px]">
                            {r.tier}
                          </Badge>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {r.durationSeconds ? `${r.durationSeconds}s` : "—"}
                      </td>
                      <td className="px-3 py-2">
                        {r.withAudio ? (
                          <Volume2 className="size-3.5 text-foreground" />
                        ) : (
                          <VolumeX className="size-3.5 text-muted-foreground" />
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={draft[r.id] ?? r.costEur}
                          onChange={(e) =>
                            setDraft((d) => ({ ...d, [r.id]: e.target.value }))
                          }
                          className="ml-auto h-7 w-24 text-right font-mono text-xs"
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          variant={dirty ? "default" : "ghost"}
                          size="xs"
                          disabled={!dirty || saving === r.id}
                          onClick={() => save(r.id)}
                        >
                          {saving === r.id ? "..." : <Save className="size-3" />}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
