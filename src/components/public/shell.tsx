import type { ReactNode } from "react";
import { themeStyle } from "@/lib/theme";
import type { PublicBusiness } from "@/lib/types";

/** Applies the business theme (dark base + brand accent) to a public page. */
export function PublicShell({ business, children }: { business: Pick<PublicBusiness, "theme"> | null; children: ReactNode }) {
  return (
    <div className="theme-dark flex min-h-dvh flex-1 flex-col bg-bg text-text" style={themeStyle(business?.theme)}>
      {children}
    </div>
  );
}

export function PublicPageSkeleton() {
  return (
    <div className="theme-dark flex min-h-dvh flex-1 flex-col bg-bg">
      <div className="h-16 border-b border-line" />
      <div className="mx-auto w-full max-w-6xl px-5 pt-16">
        <div className="skeleton h-4 w-24" />
        <div className="skeleton mt-6 h-20 w-full max-w-lg" />
        <div className="skeleton mt-6 h-5 w-72" />
        <div className="skeleton mt-10 h-13 w-56 rounded-full" />
      </div>
    </div>
  );
}
