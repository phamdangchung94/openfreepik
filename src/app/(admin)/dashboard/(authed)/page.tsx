import { headers } from "next/headers";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { formatVndWithEur } from "@/lib/format-currency";

interface Overview {
  codes: { total: number; active: number; totalUsedEur: number };
  keys: {
    total: number;
    active: number;
    totalAssignedEur: number;
    totalUsedEur: number;
    remainingEur: number;
  };
  usage7d: { videos: number; eur: number };
  usageToday: { videos: number; eur: number };
}

async function fetchOverview(): Promise<Overview | null> {
  const hdr = await headers();
  const cookie = hdr.get("cookie") ?? "";
  const host = hdr.get("host") ?? "localhost:3000";
  const proto = hdr.get("x-forwarded-proto") ?? "http";
  const res = await fetch(`${proto}://${host}/api/admin/overview`, {
    headers: { cookie },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const json = await res.json();
  return json.ok ? (json as Overview) : null;
}

export default async function DashboardOverviewPage() {
  const data = await fetchOverview();
  if (!data) {
    return (
      <div className="p-6">
        <p className="text-sm text-destructive">Failed to load overview.</p>
      </div>
    );
  }

  const keyPct =
    data.keys.totalAssignedEur > 0
      ? (data.keys.totalUsedEur / data.keys.totalAssignedEur) * 100
      : 0;

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Overview</h1>
        <p className="text-sm text-muted-foreground">
          Activation codes, Freepik key pool, and recent usage.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Active codes"
          value={data.codes.active}
          sub={`${data.codes.total} total`}
        />
        <StatCard
          label="Active keys"
          value={data.keys.active}
          sub={`${data.keys.total} total`}
        />
        <StatCard
          label="Today"
          value={data.usageToday.videos}
          sub={formatVndWithEur(data.usageToday.eur)}
          unit="videos"
        />
        <StatCard
          label="Last 7 days"
          value={data.usage7d.videos}
          sub={formatVndWithEur(data.usage7d.eur)}
          unit="videos"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">API key pool budget</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-baseline justify-between text-xs">
            <span>Used across all keys</span>
            <span className="font-mono">
              {formatVndWithEur(data.keys.totalUsedEur)} /{" "}
              {formatVndWithEur(data.keys.totalAssignedEur)}
            </span>
          </div>
          <Progress value={keyPct} className="h-1.5" />
          <p className="text-xs text-muted-foreground">
            {formatVndWithEur(data.keys.remainingEur)} remaining · customers
            have spent {formatVndWithEur(data.codes.totalUsedEur)}{" "}
            cumulatively (revenue).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  unit,
}: {
  label: string;
  value: number;
  sub: string;
  unit?: string;
}) {
  return (
    <Card>
      <CardContent className="space-y-1 p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <div className="flex items-baseline gap-1">
          <span className="text-3xl font-bold tabular-nums">{value}</span>
          {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
        </div>
        <p className="font-mono text-[11px] text-muted-foreground">{sub}</p>
      </CardContent>
    </Card>
  );
}
