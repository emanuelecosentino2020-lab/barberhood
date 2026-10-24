"use client";

import { useEffect, useState } from "react";
import { adminSlots } from "@/app/admin/actions";
import { cn } from "@/components/ui/cn";
import { Spinner } from "@/components/ui/spinner";
import { timeIn } from "@/components/booking/zoned";

/**
 * Free times for a service/staff/date computed on the server. When
 * `override` is on, a free-form time input replaces the grid (overlaps are
 * still refused by the database).
 */
export function AdminSlotSelect({
  serviceId,
  staffId,
  date,
  timeZone,
  value,
  onChange,
  override,
  excludeAppointmentId,
}: {
  serviceId: string;
  staffId: string;
  date: string;
  timeZone: string;
  value: string; // "HH:MM"
  onChange: (time: string) => void;
  override: boolean;
  excludeAppointmentId?: string;
}) {
  const [slots, setSlots] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (override || !serviceId || !staffId || !date) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset while loading new data
    setSlots(null);
    setError(null);
    adminSlots({ serviceId, staffId, date, excludeAppointmentId }).then((r) => {
      if (cancelled) return;
      if (r.ok) setSlots((r.data ?? []).map((s) => timeIn(s.start, timeZone)));
      else setError(r.error);
    });
    return () => {
      cancelled = true;
    };
  }, [serviceId, staffId, date, override, excludeAppointmentId, timeZone]);

  if (override) {
    return (
      <input
        type="time"
        step={300}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-12 w-40 rounded-xl border border-line bg-surface px-4 text-text focus:border-text focus:outline-none"
        aria-label="Orario"
        required
      />
    );
  }
  if (!serviceId || !staffId || !date) return <p className="text-sm text-muted">Scegli servizio, professionista e data.</p>;
  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!slots) return <Spinner label="Caricamento orari" className="size-5 text-muted" />;
  if (slots.length === 0) return <p className="text-sm text-muted">Nessun orario libero in questa data. Puoi attivare “Ignora orari”.</p>;
  return (
    <div className="grid grid-cols-4 gap-2 sm:grid-cols-6" role="radiogroup" aria-label="Orari disponibili">
      {slots.map((t) => (
        <button
          key={t}
          type="button"
          role="radio"
          aria-checked={value === t}
          onClick={() => onChange(t)}
          className={cn("tabular h-10 rounded-lg border text-sm", value === t ? "border-text bg-text text-bg" : "border-line-strong hover:border-text")}
        >
          {t}
        </button>
      ))}
    </div>
  );
}
