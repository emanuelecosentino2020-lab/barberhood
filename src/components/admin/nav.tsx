"use client";

import { CalendarDays, Clock, LayoutDashboard, LogOut, Scissors, Settings, UserRound, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/components/ui/cn";
import { logout } from "@/app/admin/actions";

const ITEMS = [
  { href: "/admin", label: "Oggi", icon: LayoutDashboard, exact: true },
  { href: "/admin/calendario", label: "Calendario", icon: CalendarDays },
  { href: "/admin/clienti", label: "Clienti", icon: UserRound },
  { href: "/admin/servizi", label: "Servizi", icon: Scissors, manage: true },
  { href: "/admin/team", label: "Team", icon: Users, manage: true },
  { href: "/admin/orari", label: "Orari", icon: Clock },
  { href: "/admin/impostazioni", label: "Impostazioni", icon: Settings },
];

export function AdminNav({ businessName, canManage, userEmail }: { businessName: string; canManage: boolean; userEmail: string }) {
  const pathname = usePathname();
  const items = ITEMS.filter((i) => !i.manage || canManage);
  const isActive = (href: string, exact?: boolean) => (exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`));

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-line bg-surface px-3 py-5 lg:flex">
        <div className="px-3">
          <p className="eyebrow">Gestione</p>
          <p className="mt-1 truncate font-semibold">{businessName}</p>
        </div>
        <nav aria-label="Menu principale" className="mt-8 flex flex-1 flex-col gap-0.5">
          {items.map((i) => (
            <Link
              key={i.href}
              href={i.href}
              aria-current={isActive(i.href, i.exact) ? "page" : undefined}
              className={cn(
                "flex h-10 items-center gap-3 rounded-xl px-3 text-sm transition-colors",
                isActive(i.href, i.exact) ? "bg-text text-bg" : "text-muted hover:bg-surface-2 hover:text-text",
              )}
            >
              <i.icon className="size-4" aria-hidden="true" />
              {i.label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-line px-3 pt-4">
          <p className="truncate text-xs text-subtle">{userEmail}</p>
          <form action={logout}>
            <button className="mt-2 inline-flex items-center gap-2 text-sm text-muted hover:text-text">
              <LogOut className="size-4" aria-hidden="true" /> Esci
            </button>
          </form>
        </div>
      </aside>

      {/* Mobile bottom bar */}
      <nav aria-label="Menu principale" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        <ul className="flex overflow-x-auto [scrollbar-width:none]">
          {items.map((i) => (
            <li key={i.href} className="min-w-[4.5rem] flex-1">
              <Link
                href={i.href}
                aria-current={isActive(i.href, i.exact) ? "page" : undefined}
                className={cn(
                  "flex h-16 flex-col items-center justify-center gap-1 text-[0.7rem]",
                  isActive(i.href, i.exact) ? "text-text" : "text-subtle",
                )}
              >
                <i.icon className="size-5" aria-hidden="true" />
                {i.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
