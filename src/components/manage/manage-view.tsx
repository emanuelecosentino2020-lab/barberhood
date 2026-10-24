"use client";

import { CalendarPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { SlotPicker, type FetchDays } from "@/components/booking/slot-picker";
import { googleCalendarLink, longDateTimeIn } from "@/components/booking/zoned";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import { Notice, StatusBadge } from "@/components/ui/misc";
import { formatPrice } from "@/lib/format";
import type { AppointmentStatus } from "@/lib/types";

export interface ManageProps {
  token: string;
  status: AppointmentStatus;
  startsAt: string;
  endsAt: string;
  serviceName: string;
  priceCents: number;
  staffName: string;
  customerFirstName: string;
  canModify: boolean;
  modifyDeadline: string;
  business: {
    slug: string;
    name: string;
    timezone: string;
    currency: string;
    phone: string | null;
    address: string | null;
    maxAdvanceDays: number;
    cancellationCutoffHours: number;
  };
}

type Mode = "view" | "reschedule" | "cancel";

export function ManageView(props: ManageProps) {
  const { business: b } = props;
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("view");
  const [slot, setSlot] = useState<{ start: string; staffIds: string[] } | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const fetchDays: FetchDays = useCallback(
    async (from, days) => {
      const res = await fetch(`/api/manage/${props.token}/availability?from=${from}&days=${days}`, { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error?.message ?? "Impossibile caricare gli orari.");
      return json;
    },
    [props.token],
  );

  async function post(path: string, body: unknown): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/manage/${props.token}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.error?.message ?? "Operazione non riuscita. Riprova.");
        if (res.status === 409) setReloadKey((k) => k + 1);
        return false;
      }
      return true;
    } catch {
      setError("Connessione assente. Riprova: nessuna modifica è stata salvata.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function confirmReschedule() {
    if (!slot) return;
    if (await post("reschedule", { startsAt: slot.start })) {
      setDone(`Fatto. Il nuovo appuntamento è ${longDateTimeIn(slot.start, b.timezone)}.`);
      setMode("view");
      setSlot(null);
      router.refresh();
    }
  }

  async function confirmCancel() {
    if (await post("cancel", { reason: reason || undefined })) {
      dialogRef.current?.close();
      setDone("Appuntamento annullato. Grazie per averci avvisato.");
      setMode("view");
      router.refresh();
    }
  }

  const calendar = googleCalendarLink({
    title: `${props.serviceName} · ${b.name}`,
    start: props.startsAt,
    end: props.endsAt,
    location: b.address ?? undefined,
    timeZone: b.timezone,
  });

  return (
    <div className="space-y-8">
      <div>
        <p className="eyebrow">La tua prenotazione</p>
        <h1 className="display mt-4 text-4xl sm:text-5xl">
          {props.status === "cancelled" ? "Appuntamento annullato" : `Ciao ${props.customerFirstName}`}
        </h1>
      </div>

      {done && <Notice tone="success" title={done} />}

      <dl className="divide-y divide-line rounded-2xl border border-line bg-surface">
        <Row label="Stato">
          <StatusBadge status={props.status} />
        </Row>
        <Row label="Servizio">{props.serviceName}</Row>
        <Row label="Quando">
          <span className="first-letter:uppercase">{longDateTimeIn(props.startsAt, b.timezone)}</span>
        </Row>
        {props.staffName && <Row label="Con">{props.staffName}</Row>}
        <Row label="Prezzo">{formatPrice(props.priceCents, b.currency)}</Row>
        {b.address && <Row label="Dove">{b.address}</Row>}
      </dl>

      {props.status === "confirmed" && !props.canModify && (
        <Notice title="Modifiche online non più disponibili">
          Mancano meno di {b.cancellationCutoffHours} ore all&apos;appuntamento.{" "}
          {b.phone ? (
            <>
              Per cambiamenti chiama il negozio al{" "}
              <a className="text-text underline underline-offset-4" href={`tel:${b.phone.replace(/\s/g, "")}`}>
                {b.phone}
              </a>
              .
            </>
          ) : (
            "Contatta direttamente il negozio."
          )}
        </Notice>
      )}

      {props.status === "confirmed" && props.canModify && mode === "view" && (
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button size="lg" onClick={() => setMode("reschedule")}>
            Sposta appuntamento
          </Button>
          <a
            href={calendar}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-13 items-center justify-center gap-2 rounded-full border border-line-strong px-7 font-medium hover:border-text"
          >
            <CalendarPlus className="size-4" aria-hidden="true" /> Calendario
          </a>
          <Button
            size="lg"
            variant="danger"
            onClick={() => {
              setError(null);
              dialogRef.current?.showModal();
            }}
          >
            Annulla appuntamento
          </Button>
        </div>
      )}

      {mode === "reschedule" && (
        <section aria-labelledby="reschedule-title" className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 id="reschedule-title" className="text-lg font-medium">
              Scegli il nuovo orario
            </h2>
            <button type="button" className="text-sm text-muted underline-offset-4 hover:text-text hover:underline" onClick={() => setMode("view")}>
              Annulla
            </button>
          </div>
          {error && <Notice tone="error">{error}</Notice>}
          <SlotPicker
            timeZone={b.timezone}
            maxDays={b.maxAdvanceDays}
            fetchDays={fetchDays}
            selected={slot}
            reloadKey={reloadKey}
            onSelect={(s) => {
              setError(null);
              setSlot(s);
            }}
          />
          {slot && (
            <div className="sticky bottom-0 -mx-5 border-t border-line bg-bg/95 px-5 py-4 backdrop-blur">
              <p className="mb-3 text-sm text-muted first-letter:uppercase">{longDateTimeIn(slot.start, b.timezone)}</p>
              <Button size="lg" className="w-full" loading={busy} onClick={confirmReschedule}>
                Conferma nuovo orario
              </Button>
            </div>
          )}
        </section>
      )}

      <dialog
        ref={dialogRef}
        aria-labelledby="cancel-title"
        className="m-auto w-[min(92vw,28rem)] rounded-3xl border border-line bg-surface p-0 text-text backdrop:bg-black/70"
      >
        <form
          method="dialog"
          className="space-y-5 p-6"
          onSubmit={(e) => {
            e.preventDefault();
            void confirmCancel();
          }}
        >
          <h2 id="cancel-title" className="text-xl font-medium">
            Vuoi annullare l&apos;appuntamento?
          </h2>
          <p className="text-sm text-muted">Lo slot tornerà disponibile per altri clienti. L&apos;operazione non si può annullare.</p>
          <Field label="Motivo (facoltativo)" htmlFor="reason">
            <Textarea id="reason" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
          </Field>
          {error && <Notice tone="error">{error}</Notice>}
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" onClick={() => dialogRef.current?.close()} disabled={busy}>
              Mantieni
            </Button>
            <Button type="submit" variant="danger" loading={busy}>
              Sì, annulla
            </Button>
          </div>
        </form>
      </dialog>

      <p className="text-sm text-subtle">
        Questo link è personale: non condividerlo. Vale fino all&apos;orario dell&apos;appuntamento.
      </p>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4 px-5 py-4">
      <dt className="w-24 shrink-0 pt-0.5 text-sm text-muted">{label}</dt>
      <dd className="min-w-0 flex-1 font-medium">{children}</dd>
    </div>
  );
}
