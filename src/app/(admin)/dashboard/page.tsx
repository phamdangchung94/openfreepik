import { requireAdmin } from "@/lib/auth/admin-server";

export default async function DashboardHomePage() {
  await requireAdmin("/dashboard");
  return (
    <div className="mx-auto max-w-3xl px-6 py-10 space-y-4">
      <h1 className="text-2xl font-semibold">Admin dashboard</h1>
      <p className="text-sm text-muted-foreground">
        Overview, codes, keys, pricing, and usage panels land in Phase 10c.
      </p>
    </div>
  );
}
