"use client";

import { ChevronDown, ChevronUp, Plus } from "lucide-react";
import { useState, useTransition } from "react";
import { moveServiceAction, saveServiceAction } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/field";
import { Card, EmptyState, Notice } from "@/components/ui/misc";
import { formatDuration, formatPrice } from "@/lib/format";
import type { Service } from "@/lib/types";

type Svc = Service & { staffIds: string[] };
type StaffLite = { id: string; display_name: string; is_active: boolean };

function centsToInput(cents: number) {
  return (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2).replace(".", ",");
}

function ServiceForm({ service, staff, staffLabel, onDone }: { service: Svc | null; staff: StaffLite[]; staffLabel: string; onDone: () => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [staffIds, setStaffIds] = useState<string[]>(service?.staffIds ?? staff.filter((s) => s.is_active).map((s) => s.id));
  const prefix = service?.id ?? "new";

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setError(null);
        start(async () => {
          const r = await saveServiceAction(service?.id ?? null, {
            name: String(f.get("name") ?? ""),
            description: String(f.get("description") ?? ""),
            price: String(f.get("price") ?? ""),
            duration_minutes: Number(f.get("duration")),
            buffer_after_minutes: Number(f.get("buffer") || 0),
            is_active: f.get("is_active") === "on",
            staff_ids: staffIds,
          });
          if (!r.ok) setError(r.error);
          else onDone();
        });
      }}
    >
      <Field label="Nome" htmlFor={`${prefix}-name`}>
        <Input id={`${prefix}-name`} name="name" defaultValue={service?.name} required maxLength={120} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Prezzo (€)" htmlFor={`${prefix}-price`}>
          <Input id={`${prefix}-price`} name="price" inputMode="decimal" defaultValue={service ? centsToInput(service.price_cents) : ""} required placeholder="18" />
        </Field>
        <Field label="Durata (minuti)" htmlFor={`${prefix}-duration`}>
          <Input id={`${prefix}-duration`} name="duration" type="number" min={5} max={600} step={5} defaultValue={service?.duration_minutes ?? 30} required />
        </Field>
        <Field label="Pausa dopo (minuti)" htmlFor={`${prefix}-buffer`}>
          <Input id={`${prefix}-buffer`} name="buffer" type="number" min={0} max={240} step={5} defaultValue={service?.buffer_after_minutes ?? 0} />
        </Field>
      </div>
      <Field label="Descrizione (facoltativa)" htmlFor={`${prefix}-desc`}>
        <Textarea id={`${prefix}-desc`} name="description" defaultValue={service?.description ?? ""} maxLength={1000} />
      </Field>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Chi lo esegue ({staffLabel.toLowerCase()})</legend>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {staff.map((s) => (
            <Checkbox
              key={s.id}
              label={`${s.display_name}${s.is_active ? "" : " (non attivo)"}`}
              checked={staffIds.includes(s.id)}
              onChange={(e) => setStaffIds((ids) => (e.target.checked ? [...ids, s.id] : ids.filter((x) => x !== s.id)))}
            />
          ))}
        </div>
        {staffIds.length === 0 && <p className="mt-2 text-sm text-warning">Senza professionisti il servizio non è prenotabile.</p>}
      </fieldset>
      <Checkbox name="is_active" defaultChecked={service?.is_active ?? true} label="Prenotabile online" />
      {error && <Notice tone="error" title={error} />}
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={pending}>
          Salva
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Annulla
        </Button>
      </div>
    </form>
  );
}

export function ServicesManager({ services, staff, currency, staffLabel }: { services: Svc[]; staff: StaffLite[]; currency: string; staffLabel: string }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [moving, startMove] = useTransition();

  return (
    <div className="space-y-4">
      {editing !== "new" && (
        <Button size="sm" onClick={() => setEditing("new")}>
          <Plus className="size-4" aria-hidden="true" /> Nuovo servizio
        </Button>
      )}
      {editing === "new" && (
        <Card className="p-5">
          <h2 className="mb-4 font-medium">Nuovo servizio</h2>
          <ServiceForm service={null} staff={staff} staffLabel={staffLabel} onDone={() => setEditing(null)} />
        </Card>
      )}
      {services.length === 0 && editing !== "new" ? (
        <EmptyState title="Nessun servizio">Aggiungi il primo servizio per aprire le prenotazioni.</EmptyState>
      ) : (
        <Card>
          <ul className="divide-y divide-line">
            {services.map((s, i) => (
              <li key={s.id} className="px-4 py-4 sm:px-5">
                {editing === s.id ? (
                  <ServiceForm service={s} staff={staff} staffLabel={staffLabel} onDone={() => setEditing(null)} />
                ) : (
                  <div className="flex items-center gap-3">
                    <div className="flex flex-col">
                      <button
                        type="button"
                        aria-label={`Sposta ${s.name} su`}
                        disabled={i === 0 || moving}
                        onClick={() => startMove(() => moveServiceAction(s.id, -1).then(() => undefined))}
                        className="rounded p-0.5 text-muted hover:text-text disabled:opacity-30"
                      >
                        <ChevronUp className="size-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Sposta ${s.name} giù`}
                        disabled={i === services.length - 1 || moving}
                        onClick={() => startMove(() => moveServiceAction(s.id, 1).then(() => undefined))}
                        className="rounded p-0.5 text-muted hover:text-text disabled:opacity-30"
                      >
                        <ChevronDown className="size-4" aria-hidden="true" />
                      </button>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        {s.name}
                        {!s.is_active && <span className="ml-2 text-xs font-normal text-subtle">non prenotabile online</span>}
                      </p>
                      <p className="text-sm text-muted">
                        {formatDuration(s.duration_minutes)}
                        {s.buffer_after_minutes > 0 && ` + ${s.buffer_after_minutes} min pausa`} ·{" "}
                        {s.staffIds.length === staff.length ? "tutti" : staff.filter((p) => s.staffIds.includes(p.id)).map((p) => p.display_name).join(", ") || "nessuno"}
                      </p>
                    </div>
                    <p className="tabular shrink-0 font-semibold">{formatPrice(s.price_cents, currency)}</p>
                    <Button size="sm" variant="secondary" onClick={() => setEditing(s.id)}>
                      Modifica
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
