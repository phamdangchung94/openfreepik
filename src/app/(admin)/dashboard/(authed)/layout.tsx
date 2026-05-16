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
    <div className="flex min-h-screen flex-col md:flex-row">
      {/* DashboardNav internally renders the top bar on mobile and
          the side rail on md+ — keep the layout container neutral so
          neither layer fights for position. */}
      <DashboardNav />
      <main className="min-w-0 flex-1 overflow-x-hidden">{children}</main>
    </div>
  );
}
