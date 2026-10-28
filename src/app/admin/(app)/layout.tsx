import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminNav, BusinessSwitcher } from "@/components/admin/nav";
import { AdminSkeleton } from "@/components/admin/page-header";
import { canManage, requireMember } from "@/server/auth";

export const metadata: Metadata = { title: { default: "Gestione", template: "%s · Gestione" }, robots: { index: false } };

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className="theme-light flex min-h-dvh flex-1 bg-bg text-text">
      <Suspense fallback={<div className="hidden w-60 border-r border-line bg-surface lg:block" />}>
        <Nav />
      </Suspense>
      <main className="min-w-0 flex-1 px-4 pt-6 pb-28 sm:px-8 lg:pb-12">
        <div className="mx-auto max-w-6xl">
          <Suspense fallback={null}>
            <MobileBusinessSwitcher />
          </Suspense>
          <Suspense fallback={<AdminSkeleton />}>{children}</Suspense>
        </div>
      </main>
    </div>
  );
}

async function Nav() {
  const ctx = await requireMember();
  return (
    <AdminNav
      businessId={ctx.business.id}
      businessName={ctx.business.name}
      businesses={ctx.memberships.map((m) => ({ id: m.business_id, name: m.name }))}
      canManage={canManage(ctx.role)}
      userEmail={ctx.user.email ?? ""}
    />
  );
}

/** On phones the sidebar is hidden, so accounts with more than one business switch from here. */
async function MobileBusinessSwitcher() {
  const ctx = await requireMember();
  if (ctx.memberships.length < 2) return null;
  return (
    <BusinessSwitcher
      businessId={ctx.business.id}
      businesses={ctx.memberships.map((m) => ({ id: m.business_id, name: m.name }))}
      className="mb-5 lg:hidden"
    />
  );
}
