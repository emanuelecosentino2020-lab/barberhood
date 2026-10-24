"use client";

import { Plus, Trash2, X } from "lucide-react";
import { useState, useTransition } from "react";
import {
  addDateOverrideAction,
  addTimeBlockAction,
  clearStaffHoursAction,
  deleteDateOverrideAction,
  deleteTimeBlockAction,
  saveWeeklyHoursAction,
} from "@/app/admin/actions";
import { longDate, longDateTimeIn } from "@/components/booking/zoned";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select } from "@/components/ui/field";
import { Card, Notice } from "@/components/ui/misc";
import { WEEKDAYS } from "@/lib/hours";

type Interval = { start: string; end: string };
type Result = { ok: boolean; text: string } | null;

const timeInput =
  "tabular h-10 w-[7.75rem] rounded-lg border border-line bg-surface px-2 text-sm text-text focus:border-text focus:outline-none disabled:opacity-60";

function IntervalList({ intervals, onChange, disabled, label }: { intervals: Interval[]; onChange: (v: Interval[]) => void; disabled?: boolean; label: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {intervals.map((iv, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input
            type="time"
            aria-label={`${label}, fascia ${i + 1}, inizio`}
            value={iv.start}
            disabled={disabled}
            onChange={(e) => onChange(intervals.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))}
            className={timeInput}
          />
          <span className="text-subtle" aria-hidden="true">
            –
          </span>
          <input
            type="time"
            aria-label={`${label}, fascia ${i + 1}, fine`}
            value={iv.end === "24:00" ? "23:59" : iv.end}
            disabled={disabled}
            onChange={(e) => onChange(intervals.map((x, j) => (j === i ? { ...x, end: e.target.value === "23:59" ? "24:00" : e.target.value } : x)))}
            className={timeInput}
          />
          {!disabled && (
            <button
              type="button"
              aria-label={`Rimuovi fascia ${i + 1} di ${label}`}
              onClick={() => onChange(intervals.filter((_, j) => j !== i))}
              className="rounded-full p-1.5 text-muted hover:bg-surface-2 hover:text-text"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          )}
        </div>
      ))}
      {!disabled && intervals.length < 6 && (
        <button
          type="button"
          onClick={() => {
            const last = intervals.at(-1);
            onChange([...intervals, last ? { start: last.end < "20:00" ? last.end : "15:00", end: "20:00" } : { start: "09:00", end: "13:00" }]);
          }}
          className="inline-flex h-10 items-center gap-1 rounded-lg px-2 text-sm text-muted hover:bg-surface-2 hover:text-text"
        >
          <Plus className="size-4" aria-hidden="true" /> {intervals.length ? "Fascia" : "Aggiungi orario"}
        </button>
      )}
    </div>
  );
}

export function WeeklyHoursEditor({
  staffId,
  initial,
  followsBusiness,
  canEdit,
}: {
  staffId: string | null;
  initial: { weekday: number; start: string; end: string }[];
  followsBusiness: boolean;
  canEdit: boolean;
}) {
  const [days, setDays] = useState<Interval[][]>(() =>
    WEEKDAYS.map((_, i) =>
      initial
        .filter((h) => h.weekday === i + 1)
        .sort((a, b) => a.start.localeCompare(b.start))
        .map(({ start, end }) => ({ start, end })),
    ),
  );
  const [custom, setCustom] = useState(!followsBusiness);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<Result>(null);
  const editable = canEdit && custom;

  return (
    <Card className="p-4 sm:p-5">
      {staffId && (
        <div className="mb-4">
          {custom ? (
            !followsBusiness && canEdit ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                loading={pending}
                onClick={() =>
                  start(async () => {
                    const r = await clearStaffHoursAction(staffId);
                    setResult(r.ok ? { ok: true, text: r.message ?? "Fatto." } : { ok: false, text: r.error });
                  })
                }
              >
                Torna agli orari del negozio
              </Button>
            ) : null
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted">Segue gli orari del negozio (mostrati sotto).</p>
              {canEdit && (
                <Button type="button" size="sm" variant="secondary" onClick={() => setCustom(true)}>
                  Imposta orari personali
                </Button>
              )}
            </div>
          )}
        </div>
      )}
      <ul className="divide-y divide-line">
        {WEEKDAYS.map((label, i) => (
          <li key={label} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
            <span className="w-28 shrink-0 text-sm font-medium">{label}</span>
            {days[i]!.length === 0 && !editable ? (
              <span className="text-sm text-subtle">Chiuso</span>
            ) : (
              <IntervalList label={label} intervals={days[i]!} disabled={!editable} onChange={(v) => setDays((d) => d.map((x, j) => (j === i ? v : x)))} />
            )}
          </li>
        ))}
      </ul>
      {result && <Notice className="mt-4" tone={result.ok ? "success" : "error"} title={result.text} />}
      {editable && (
        <Button
          className="mt-4"
          size="sm"
          loading={pending}
          onClick={() =>
            start(async () => {
              const r = await saveWeeklyHoursAction({ staffId, days: days.map((intervals, i) => ({ weekday: i + 1, intervals })) });
              setResult(r.ok ? { ok: true, text: r.message ?? "Salvato." } : { ok: false, text: r.error });
            })
          }
        >
          Salva orari
        </Button>
      )}
    </Card>
  );
}

export function DateOverrides({
  staffId,
  items,
  today,
  canEdit,
}: {
  staffId: string | null;
  items: { date: string; staffId: string | null; isClosed: boolean; intervals: Interval[]; note: string | null }[];
  today: string;
  canEdit: boolean;
}) {
  const [date, setDate] = useState("");
  const [closed, setClosed] = useState(true);
  const [intervals, setIntervals] = useState<Interval[]>([{ start: "09:00", end: "13:00" }]);
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const [result, setResult] = useState<Result>(null);

  return (
    <Card className="p-4 sm:p-5">
      {items.length === 0 ? (
        <p className="text-sm text-muted">Nessun giorno speciale in programma.</p>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((o) => (
            <li key={o.date} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium first-letter:uppercase">{longDate(o.date)}</p>
                <p className="text-sm text-muted">
                  {o.isClosed ? "Chiuso" : o.intervals.map((i) => `${i.start}–${i.end}`).join(" · ")}
                  {o.note && ` · ${o.note}`}
                </p>
              </div>
              {canEdit && (
                <button
                  type="button"
                  aria-label={`Elimina eccezione del ${longDate(o.date)}`}
                  disabled={pending}
                  onClick={() => start(() => deleteDateOverrideAction({ date: o.date, staffId: o.staffId }).then(() => undefined))}
                  className="rounded-full p-2 text-muted hover:bg-surface-2 hover:text-danger"
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <form
          className="mt-4 space-y-4 border-t border-line pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await addDateOverrideAction({ staffId, date, isClosed: closed, intervals: closed ? [] : intervals, note: note || undefined });
              setResult(r.ok ? { ok: true, text: r.message ?? "Salvato." } : { ok: false, text: r.error });
              if (r.ok) {
                setDate("");
                setNote("");
              }
            });
          }}
        >
          <p className="text-sm font-medium">Aggiungi giorno speciale</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Data" htmlFor={`ov-date-${staffId ?? "shop"}`}>
              <Input id={`ov-date-${staffId ?? "shop"}`} type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} required />
            </Field>
            <Field label="Nota (facoltativa)" htmlFor={`ov-note-${staffId ?? "shop"}`}>
              <Input id={`ov-note-${staffId ?? "shop"}`} value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="Es. Festa patronale" />
            </Field>
          </div>
          <Checkbox checked={closed} onChange={(e) => setClosed(e.target.checked)} label="Chiuso tutto il giorno" />
          {!closed && <IntervalList label="Giorno speciale" intervals={intervals} onChange={setIntervals} />}
          {result && <Notice tone={result.ok ? "success" : "error"} title={result.text} />}
          <Button type="submit" size="sm" variant="secondary" loading={pending}>
            Aggiungi
          </Button>
        </form>
      )}
    </Card>
  );
}

export function TimeBlocks({
  items,
  staff,
  timeZone,
  today,
}: {
  items: { id: string; staff_id: string | null; starts_at: string; ends_at: string; reason: string | null }[];
  staff: { id: string; display_name: string }[];
  timeZone: string;
  today: string;
}) {
  const [staffId, setStaffId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("00:00");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("23:59");
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const [result, setResult] = useState<Result>(null);
  const who = (id: string | null) => (id ? (staff.find((s) => s.id === id)?.display_name ?? "") : "Tutto il negozio");

  return (
    <Card className="p-4 sm:p-5">
      {items.length === 0 ? (
        <p className="text-sm text-muted">Nessun blocco in programma.</p>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((b) => (
            <li key={b.id} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-medium">
                  {who(b.staff_id)}
                  {b.reason && <span className="font-normal text-muted"> · {b.reason}</span>}
                </p>
                <p className="text-muted">
                  Da {longDateTimeIn(b.starts_at, timeZone)} a {longDateTimeIn(b.ends_at, timeZone)}
                </p>
              </div>
              <button
                type="button"
                aria-label="Elimina blocco"
                disabled={pending}
                onClick={() => start(() => deleteTimeBlockAction(b.id).then(() => undefined))}
                className="rounded-full p-2 text-muted hover:bg-surface-2 hover:text-danger"
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        className="mt-4 space-y-4 border-t border-line pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await addTimeBlockAction({
              staffId: staffId || null,
              startDate,
              startTime,
              endDate: endDate || startDate,
              // 23:59 means "end of that day"
              endTime: endTime === "23:59" ? "24:00" : endTime,
              reason: reason || undefined,
            });
            setResult(r.ok ? { ok: true, text: r.message ?? "Salvato." } : { ok: false, text: r.error });
            if (r.ok) {
              setStartDate("");
              setEndDate("");
              setReason("");
            }
          });
        }}
      >
        <p className="text-sm font-medium">Aggiungi blocco o ferie</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Per chi" htmlFor="blk-staff">
            <Select id="blk-staff" value={staffId} onChange={(e) => setStaffId(e.target.value)}>
              <option value="">Tutto il negozio</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.display_name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Motivo (facoltativo)" htmlFor="blk-reason">
            <Input id="blk-reason" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="Es. Ferie estive" />
          </Field>
          <div className="flex gap-2">
            <Field label="Dal" htmlFor="blk-sd" className="flex-1">
              <Input id="blk-sd" type="date" min={today} value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
            </Field>
            <Field label="Ora" htmlFor="blk-st">
              <Input id="blk-st" type="time" className="w-28" value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
            </Field>
          </div>
          <div className="flex gap-2">
            <Field label="Al" htmlFor="blk-ed" className="flex-1">
              <Input id="blk-ed" type="date" min={startDate || today} value={endDate} onChange={(e) => setEndDate(e.target.value)} placeholder="Stesso giorno" />
            </Field>
            <Field label="Ora" htmlFor="blk-et">
              <Input id="blk-et" type="time" className="w-28" value={endTime} onChange={(e) => setEndTime(e.target.value)} required />
            </Field>
          </div>
        </div>
        <p className="text-sm text-muted">Gli appuntamenti già presi nel periodo non vengono annullati: te li segnaliamo e li gestisci tu.</p>
        {result && <Notice tone={result.ok ? "success" : "error"} title={result.text} />}
        <Button type="submit" size="sm" variant="secondary" loading={pending}>
          Aggiungi blocco
        </Button>
      </form>
    </Card>
  );
}
