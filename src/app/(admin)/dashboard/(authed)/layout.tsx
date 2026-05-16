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
      {/* DashboardNav renders the top bar + bottom tab bar on mobile,
          and the side rail on md+. Keep the layout container neutral. */}
      <DashboardNav />
      {/* pb-20 reserves space for the fixed bottom tab bar on mobile
          (tab height + iOS safe area). Reset to 0 on md+ where the
          tab bar is hidden. */}
      <main className="min-w-0 flex-1 overflow-x-hidden pb-20 md:pb-0">
        {children}
      </main>
    </div>
  );
}
