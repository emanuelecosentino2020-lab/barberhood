"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Spinner } from "@/components/ui/spinner";
import { Notice } from "@/components/ui/misc";
import { cn } from "@/components/ui/cn";
import { addDaysLocal, dayNumber, hourIn, longDate, monthShort, timeIn, todayInZone, weekdayShort } from "./zoned";

export interface SlotDay {
  date: string;
  slots: { start: string; staffIds: string[] }[];
}

export type FetchDays = (from: string, days: number) => Promise<{ days: SlotDay[] }>;

const PAGE = 14;

/**
 * Date strip + time grid. Shows only times returned by the server, grouped
 * by part of day. Days without availability are visible but disabled, so the
 * customer understands the shop is closed rather than wondering.
 */
export function SlotPicker({
  timeZone,
  maxDays,
  fetchDays,
  selected,
  onSelect,
  reloadKey,
  initialDate,
}: {
  timeZone: string;
  maxDays: number;
  fetchDays: FetchDays;
  selected: { start: string; staffIds: string[] } | null;
  onSelect: (slot: { start: string; staffIds: string[] }, date: string) => void;
  reloadKey?: number;
  initialDate?: string | null;
}) {
  const today = useMemo(() => todayInZone(timeZone), [timeZone]);
  const lastDate = addDaysLocal(today, maxDays);
  const [days, setDays] = useState<SlotDay[]>([]);
  const [activeDate, setActiveDate] = useState<string | null>(initialDate ?? null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  const load = useCallback(
    async (from: string, append: boolean) => {
      setError(null);
      if (append) setLoadingMore(true);
      else setLoading(true);
      try {
        const res = await fetchDays(from, PAGE);
        setDays((prev) => (append ? [...prev, ...res.days.filter((d) => !prev.some((p) => p.date === d.date))] : res.days));
        if (!append) {
          setActiveDate((current) => {
            if (current && res.days.some((d) => d.date === current && d.slots.length > 0)) return current;
            return res.days.find((d) => d.slots.length > 0)?.date ?? res.days[0]?.date ?? null;
          });
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Impossibile caricare gli orari.");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [fetchDays],
  );

  useEffect(() => {
    // Start from the initial date's window if it is in the future, otherwise today
    const start = initialDate && initialDate > today ? initialDate : today;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetching on mount/reload
    void load(start, false);
  }, [load, today, reloadKey, initialDate]);

  const nextFrom = days.length ? addDaysLocal(days[days.length - 1]!.date, 1) : null;
  const canLoadMore = nextFrom !== null && nextFrom <= lastDate;
  const active = days.find((d) => d.date === activeDate) ?? null;
  const hasAny = days.some((d) => d.slots.length > 0);

  const groups = useMemo(() => {
    if (!active) return [];
    const parts: { label: string; slots: SlotDay["slots"] }[] = [
      { label: "Mattina", slots: [] },
      { label: "Pomeriggio", slots: [] },
      { label: "Sera", slots: [] },
    ];
    for (const s of active.slots) {
      const h = hourIn(s.start, timeZone);
      parts[h < 12 ? 0 : h < 17 ? 1 : 2]!.slots.push(s);
    }
    return parts.filter((p) => p.slots.length > 0);
  }, [active, timeZone]);

  if (loading) {
    return (
      <div className="space-y-6" aria-busy="true">
        <div className="flex gap-2 overflow-hidden">
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className="skeleton h-20 w-16 shrink-0 rounded-2xl" />
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="skeleton h-12 rounded-xl" />
          ))}
        </div>
        <Spinner label="Caricamento orari" className="sr-only" />
      </div>
    );
  }

  if (error) {
    return (
      <Notice tone="error" title="Non riusciamo a caricare gli orari">
        <p>{error}</p>
        <button type="button" className="mt-2 underline underline-offset-4" onClick={() => load(today, false)}>
          Riprova
        </button>
      </Notice>
    );
  }

  return (
    <div className="space-y-7">
      <div>
        <div ref={stripRef} role="listbox" aria-label="Scegli il giorno" className="-mx-5 flex snap-x gap-2 overflow-x-auto px-5 pb-2 [scrollbar-width:none]">
          {days.map((d) => {
            const disabled = d.slots.length === 0;
            const isActive = d.date === activeDate;
            return (
              <button
                key={d.date}
                type="button"
                role="option"
                aria-selected={isActive}
                aria-label={`${longDate(d.date)}${disabled ? ", nessun orario disponibile" : `, ${d.slots.length} orari disponibili`}`}
                disabled={disabled}
                onClick={() => setActiveDate(d.date)}
                className={cn(
                  "flex h-20 w-16 shrink-0 snap-start flex-col items-center justify-center rounded-2xl border text-center transition-colors",
                  isActive
                    ? "border-accent bg-accent text-accent-ink"
                    : disabled
                      ? "border-line text-subtle opacity-50"
                      : "border-line-strong hover:border-text",
                )}
              >
                <span className="text-[0.7rem] uppercase tracking-wider opacity-80">{weekdayShort(d.date)}</span>
                <span className="tabular text-xl font-semibold leading-tight">{dayNumber(d.date)}</span>
                <span className="text-[0.7rem] opacity-70">{monthShort(d.date)}</span>
              </button>
            );
          })}
          {canLoadMore && (
            <button
              type="button"
              onClick={() => nextFrom && load(nextFrom, true)}
              disabled={loadingMore}
              className="flex h-20 w-20 shrink-0 flex-col items-center justify-center rounded-2xl border border-dashed border-line-strong text-xs text-muted hover:text-text"
            >
              {loadingMore ? <Spinner className="size-4" /> : "Altre date"}
            </button>
          )}
        </div>
      </div>

      {!hasAny && !canLoadMore ? (
        <Notice title="Nessun orario disponibile">Prova a scegliere un altro servizio o contatta il negozio.</Notice>
      ) : !active || active.slots.length === 0 ? (
        <Notice title="Nessun orario libero in questi giorni">
          {canLoadMore ? "Tocca “Altre date” per vedere i giorni successivi." : "Contatta il negozio per verificare altre disponibilità."}
        </Notice>
      ) : (
        <div className="space-y-6" aria-live="polite">
          <p className="text-sm text-muted first-letter:uppercase">{longDate(active.date)}</p>
          {groups.map((g) => (
            <fieldset key={g.label}>
              <legend className="eyebrow mb-3">{g.label}</legend>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
                {g.slots.map((s) => {
                  const isSel = selected?.start === s.start;
                  return (
                    <button
                      key={s.start}
                      type="button"
                      aria-pressed={isSel}
                      onClick={() => onSelect(s, active.date)}
                      className={cn(
                        "tabular h-12 rounded-xl border text-[0.95rem] font-medium transition-colors",
                        isSel ? "border-accent bg-accent text-accent-ink" : "border-line-strong hover:border-text",
                      )}
                    >
                      {timeIn(s.start, timeZone)}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>
      )}
    </div>
  );
}
