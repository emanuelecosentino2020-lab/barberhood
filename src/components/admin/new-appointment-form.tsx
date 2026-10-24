"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { createAppointmentAction, searchCustomersAction } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/misc";
import { formatDuration, formatPrice } from "@/lib/format";
import { AdminSlotSelect } from "./admin-slot-select";

interface Svc {
  id: string;
  name: string;
  price_cents: number;
  duration_minutes: number;
  is_active: boolean;
  staffIds: string[];
}
interface Customer {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
}

/** Converts a local date/time in the business zone to ISO, computed on the server-validated offset list */
function zonedIso(date: string, time: string, timeZone: string): string {
  // Find the UTC instant whose wall-clock time in `timeZone` equals date+time
  const guess = Date.parse(`${date}T${time}:00Z`);
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  let t = guess;
  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(fmt.formatToParts(new Date(t)).map((p) => [p.type, p.value]));
    const wall = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour === "24" ? "00" : parts.hour}:${parts.minute}:00Z`);
    t += guess - wall;
  }
  return new Date(t).toISOString();
}

export function NewAppointmentForm({
  services,
  staff,
  timeZone,
  currency,
  initial,
}: {
  services: Svc[];
  staff: { id: string; display_name: string }[];
  timeZone: string;
  currency: string;
  initial: { date: string; time: string | null; staffId: string | null };
}) {
  const router = useRouter();
  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  const service = services.find((s) => s.id === serviceId);
  const eligible = useMemo(() => staff.filter((p) => service?.staffIds.includes(p.id)), [service, staff]);
  const [staffId, setStaffId] = useState(initial.staffId ?? "");
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time ?? "");
  const [override, setOverride] = useState(false);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Customer[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const effectiveStaff = eligible.some((p) => p.id === staffId) ? staffId : (eligible[0]?.id ?? "");

  useEffect(() => {
    if (query.trim().length < 2) return;
    const t = setTimeout(async () => {
      const r = await searchCustomersAction(query);
      if (r.ok) setResults(r.data ?? []);
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!time) return setError("Scegli un orario.");
    if (!customer && name.trim().length < 1) return setError("Inserisci il nome del cliente o selezionane uno esistente.");
    start(async () => {
      const r = await createAppointmentAction({
        serviceId,
        staffId: effectiveStaff,
        startsAt: zonedIso(date, time, timeZone),
        customerId: customer?.id,
        name: customer ? undefined : name,
        email: customer ? undefined : email,
        phone: customer ? undefined : phone,
        note: note || undefined,
        allowOverride: override,
      });
      if (!r.ok) return setError(r.error);
      router.push(`/admin/appuntamenti/${r.data!.id}`);
    });
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Servizio" htmlFor="svc">
          <Select id="svc" value={serviceId} onChange={(e) => { setServiceId(e.target.value); setTime(""); }}>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {formatDuration(s.duration_minutes)} · {formatPrice(s.price_cents, currency)}
                {s.is_active ? "" : " (non attivo online)"}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Professionista" htmlFor="staff">
          <Select id="staff" value={effectiveStaff} onChange={(e) => { setStaffId(e.target.value); setTime(""); }}>
            {eligible.map((s) => (
              <option key={s.id} value={s.id}>
                {s.display_name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Data" htmlFor="date">
          <Input id="date" type="date" value={date} onChange={(e) => { setDate(e.target.value); setTime(""); }} required />
        </Field>
      </div>

      <div>
        <p className="mb-2 text-sm font-medium">Orario</p>
        <AdminSlotSelect serviceId={serviceId} staffId={effectiveStaff} date={date} timeZone={timeZone} value={time} onChange={setTime} override={override} />
        <Checkbox className="mt-3" checked={override} onChange={(e) => setOverride(e.target.checked)} label="Ignora orari di apertura e blocchi (es. appuntamento fuori orario). Le sovrapposizioni restano vietate." />
      </div>

      <fieldset className="space-y-4 rounded-2xl border border-line p-4">
        <legend className="px-1 text-sm font-medium">Cliente</legend>
        {customer ? (
          <div className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 p-3">
            <div>
              <p className="font-medium">{customer.full_name}</p>
              <p className="text-sm text-muted">{[customer.phone, customer.email].filter(Boolean).join(" · ")}</p>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => setCustomer(null)}>
              Cambia
            </Button>
          </div>
        ) : (
          <>
            <Field label="Cerca cliente esistente" htmlFor="search">
              <Input id="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nome, telefono o email" autoComplete="off" />
            </Field>
            {query.trim().length >= 2 && results.length > 0 && (
              <ul className="divide-y divide-line rounded-xl border border-line">
                {results.map((c) => (
                  <li key={c.id}>
                    <button type="button" className={cn("w-full px-3 py-2.5 text-left text-sm hover:bg-surface-2")} onClick={() => { setCustomer(c); setQuery(""); setResults([]); }}>
                      <span className="font-medium">{c.full_name}</span> <span className="text-muted">{[c.phone, c.email].filter(Boolean).join(" · ")}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-sm text-muted">Oppure nuovo cliente:</p>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Nome" htmlFor="name">
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
              </Field>
              <Field label="Telefono" htmlFor="phone">
                <Input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="off" />
              </Field>
              <Field label="Email (per conferme)" htmlFor="email">
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
              </Field>
            </div>
          </>
        )}
        <Field label="Nota" htmlFor="note">
          <Textarea id="note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </fieldset>

      {error && <Notice tone="error">{error}</Notice>}
      <Button type="submit" size="lg" loading={pending}>
        Crea appuntamento
      </Button>
    </form>
  );
}
