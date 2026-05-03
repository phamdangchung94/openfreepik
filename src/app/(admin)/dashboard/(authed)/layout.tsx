import { requireAdmin } from "@/lib/auth/admin-server";
import { DashboardNav } from "@/components/dashboard/dashboard-nav";

/**
 * Layout for authenticated dashboard pages. The (authed) route group
 * keeps /dashboard/login outside this tree so the login form doesn't
 * recursively redirect itself.
 */
export default async function AuthedDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdmin();
  return (
    <div className="flex min-h-screen">
      <DashboardNav />
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
