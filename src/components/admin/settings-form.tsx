"use client";

import { X } from "lucide-react";
import { useActionState, useState, useTransition } from "react";
import { changePassword, removeGalleryImageAction, saveSettingsAction, uploadImageAction, type ActionResult } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/field";
import { Card, Notice } from "@/components/ui/misc";
import type { Business } from "@/lib/types";

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card className="p-5">
      <h2 className="font-semibold">{title}</h2>
      {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      <div className="mt-5 space-y-4">{children}</div>
    </Card>
  );
}

export function SettingsForm({ business: b, emailConfigured }: { business: Business; emailConfigured: boolean }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const accent = typeof b.theme?.accent === "string" ? b.theme.accent : "#e8e4dc";

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const s = (k: string) => String(f.get(k) ?? "");
        const n = (k: string) => Number(f.get(k));
        const c = (k: string) => f.get(k) === "on";
        start(async () => {
          const r = await saveSettingsAction({
            name: s("name"),
            tagline: s("tagline"),
            description: s("description"),
            address_line: s("address_line"),
            city: s("city"),
            postal_code: s("postal_code"),
            phone: s("phone"),
            email: s("email"),
            website_url: s("website_url"),
            instagram_url: s("instagram_url"),
            facebook_url: s("facebook_url"),
            google_maps_url: s("google_maps_url"),
            reviews_url: s("reviews_url"),
            staff_label: s("staff_label"),
            accent: s("accent"),
            slot_interval_minutes: n("slot_interval_minutes"),
            min_notice_minutes: n("min_notice_hours") * 60,
            max_advance_days: n("max_advance_days"),
            cancellation_cutoff_hours: n("cancellation_cutoff_hours"),
            reminder_hours_before: n("reminder_hours_before"),
            review_request_hours_after: n("review_request_hours_after"),
            require_phone: c("require_phone"),
            allow_staff_choice: c("allow_staff_choice"),
            notification_email: s("notification_email"),
            notify_owner_on_booking: c("notify_owner_on_booking"),
            notify_owner_on_cancellation: c("notify_owner_on_cancellation"),
            privacy_controller_name: s("privacy_controller_name"),
            privacy_controller_email: s("privacy_controller_email"),
            data_retention_months: n("data_retention_months"),
          });
          setResult(r.ok ? { ok: true, text: r.message ?? "Salvato." } : { ok: false, text: r.error });
        });
      }}
    >
      <Section title="Profilo pubblico" description="Quello che i clienti vedono sulla pagina di prenotazione.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome attività" htmlFor="name">
            <Input id="name" name="name" defaultValue={b.name} required maxLength={120} />
          </Field>
          <Field label="Sottotitolo" htmlFor="tagline">
            <Input id="tagline" name="tagline" defaultValue={b.tagline ?? ""} maxLength={160} />
          </Field>
        </div>
        <Field label="Descrizione" htmlFor="description">
          <Textarea id="description" name="description" defaultValue={b.description ?? ""} maxLength={2000} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-[2fr_1fr_1fr]">
          <Field label="Indirizzo" htmlFor="address_line">
            <Input id="address_line" name="address_line" defaultValue={b.address_line ?? ""} maxLength={200} />
          </Field>
          <Field label="Città" htmlFor="city">
            <Input id="city" name="city" defaultValue={b.city ?? ""} maxLength={100} />
          </Field>
          <Field label="CAP" htmlFor="postal_code">
            <Input id="postal_code" name="postal_code" defaultValue={b.postal_code ?? ""} maxLength={16} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Telefono" htmlFor="phone">
            <Input id="phone" name="phone" type="tel" defaultValue={b.phone ?? ""} />
          </Field>
          <Field label="Email pubblica" htmlFor="email">
            <Input id="email" name="email" type="email" defaultValue={b.email ?? ""} />
          </Field>
          <Field label="Instagram" htmlFor="instagram_url">
            <Input id="instagram_url" name="instagram_url" type="url" defaultValue={b.instagram_url ?? ""} placeholder="https://www.instagram.com/…" />
          </Field>
          <Field label="Facebook" htmlFor="facebook_url">
            <Input id="facebook_url" name="facebook_url" type="url" defaultValue={b.facebook_url ?? ""} />
          </Field>
          <Field label="Link Google Maps" htmlFor="google_maps_url">
            <Input id="google_maps_url" name="google_maps_url" type="url" defaultValue={b.google_maps_url ?? ""} />
          </Field>
          <Field label="Link recensioni Google" htmlFor="reviews_url" hint="Da Google Business Profile: «Chiedi recensioni» → copia il link. Serve anche per l'email dopo l'appuntamento.">
            <Input id="reviews_url" name="reviews_url" type="url" defaultValue={b.reviews_url ?? ""} placeholder="https://g.page/r/…/review" />
          </Field>
          <Field label="Sito web" htmlFor="website_url">
            <Input id="website_url" name="website_url" type="url" defaultValue={b.website_url ?? ""} />
          </Field>
          <Field label="Come chiami il team" htmlFor="staff_label" hint="Es. Barbieri, Parrucchieri, Professionisti">
            <Input id="staff_label" name="staff_label" defaultValue={b.staff_label} required maxLength={40} />
          </Field>
        </div>
        <Field label="Colore principale" htmlFor="accent" hint="Usato per i pulsanti della pagina pubblica.">
          <input id="accent" name="accent" type="color" defaultValue={accent} className="h-12 w-20 cursor-pointer rounded-xl border border-line bg-surface p-1" />
        </Field>
      </Section>

      <Section title="Regole di prenotazione">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Intervallo tra gli orari proposti (minuti)" htmlFor="slot_interval_minutes" hint="Es. 15: 9:00, 9:15, 9:30…">
            <Input id="slot_interval_minutes" name="slot_interval_minutes" type="number" min={5} max={120} step={5} defaultValue={b.slot_interval_minutes} required />
          </Field>
          <Field label="Preavviso minimo (ore)" htmlFor="min_notice_hours" hint="0 = si può prenotare fino all'ultimo">
            <Input id="min_notice_hours" name="min_notice_hours" type="number" min={0} max={168} defaultValue={Math.round(b.min_notice_minutes / 60)} required />
          </Field>
          <Field label="Prenotabile fino a (giorni avanti)" htmlFor="max_advance_days">
            <Input id="max_advance_days" name="max_advance_days" type="number" min={1} max={365} defaultValue={b.max_advance_days} required />
          </Field>
          <Field label="Disdetta online fino a (ore prima)" htmlFor="cancellation_cutoff_hours" hint="Dopo, il cliente deve chiamare.">
            <Input id="cancellation_cutoff_hours" name="cancellation_cutoff_hours" type="number" min={0} max={168} defaultValue={b.cancellation_cutoff_hours} required />
          </Field>
        </div>
        <Checkbox name="allow_staff_choice" defaultChecked={b.allow_staff_choice} label="Il cliente può scegliere il professionista" />
        <Checkbox name="require_phone" defaultChecked={b.require_phone} label="Telefono obbligatorio per prenotare" />
      </Section>

      <Section title="Notifiche email" description={emailConfigured ? undefined : "L'invio email non è ancora attivo: serve configurare Resend e il dominio (vedi documentazione). Le impostazioni vengono comunque salvate."}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Promemoria al cliente (ore prima)" htmlFor="reminder_hours_before" hint="0 = nessun promemoria">
            <Input id="reminder_hours_before" name="reminder_hours_before" type="number" min={0} max={168} defaultValue={b.reminder_hours_before} required />
          </Field>
          <Field label="Richiesta recensione (ore dopo l'appuntamento)" htmlFor="review_request_hours_after" hint="Email con il link recensioni, al massimo una ogni 6 mesi per cliente. 0 = disattivata">
            <Input id="review_request_hours_after" name="review_request_hours_after" type="number" min={0} max={72} defaultValue={b.review_request_hours_after} required />
          </Field>
          <Field label="Email del negozio per gli avvisi" htmlFor="notification_email">
            <Input id="notification_email" name="notification_email" type="email" defaultValue={b.notification_email ?? ""} />
          </Field>
        </div>
        <Checkbox name="notify_owner_on_booking" defaultChecked={b.notify_owner_on_booking} label="Avvisami per ogni nuova prenotazione online" />
        <Checkbox name="notify_owner_on_cancellation" defaultChecked={b.notify_owner_on_cancellation} label="Avvisami quando un cliente disdice" />
      </Section>

      <Section title="Privacy" description="Dati mostrati nell'informativa. Il testo è un modello: va verificato da chi segue la privacy dell'attività.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Titolare del trattamento" htmlFor="privacy_controller_name" hint="Ragione sociale o nome e cognome, con P.IVA">
            <Input id="privacy_controller_name" name="privacy_controller_name" defaultValue={b.privacy_controller_name ?? ""} maxLength={200} />
          </Field>
          <Field label="Email per richieste privacy" htmlFor="privacy_controller_email">
            <Input id="privacy_controller_email" name="privacy_controller_email" type="email" defaultValue={b.privacy_controller_email ?? ""} />
          </Field>
          <Field label="Conservazione dati clienti inattivi (mesi)" htmlFor="data_retention_months">
            <Input id="data_retention_months" name="data_retention_months" type="number" min={1} max={120} defaultValue={b.data_retention_months} required />
          </Field>
        </div>
      </Section>

      <div className="sticky bottom-20 z-10 flex items-center gap-4 rounded-2xl border border-line bg-surface/95 p-3 backdrop-blur lg:bottom-4">
        <Button type="submit" loading={pending}>
          Salva impostazioni
        </Button>
        {result && (
          <p role={result.ok ? "status" : "alert"} className={result.ok ? "text-sm text-muted" : "text-sm text-danger"}>
            {result.text}
          </p>
        )}
      </div>
    </form>
  );
}

function UploadButton({ target, label, onError }: { target: "logo" | "cover" | "gallery"; label: string; onError: (e: string | null) => void }) {
  const [pending, start] = useTransition();
  return (
    <label className="inline-flex h-9 cursor-pointer items-center rounded-full border border-line-strong px-4 text-sm hover:border-text focus-within:ring-2 focus-within:ring-text">
      {pending ? "Caricamento…" : label}
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif"
        className="sr-only"
        disabled={pending}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          const fd = new FormData();
          fd.set("file", file);
          fd.set("target", target);
          start(async () => {
            const r = await uploadImageAction(fd);
            onError(r.ok ? null : r.error);
          });
        }}
      />
    </label>
  );
}

export function BrandingImages({ logoUrl, coverUrl, gallery }: { logoUrl: string | null; coverUrl: string | null; gallery: string[] }) {
  const [error, setError] = useState<string | null>(null);
  const [removing, start] = useTransition();
  return (
    <Section title="Immagini" description="JPG, PNG, WebP o AVIF fino a 5 MB. Le foto vengono mostrate in bianco e nero per coerenza con lo stile.">
      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <p className="mb-2 text-sm font-medium">Logo</p>
          <div className="mb-3 flex h-24 w-24 items-center justify-center overflow-hidden rounded-2xl border border-line bg-surface-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- user uploaded asset */}
            {logoUrl ? <img src={logoUrl} alt="Logo attuale" className="h-full w-full object-contain" /> : <span className="text-xs text-subtle">Nessuno</span>}
          </div>
          <UploadButton target="logo" label="Cambia logo" onError={setError} />
        </div>
        <div>
          <p className="mb-2 text-sm font-medium">Immagine di copertina</p>
          <div className="mb-3 flex h-24 w-full items-center justify-center overflow-hidden rounded-2xl border border-line bg-surface-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- user uploaded asset */}
            {coverUrl ? <img src={coverUrl} alt="Copertina attuale" className="h-full w-full object-cover grayscale" /> : <span className="text-xs text-subtle">Nessuna</span>}
          </div>
          <UploadButton target="cover" label="Cambia copertina" onError={setError} />
        </div>
      </div>
      <div>
        <p className="mb-2 text-sm font-medium">Galleria ({gallery.length}/12)</p>
        <ul className="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
          {gallery.map((g) => (
            <li key={g} className="group relative aspect-square overflow-hidden rounded-xl border border-line bg-surface-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- user uploaded asset */}
              <img src={g} alt="" className="h-full w-full object-cover grayscale" />
              <button
                type="button"
                aria-label="Rimuovi foto dalla galleria"
                disabled={removing}
                onClick={() => start(() => removeGalleryImageAction(g).then(() => undefined))}
                className="absolute top-1.5 right-1.5 rounded-full bg-black/70 p-1.5 text-white hover:bg-black"
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
        {gallery.length < 12 && <UploadButton target="gallery" label="Aggiungi foto" onError={setError} />}
      </div>
      {error && <Notice tone="error" title={error} />}
    </Section>
  );
}

export function PasswordForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(changePassword, null);
  return (
    <Section title="Account" description={`Accesso come ${email}`}>
      <form action={action} className="space-y-4">
        <input type="text" name="username" autoComplete="username" defaultValue={email} hidden readOnly />
        <Field label="Nuova password" htmlFor="password" hint="Almeno 10 caratteri.">
          <Input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required className="max-w-sm" />
        </Field>
        {state && <Notice tone={state.ok ? "success" : "error"} title={state.ok ? state.message : state.error} />}
        <Button type="submit" size="sm" variant="secondary" loading={pending}>
          Cambia password
        </Button>
      </form>
    </Section>
  );
}
