"use client";

import { ArrowLeft, Check, CalendarPlus, Users, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BrandMark } from "@/components/public/brand-mark";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/field";
import { Avatar, Notice } from "@/components/ui/misc";
import { formatDuration, formatPrice } from "@/lib/format";
import { SlotPicker, type FetchDays } from "./slot-picker";
import { Turnstile } from "./turnstile";

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || null;
import { googleCalendarLink, longDateTimeIn, timeIn } from "./zoned";

export interface FlowService {
  id: string;
  name: string;
  description: string | null;
  price_cents: number;
  duration_minutes: number;
  staffIds: string[];
}
export interface FlowStaff {
  id: string;
  display_name: string;
  bio: string | null;
  avatar_url: string | null;
}
export interface FlowBusiness {
  slug: string;
  name: string;
  theme: Record<string, unknown>;
  timezone: string;
  currency: string;
  staff_label: string;
  max_advance_days: number;
  require_phone: boolean;
  allow_staff_choice: boolean;
  cancellation_cutoff_hours: number;
  address: string | null;
}

type Step = "servizio" | "barbiere" | "orario" | "dati" | "conferma";
interface Details {
  name: string;
  email: string;
  phone: string;
  note: string;
  acceptPrivacy: boolean;
}
interface Draft {
  serviceId: string | null;
  staffId: string; // "any" or id
  slot: { start: string; staffIds: string[] } | null;
  date: string | null;
  details: Details;
}
interface Confirmation {
  manageUrl: string;
  startsAt: string;
  endsAt: string;
  serviceName: string;
  priceCents: number;
  staffName: string;
  emailEnabled?: boolean;
}

const emptyDetails: Details = { name: "", email: "", phone: "", note: "", acceptPrivacy: false };

function readDraft(key: string): Draft | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}

export function BookingFlow({
  business,
  services,
  staff,
  initialServiceId,
  initialStaffId,
  basePath,
}: {
  basePath: string;
  business: FlowBusiness;
  services: FlowService[];
  staff: FlowStaff[];
  initialServiceId: string | null;
  initialStaffId: string | null;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const storageKey = `booking:${business.slug}`;
  const base = `${basePath}/prenota`;
  const home = basePath || "/";

  const [draft, setDraft] = useState<Draft>(() => ({
    serviceId: services.some((s) => s.id === initialServiceId) ? initialServiceId : null,
    staffId: initialStaffId && staff.some((s) => s.id === initialStaffId) ? initialStaffId : "any",
    slot: null,
    date: null,
    details: emptyDetails,
  }));
  const [hydrated, setHydrated] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slotError, setSlotError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof Details, string>>>({});
  const formStartedAt = useRef<number>(0);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Restore an in-progress booking (e.g. after going back to the shop page)
  useEffect(() => {
    formStartedAt.current = Date.now();
    const saved = readDraft(storageKey);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration from sessionStorage
    if (saved && !initialServiceId && !initialStaffId) setDraft({ ...saved, slot: null });
    setHydrated(true);
  }, [storageKey, initialServiceId, initialStaffId]);

  useEffect(() => {
    if (!hydrated || confirmation) return;
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(draft));
    } catch {
      /* storage unavailable: the flow still works */
    }
  }, [draft, hydrated, storageKey, confirmation]);

  const service = services.find((s) => s.id === draft.serviceId) ?? null;
  const eligibleStaff = useMemo(() => (service ? staff.filter((p) => service.staffIds.includes(p.id)) : []), [service, staff]);
  const needsStaffStep = business.allow_staff_choice && eligibleStaff.length > 1;
  const steps: Step[] = needsStaffStep ? ["servizio", "barbiere", "orario", "dati", "conferma"] : ["servizio", "orario", "dati", "conferma"];

  // The step lives in the URL so the browser back button works naturally.
  const preselected = services.find((s) => s.id === initialServiceId);
  const defaultStep: Step = !preselected
    ? "servizio"
    : needsStaffStep && !initialStaffId && preselected.staffIds.length > 1
      ? "barbiere"
      : "orario";
  const requested = (params.get("step") as Step | null) ?? defaultStep;
  const step: Step = useMemo(() => {
    const order = steps;
    let s: Step = order.includes(requested) ? requested : "servizio";
    // Never show a step whose prerequisites are missing
    if (!service) s = "servizio";
    else if ((s === "dati" || s === "conferma") && !draft.slot) s = "orario";
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requested, service, draft.slot, needsStaffStep]);
  const stepIndex = steps.indexOf(step);

  const go = useCallback(
    (next: Step) => {
      setError(null);
      window.history.pushState(null, "", `${base}?step=${next}`);
    },
    [base],
  );

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }, [step]);

  const staffName = (id: string | undefined) => staff.find((s) => s.id === id)?.display_name ?? "";
  const selectedStaffName =
    draft.staffId !== "any" ? staffName(draft.staffId) : draft.slot ? staffName(draft.slot.staffIds[0]) : "";

  const fetchDays: FetchDays = useCallback(
    async (from, days) => {
      if (!draft.serviceId) return { days: [] };
      const qs = new URLSearchParams({ serviceId: draft.serviceId, staffId: needsStaffStep ? draft.staffId : "any", from, days: String(days) });
      const res = await fetch(`/api/public/${business.slug}/availability?${qs.toString()}`, { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error?.message ?? "Impossibile caricare gli orari.");
      return json as { days: { date: string; slots: { start: string; staffIds: string[] }[] }[] };
    },
    [business.slug, draft.serviceId, draft.staffId, needsStaffStep],
  );

  function chooseService(id: string) {
    setDraft((d) => ({ ...d, serviceId: id, slot: null, staffId: d.staffId !== "any" && services.find((s) => s.id === id)?.staffIds.includes(d.staffId) ? d.staffId : "any" }));
    const svc = services.find((s) => s.id === id);
    const multi = business.allow_staff_choice && staff.filter((p) => svc?.staffIds.includes(p.id)).length > 1;
    go(multi ? "barbiere" : "orario");
  }

  function chooseStaff(id: string) {
    setDraft((d) => ({ ...d, staffId: id, slot: null }));
    go("orario");
  }

  function validateDetails(): boolean {
    const errs: Partial<Record<keyof Details, string>> = {};
    const d = draft.details;
    if (d.name.trim().length < 2) errs.name = "Inserisci nome e cognome.";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email.trim())) errs.email = "Inserisci un'email valida: ti mandiamo lì la conferma.";
    const digits = d.phone.replace(/\D/g, "");
    if (business.require_phone && digits.length < 6) errs.phone = "Inserisci un numero di telefono valido.";
    else if (d.phone && (digits.length < 6 || !/^[+\d\s().-]+$/.test(d.phone))) errs.phone = "Numero di telefono non valido.";
    if (!d.acceptPrivacy) errs.acceptPrivacy = "Serve la presa visione dell'informativa privacy.";
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function submit() {
    if (!service || !draft.slot || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/public/${business.slug}/bookings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceId: service.id,
          staffId: needsStaffStep ? draft.staffId : "any",
          startsAt: draft.slot.start,
          name: draft.details.name,
          email: draft.details.email,
          phone: draft.details.phone,
          note: draft.details.note || undefined,
          acceptPrivacy: draft.details.acceptPrivacy,
          website: "",
          formStartedAt: formStartedAt.current,
          turnstileToken: turnstileToken ?? undefined,
        }),
      });
      const json = await res.json().catch(() => null);
      if (res.status === 409) {
        setDraft((d) => ({ ...d, slot: null }));
        setSlotError(json?.error?.message ?? "Questo orario non è più disponibile. Scegline un altro.");
        setReloadKey((k) => k + 1);
        go("orario");
        return;
      }
      if (!res.ok) {
        setError(json?.error?.message ?? "Non è stato possibile completare la prenotazione. Riprova.");
        return;
      }
      setConfirmation(json as Confirmation);
      try {
        sessionStorage.removeItem(storageKey);
      } catch {
        /* ignore */
      }
      window.scrollTo({ top: 0 });
    } catch {
      setError("Connessione assente o instabile. Controlla la rete e riprova: la prenotazione non è stata inviata.");
    } finally {
      setSubmitting(false);
    }
  }

  // ------------------------------------------------------------------ success
  if (confirmation) {
    const calendar = googleCalendarLink({
      title: `${confirmation.serviceName} · ${business.name}`,
      start: confirmation.startsAt,
      end: confirmation.endsAt,
      location: business.address ?? undefined,
      details: `Gestisci la prenotazione: ${confirmation.manageUrl}`,
      timeZone: business.timezone,
    });
    return (
      <FlowFrame business={business} onClose={home}>
        <div className="animate-fade-up py-6">
          <div className="flex size-14 items-center justify-center rounded-full bg-accent text-accent-ink">
            <Check className="size-7" aria-hidden="true" />
          </div>
          <h1 className="display mt-7 text-5xl" tabIndex={-1}>
            Prenotato.
          </h1>
          <p className="mt-3 text-muted">
            {confirmation.emailEnabled === false
              ? "Salva il link qui sotto: ti serve per spostare o annullare l'appuntamento."
              : `Ti abbiamo inviato la conferma a ${draft.details.email}. Controlla anche lo spam.`}
          </p>
          <dl className="mt-8 divide-y divide-line rounded-2xl border border-line bg-surface">
            <SummaryRow label="Servizio" value={confirmation.serviceName} />
            <SummaryRow label="Quando" value={longDateTimeIn(confirmation.startsAt, business.timezone)} capitalize />
            {confirmation.staffName && <SummaryRow label="Con" value={confirmation.staffName} />}
            <SummaryRow label="Prezzo" value={formatPrice(confirmation.priceCents, business.currency)} note="Si paga in negozio" />
            {business.address && <SummaryRow label="Dove" value={business.address} />}
          </dl>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <a href={calendar} target="_blank" rel="noopener noreferrer" className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-accent px-6 font-medium text-accent-ink">
              <CalendarPlus className="size-4" aria-hidden="true" /> Aggiungi al calendario
            </a>
            <a href={confirmation.manageUrl} className="inline-flex h-12 items-center justify-center rounded-full border border-line-strong px-6 font-medium hover:border-text">
              Sposta o annulla
            </a>
          </div>
          <p className="mt-6 text-sm text-subtle">
            Puoi spostare o annullare online fino a {business.cancellation_cutoff_hours} ore prima.
          </p>
        </div>
      </FlowFrame>
    );
  }

  // ------------------------------------------------------------------ steps
  const titles: Record<Step, string> = {
    servizio: "Scegli il servizio",
    barbiere: `Scegli il ${business.staff_label.toLowerCase()}`,
    orario: "Scegli giorno e ora",
    dati: "I tuoi dati",
    conferma: "Controlla e conferma",
  };

  return (
    <FlowFrame business={business} onClose={home}>
      <div className="flex items-center gap-3">
        {stepIndex > 0 ? (
          <button
            type="button"
            onClick={() => router.back()}
            className="-ml-2 inline-flex size-10 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-text"
            aria-label="Torna indietro"
          >
            <ArrowLeft className="size-5" aria-hidden="true" />
          </button>
        ) : null}
        <p className="eyebrow">
          Passo {stepIndex + 1} di {steps.length}
        </p>
      </div>
      <div className="mt-3 flex gap-1.5" aria-hidden="true">
        {steps.map((s, i) => (
          <span key={s} className={cn("h-0.5 flex-1 rounded-full transition-colors", i <= stepIndex ? "bg-accent" : "bg-line")} />
        ))}
      </div>
      <h1 ref={headingRef} tabIndex={-1} className="display mt-8 text-4xl outline-none sm:text-5xl">
        {titles[step]}
      </h1>

      <div key={step} className="animate-fade-up mt-8">
        {step === "servizio" && (
          <ul className="space-y-2.5">
            {services.map((s) => {
              const sel = s.id === draft.serviceId;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => chooseService(s.id)}
                    aria-pressed={sel}
                    className={cn(
                      "flex w-full items-center gap-4 rounded-2xl border px-5 py-4 text-left transition-colors",
                      sel ? "border-accent bg-surface-2" : "border-line hover:border-line-strong hover:bg-surface",
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{s.name}</p>
                      <p className="mt-0.5 text-sm text-muted">
                        {formatDuration(s.duration_minutes)}
                        {s.description && ` · ${s.description}`}
                      </p>
                    </div>
                    <p className="tabular font-medium">{formatPrice(s.price_cents, business.currency)}</p>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {step === "barbiere" && service && (
          <ul className="space-y-2.5">
            <li>
              <button
                type="button"
                onClick={() => chooseStaff("any")}
                aria-pressed={draft.staffId === "any"}
                className={cn(
                  "flex w-full items-center gap-4 rounded-2xl border px-5 py-4 text-left transition-colors",
                  draft.staffId === "any" ? "border-accent bg-surface-2" : "border-line hover:border-line-strong hover:bg-surface",
                )}
              >
                <span className="flex size-12 items-center justify-center rounded-full border border-dashed border-line-strong text-muted" aria-hidden="true">
                  <Users className="size-5" />
                </span>
                <div>
                  <p className="font-medium">Primo disponibile</p>
                  <p className="text-sm text-muted">Più orari tra cui scegliere</p>
                </div>
              </button>
            </li>
            {eligibleStaff.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => chooseStaff(p.id)}
                  aria-pressed={draft.staffId === p.id}
                  className={cn(
                    "flex w-full items-center gap-4 rounded-2xl border px-5 py-4 text-left transition-colors",
                    draft.staffId === p.id ? "border-accent bg-surface-2" : "border-line hover:border-line-strong hover:bg-surface",
                  )}
                >
                  <Avatar name={p.display_name} src={p.avatar_url} size={48} />
                  <div>
                    <p className="font-medium">{p.display_name}</p>
                    {p.bio && <p className="text-sm text-muted">{p.bio}</p>}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}

        {step === "orario" && service && (
          <div className="space-y-6">
            <SelectionChips service={service} staffName={draft.staffId !== "any" ? staffName(draft.staffId) : null} currency={business.currency} />
            {slotError && (
              <Notice tone="error" title="Orario non più disponibile">
                {slotError}
              </Notice>
            )}
            <SlotPicker
              timeZone={business.timezone}
              maxDays={business.max_advance_days}
              fetchDays={fetchDays}
              selected={draft.slot}
              reloadKey={reloadKey}
              initialDate={draft.date}
              onSelect={(slot, date) => {
                setSlotError(null);
                setDraft((d) => ({ ...d, slot, date }));
                go("dati");
              }}
            />
          </div>
        )}

        {step === "dati" && (
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (validateDetails()) go("conferma");
            }}
            className="space-y-5"
          >
            {/* Honeypot: invisible to humans */}
            <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
              <label>
                Sito web
                <input type="text" name="website" tabIndex={-1} autoComplete="off" />
              </label>
            </div>
            <DetailsFields draft={draft} setDraft={setDraft} errors={fieldErrors} requirePhone={business.require_phone} privacyHref={`${basePath}/privacy`} />
            <Button type="submit" size="lg" className="w-full sm:w-auto">
              Continua
            </Button>
          </form>
        )}

        {step === "conferma" && service && draft.slot && (
          <div className="space-y-6">
            <dl className="divide-y divide-line rounded-2xl border border-line bg-surface">
              <SummaryRow label="Servizio" value={service.name} action={{ label: "Modifica", onClick: () => go("servizio") }} />
              <SummaryRow
                label="Quando"
                value={longDateTimeIn(draft.slot.start, business.timezone)}
                capitalize
                note={`Durata ${formatDuration(service.duration_minutes)} · fine alle ${timeIn(new Date(Date.parse(draft.slot.start) + service.duration_minutes * 60_000).toISOString(), business.timezone)}`}
                action={{ label: "Modifica", onClick: () => go("orario") }}
              />
              {selectedStaffName && (
                <SummaryRow
                  label="Con"
                  value={selectedStaffName}
                  action={needsStaffStep ? { label: "Modifica", onClick: () => go("barbiere") } : undefined}
                />
              )}
              <SummaryRow
                label="I tuoi dati"
                value={draft.details.name}
                note={[draft.details.email, draft.details.phone].filter(Boolean).join(" · ")}
                action={{ label: "Modifica", onClick: () => go("dati") }}
              />
              <SummaryRow label="Prezzo" value={formatPrice(service.price_cents, business.currency)} note="Si paga in negozio" />
            </dl>
            {error && (
              <Notice tone="error" title="Prenotazione non completata">
                {error}
              </Notice>
            )}
            {TURNSTILE_SITE_KEY && <Turnstile siteKey={TURNSTILE_SITE_KEY} onToken={setTurnstileToken} />}
            <Button size="lg" className="w-full" onClick={submit} loading={submitting} disabled={!!TURNSTILE_SITE_KEY && !turnstileToken}>
              {submitting ? "Conferma in corso…" : "Conferma prenotazione"}
            </Button>
            <p className="text-center text-sm text-subtle">
              Riceverai un&apos;email con il link per spostare o annullare.
            </p>
          </div>
        )}
      </div>
    </FlowFrame>
  );
}

function FlowFrame({ business, onClose, children }: { business: FlowBusiness; onClose: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-line">
        <div className="mx-auto flex h-16 max-w-2xl items-center justify-between px-5">
          <Link href={onClose} aria-label={`Torna a ${business.name}`}>
            <BrandMark business={business} className="h-5 w-auto" />
          </Link>
          <Link href={onClose} className="inline-flex size-10 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-text" aria-label="Chiudi prenotazione">
            <X className="size-5" aria-hidden="true" />
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl flex-1 px-5 pt-8 pb-16">{children}</main>
    </div>
  );
}

function SelectionChips({ service, staffName, currency }: { service: FlowService; staffName: string | null; currency: string }) {
  return (
    <div className="flex flex-wrap gap-2 text-sm">
      <span className="rounded-full border border-line px-3 py-1.5">
        {service.name} · {formatDuration(service.duration_minutes)} · {formatPrice(service.price_cents, currency)}
      </span>
      {staffName && <span className="rounded-full border border-line px-3 py-1.5">con {staffName}</span>}
    </div>
  );
}

function SummaryRow({
  label,
  value,
  note,
  capitalize,
  action,
}: {
  label: string;
  value: string;
  note?: string;
  capitalize?: boolean;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex items-start gap-4 px-5 py-4">
      <dt className="w-24 shrink-0 pt-0.5 text-sm text-muted">{label}</dt>
      <dd className="min-w-0 flex-1">
        <p className={cn("font-medium", capitalize && "first-letter:uppercase")}>{value}</p>
        {note && <p className="mt-0.5 text-sm text-muted">{note}</p>}
      </dd>
      {action && (
        <button type="button" onClick={action.onClick} className="text-sm text-muted underline-offset-4 hover:text-text hover:underline">
          {action.label}
        </button>
      )}
    </div>
  );
}

function DetailsFields({
  draft,
  setDraft,
  errors,
  requirePhone,
  privacyHref,
}: {
  draft: Draft;
  setDraft: React.Dispatch<React.SetStateAction<Draft>>;
  errors: Partial<Record<keyof Details, string>>;
  requirePhone: boolean;
  privacyHref: string;
}) {
  const set = (k: keyof Details) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const value = k === "acceptPrivacy" ? (e.target as HTMLInputElement).checked : e.target.value;
    setDraft((d) => ({ ...d, details: { ...d.details, [k]: value } }));
  };
  const d = draft.details;
  return (
    <>
      <Field label="Nome e cognome" htmlFor="name" error={errors.name}>
        <Input id="name" name="name" autoComplete="name" value={d.name} onChange={set("name")} aria-invalid={!!errors.name} aria-describedby={errors.name ? "name-error" : undefined} required />
      </Field>
      <Field label="Email" htmlFor="email" error={errors.email} hint="Ti mandiamo la conferma e il promemoria.">
        <Input id="email" name="email" type="email" inputMode="email" autoComplete="email" value={d.email} onChange={set("email")} aria-invalid={!!errors.email} aria-describedby={errors.email ? "email-error" : "email-hint"} required />
      </Field>
      <Field label={requirePhone ? "Telefono" : "Telefono (facoltativo)"} htmlFor="phone" error={errors.phone} hint="Solo per avvisarti in caso di imprevisti.">
        <Input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" value={d.phone} onChange={set("phone")} aria-invalid={!!errors.phone} aria-describedby={errors.phone ? "phone-error" : "phone-hint"} required={requirePhone} />
      </Field>
      <Field label="Nota (facoltativa)" htmlFor="note" hint="Es. preferenze sul taglio. Non inserire dati sulla salute.">
        <Textarea id="note" name="note" maxLength={500} value={d.note} onChange={set("note")} aria-describedby="note-hint" />
      </Field>
      <div>
        <Checkbox
          checked={d.acceptPrivacy}
          onChange={set("acceptPrivacy")}
          aria-invalid={!!errors.acceptPrivacy}
          label={
            <>
              Ho letto l&apos;
              <a href={privacyHref} target="_blank" rel="noopener noreferrer" className="text-text underline underline-offset-4">
                informativa privacy
              </a>
              . I dati servono solo a gestire l&apos;appuntamento.
            </>
          }
        />
        {errors.acceptPrivacy && (
          <p className="mt-2 text-sm text-danger" role="alert">
            {errors.acceptPrivacy}
          </p>
        )}
      </div>
    </>
  );
}

