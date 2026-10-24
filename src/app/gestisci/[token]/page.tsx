import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ManageView } from "@/components/manage/manage-view";
import { BrandMark } from "@/components/public/brand-mark";
import { PublicShell } from "@/components/public/shell";
import { getManagedAppointment } from "@/server/bookings";

export const metadata: Metadata = { title: "La tua prenotazione", robots: { index: false, follow: false } };

export default function Page({ params }: PageProps<"/gestisci/[token]">) {
  return (
    <Suspense
      fallback={
        <div className="theme-dark min-h-dvh flex-1 bg-bg px-5 pt-24">
          <div className="mx-auto max-w-2xl space-y-4">
            <div className="skeleton h-10 w-64" />
            <div className="skeleton h-64 w-full rounded-2xl" />
          </div>
        </div>
      }
    >
      <Content params={params} />
    </Suspense>
  );
}

async function Content({ params }: { params: PageProps<"/gestisci/[token]">["params"] }) {
  const { token } = await params;
  const appt = await getManagedAppointment(token);

  if (!appt) {
    return (
      <PublicShell business={null}>
        <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-5 py-20 text-center">
          <h1 className="display text-4xl">Link non valido o scaduto</h1>
          <p className="mt-4 text-muted">
            Il link potrebbe essere incompleto oppure l&apos;appuntamento è già passato. Controlla l&apos;ultima email ricevuta o contatta
            il negozio.
          </p>
        </main>
      </PublicShell>
    );
  }

  const b = appt.business;
  return (
    <PublicShell business={b}>
      <header className="border-b border-line">
        <div className="mx-auto flex h-16 max-w-2xl items-center px-5">
          <Link href={`/${b.slug}`} aria-label={b.name}>
            <BrandMark business={b} className="h-5 w-auto" />
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl flex-1 px-5 pt-10 pb-20">
        <ManageView
          token={token}
          status={appt.status}
          startsAt={appt.startsAt}
          endsAt={appt.endsAt}
          serviceName={appt.serviceName}
          priceCents={appt.priceCents}
          staffName={appt.staffName}
          customerFirstName={appt.customerFirstName}
          canModify={appt.canModify}
          modifyDeadline={appt.modifyDeadline}
          business={{
            slug: b.slug,
            name: b.name,
            timezone: b.timezone,
            currency: b.currency,
            phone: b.phone,
            address: [b.address_line, b.city].filter(Boolean).join(", ") || null,
            maxAdvanceDays: b.max_advance_days,
            cancellationCutoffHours: b.cancellation_cutoff_hours,
          }}
        />
      </main>
    </PublicShell>
  );
}
