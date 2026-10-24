"use client";

import { useRef, useState, useTransition } from "react";
import { cancelAppointmentAction, rescheduleAppointmentAction, setStatusAction } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/misc";
import type { AppointmentStatus } from "@/lib/types";
import { AdminSlotSelect } from "./admin-slot-select";

export function AppointmentActions({
  id,
  status,
  serviceId,
  staffId,
  date,
  time,
  timeZone,
  staff,
  isPast,
  hasEmail,
}: {
  id: string;
  status: AppointmentStatus;
  serviceId: string;
  staffId: string;
  date: string;
  time: string;
  timeZone: string;
  staff: { id: string; display_name: string }[];
  isPast: boolean;
  hasEmail: boolean;
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [mode, setMode] = useState<"none" | "move">("none");
  const [newDate, setNewDate] = useState(date);
  const [newTime, setNewTime] = useState("");
  const [newStaff, setNewStaff] = useState(staffId);
  const [override, setOverride] = useState(false);
  const [reason, setReason] = useState("");
  const [notify, setNotify] = useState(true);
  const dialog = useRef<HTMLDialogElement>(null);

  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      setResult(r.ok ? { ok: true, text: r.message ?? "Fatto." } : { ok: false, text: r.error ?? "Errore" });
      if (r.ok) after?.();
    });

  if (status === "cancelled") return null;

  return (
    <div className="space-y-4">
      {result && (
        <Notice tone={result.ok ? "success" : "error"} title={result.text} />
      )}
      <div className="flex flex-wrap gap-2">
        {status === "confirmed" && (
          <>
            <Button variant="secondary" size="sm" onClick={() => setMode(mode === "move" ? "none" : "move")}>
              Sposta
            </Button>
            {isPast && (
              <>
                <Button size="sm" variant="secondary" loading={pending} onClick={() => run(() => setStatusAction({ id, status: "completed" }))}>
                  Completato
                </Button>
                <Button size="sm" variant="secondary" loading={pending} onClick={() => run(() => setStatusAction({ id, status: "no_show" }))}>
                  Non presentato
                </Button>
              </>
            )}
            <Button size="sm" variant="danger" onClick={() => dialog.current?.showModal()}>
              Annulla appuntamento
            </Button>
          </>
        )}
        {(status === "completed" || status === "no_show") && (
          <Button size="sm" variant="secondary" loading={pending} onClick={() => run(() => setStatusAction({ id, status: "confirmed" }))}>
            Riporta a confermato
          </Button>
        )}
      </div>

      {mode === "move" && (
        <form
          className="space-y-4 rounded-2xl border border-line p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!newTime) return setResult({ ok: false, text: "Scegli un orario." });
            run(() => rescheduleAppointmentAction({ id, date: newDate, time: newTime, staffId: newStaff, allowOverride: override }), () => setMode("none"));
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Data" htmlFor="move-date">
              <Input id="move-date" type="date" value={newDate} onChange={(e) => { setNewDate(e.target.value); setNewTime(""); }} required />
            </Field>
            <Field label="Professionista" htmlFor="move-staff">
              <Select id="move-staff" value={newStaff} onChange={(e) => { setNewStaff(e.target.value); setNewTime(""); }}>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.display_name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">Orario {time && <span className="font-normal text-muted">(attuale {time})</span>}</p>
            <AdminSlotSelect serviceId={serviceId} staffId={newStaff} date={newDate} timeZone={timeZone} value={newTime} onChange={setNewTime} override={override} excludeAppointmentId={id} />
          </div>
          <Checkbox checked={override} onChange={(e) => setOverride(e.target.checked)} label="Ignora orari di apertura e blocchi (le sovrapposizioni restano vietate)" />
          <div className="flex gap-2">
            <Button type="submit" size="sm" loading={pending}>
              Conferma spostamento
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setMode("none")}>
              Chiudi
            </Button>
          </div>
        </form>
      )}

      <dialog ref={dialog} aria-labelledby="cancel-appt" className="m-auto w-[min(92vw,28rem)] rounded-3xl border border-line bg-surface p-0 text-text backdrop:bg-black/50">
        <form
          className="space-y-4 p-6"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => cancelAppointmentAction({ id, reason, notifyCustomer: notify }), () => dialog.current?.close());
          }}
        >
          <h2 id="cancel-appt" className="text-lg font-semibold">
            Annullare l&apos;appuntamento?
          </h2>
          <p className="text-sm text-muted">Lo slot torna libero subito. L&apos;operazione resta nello storico.</p>
          <Field label="Motivo (visibile al cliente)" htmlFor="cancel-reason">
            <Textarea id="cancel-reason" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
          </Field>
          {hasEmail && <Checkbox checked={notify} onChange={(e) => setNotify(e.target.checked)} label="Avvisa il cliente via email" />}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => dialog.current?.close()}>
              Indietro
            </Button>
            <Button type="submit" variant="danger" size="sm" loading={pending}>
              Annulla appuntamento
            </Button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
