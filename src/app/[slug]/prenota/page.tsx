import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BookingFlow } from "@/components/booking/booking-flow";
import { PublicShell } from "@/components/public/shell";
import { getPublicCatalog } from "@/server/public";
import { publicBasePath } from "@/server/tenant";

export const metadata: Metadata = { title: "Prenota", robots: { index: false } };

export default function Page(props: PageProps<"/[slug]/prenota">) {
  return (
    <Suspense fallback={<FlowSkeleton />}>
      <Content {...props} />
    </Suspense>
  );
}

async function Content({ params, searchParams }: PageProps<"/[slug]/prenota">) {
  const { slug } = await params;
  const sp = await searchParams;
  const catalog = await getPublicCatalog(slug);
  if (!catalog) notFound();
  const b = catalog.business;
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : null);
  return (
    <PublicShell business={b}>
      <BookingFlow
        basePath={await publicBasePath(slug)}
        business={{
          slug: b.slug,
          name: b.name,
          theme: b.theme,
          timezone: b.timezone,
          currency: b.currency,
          staff_label: b.staff_label,
          max_advance_days: b.max_advance_days,
          require_phone: b.require_phone,
          allow_staff_choice: b.allow_staff_choice,
          cancellation_cutoff_hours: b.cancellation_cutoff_hours,
          address: [b.address_line, b.city].filter(Boolean).join(", ") || null,
        }}
        services={catalog.services}
        staff={catalog.staff}
        initialServiceId={one(sp.servizio)}
        initialStaffId={one(sp.staff)}
      />
    </PublicShell>
  );
}

function FlowSkeleton() {
  return (
    <div className="theme-dark flex min-h-dvh flex-1 flex-col bg-bg">
      <div className="h-16 border-b border-line" />
      <div className="mx-auto w-full max-w-2xl px-5 pt-8">
        <div className="skeleton h-3 w-24" />
        <div className="skeleton mt-10 h-10 w-64" />
        <div className="mt-8 space-y-2.5">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="skeleton h-18 rounded-2xl" />
          ))}
        </div>
      </div>
    </div>
  );
}
