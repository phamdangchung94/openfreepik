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
      {/* Skip link — keyboard users can Tab past the header straight to the form. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      >
        Bỏ qua đến nội dung chính
      </a>
      <AppHeader />
      <main id="main-content" className="flex-1">
        {children}
      </main>
    </div>
  );
}
