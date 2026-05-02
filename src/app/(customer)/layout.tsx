import { AppHeader } from "@/components/layout/app-header";

/**
 * Layout for customer-facing routes only. Wraps children with the AppHeader
 * (activation code input, auto-download toggle, theme toggle) — admin
 * dashboard pages skip this entirely via the (admin) route group.
 */
export default function CustomerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen flex-col">
      <AppHeader />
      <main className="flex-1">{children}</main>
    </div>
  );
}
