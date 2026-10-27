import { ArrowRight, ArrowUpRight, Clock, MapPin, Phone, Mail, Star } from "lucide-react";
import Link from "next/link";
import { AnnouncementVideo } from "@/components/announcement-video";
import { ButtonLink } from "@/components/ui/button";
import { formatDuration, formatPrice, initials } from "@/lib/format";
import { weeklySummary } from "@/lib/hours";
import type { PublicCatalog } from "@/server/public";
import { BrandMark } from "./brand-mark";
import { FacebookIcon, InstagramIcon } from "./brand-icons";

export function BusinessPage({ catalog, basePath }: { catalog: PublicCatalog; basePath: string }) {
  const { business: b, services, staff, hours, announcements } = catalog;
  const bookHref = `${basePath}/prenota`;
  const hero = b.cover_image_url ?? b.gallery[0] ?? null;
  const staffPhotos = new Set(staff.map((p) => p.avatar_url).filter(Boolean));
  const gallery = b.gallery.filter((g) => g !== hero && !staffPhotos.has(g));
  const address = [b.address_line, [b.postal_code, b.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const week = weeklySummary(hours);
  const mapsHref = b.google_maps_url ?? (address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${b.name} ${address}`)}` : null);

  return (
    <div className="flex min-h-dvh flex-col">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-line/60 bg-bg/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5">
          <Link href={basePath || "/"} className="text-text" aria-label={`${b.name}, home`}>
            <BrandMark business={b} className="h-5 w-auto sm:h-6" />
          </Link>
          <nav aria-label="Sezioni" className="hidden items-center gap-7 text-sm text-muted md:flex">
            <a href="#servizi" className="hover:text-text">Servizi</a>
            {staff.length > 0 && <a href="#team" className="hover:text-text">Team</a>}
            <a href="#info" className="hover:text-text">Orari e contatti</a>
          </nav>
          <ButtonLink href={bookHref} size="sm">
            Prenota
          </ButtonLink>
        </div>
      </header>

      <main id="main" className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden border-b border-line">
          <div className="mx-auto grid max-w-6xl gap-10 px-5 pt-12 pb-14 md:grid-cols-[1.1fr_0.9fr] md:items-end md:gap-14 md:pt-20 md:pb-20">
            <div className="animate-fade-up">
              {b.city && <p className="eyebrow">{b.city}</p>}
              <h1 className="mt-5">
                <span className="sr-only">{b.name}</span>
                <BrandMark business={b} className="h-auto w-full max-w-[34rem] text-text" />
              </h1>
              {b.tagline && <p className="display mt-6 text-2xl text-muted sm:text-3xl">{b.tagline}</p>}
              {b.description && <p className="mt-6 max-w-xl text-base leading-relaxed text-muted">{b.description}</p>}
              <div className="mt-9 flex flex-wrap items-center gap-3">
                <ButtonLink href={bookHref} size="lg">
                  Prenota un appuntamento
                  <ArrowRight className="size-4" aria-hidden="true" />
                </ButtonLink>
                <a href="#servizi" className="inline-flex h-13 items-center px-3 text-sm text-muted underline-offset-4 hover:text-text hover:underline">
                  Servizi e prezzi
                </a>
              </div>
            </div>
            {hero && (
              <div className="relative aspect-[4/5] w-full overflow-hidden rounded-3xl bg-surface md:aspect-[4/5]">
                {/* eslint-disable-next-line @next/next/no-img-element -- business images come from storage with unknown size */}
                <img src={hero} alt={`${b.name}, al lavoro`} className="h-full w-full object-cover grayscale" fetchPriority="high" />
              </div>
            )}
          </div>
        </section>

        {/* News from the shop */}
        {announcements.length > 0 && (
          <section id="novita" aria-labelledby="novita-title" className="scroll-mt-20 border-b border-line">
            <div className="mx-auto max-w-6xl px-5 py-12 md:py-16">
              <h2 id="novita-title" className="display text-4xl sm:text-5xl">Novità</h2>
              <ul className="mt-8 grid gap-5 md:grid-cols-2">
                {announcements.map((a) => (
                  <li key={a.id} className="flex flex-col gap-4 rounded-3xl border border-line bg-surface p-5">
                    <div>
                      <p className="text-xs text-subtle">{new Date(a.created_at).toLocaleDateString("it-IT", { day: "numeric", month: "long", timeZone: b.timezone })}</p>
                      <h3 className="mt-1 text-xl font-medium">{a.title}</h3>
                      {a.body && <p className="mt-2 whitespace-pre-line text-muted">{a.body}</p>}
                    </div>
                    {a.video_url && <AnnouncementVideo url={a.video_url} title={a.title} />}
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        {/* Services */}
        <section id="servizi" className="scroll-mt-20 border-b border-line">
          <div className="mx-auto max-w-6xl px-5 py-16 md:py-24">
            <div className="flex items-end justify-between gap-6">
              <h2 className="display text-4xl sm:text-5xl">Servizi</h2>
              <p className="hidden text-sm text-muted sm:block">Prezzi e durate indicative</p>
            </div>
            <ul className="mt-10 divide-y divide-line border-y border-line">
              {services.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`${bookHref}?servizio=${s.id}`}
                    className="group flex items-center gap-5 py-5 transition-colors hover:bg-surface/60 sm:px-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-lg font-medium">{s.name}</p>
                      <p className="mt-1 text-sm text-muted">
                        <span className="tabular">{formatDuration(s.duration_minutes)}</span>
                        {s.description && <span> · {s.description}</span>}
                      </p>
                    </div>
                    <p className="tabular text-lg font-medium">{formatPrice(s.price_cents, b.currency)}</p>
                    <ArrowRight className="size-4 text-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-text" aria-hidden="true" />
                    <span className="sr-only">Prenota {s.name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Team */}
        {staff.length > 0 && (
          <section id="team" className="scroll-mt-20 border-b border-line">
            <div className="mx-auto max-w-6xl px-5 py-16 md:py-24">
              <h2 className="display text-4xl sm:text-5xl">Il team</h2>
              <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {staff.map((p) => (
                  <li key={p.id} className="overflow-hidden rounded-3xl border border-line bg-surface">
                    {p.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element -- storage images with unknown size
                      <img src={p.avatar_url} alt={p.display_name} className="aspect-[4/5] w-full object-cover grayscale" loading="lazy" />
                    ) : (
                      <div className="flex aspect-[4/5] w-full items-center justify-center bg-surface-2" aria-hidden="true">
                        <span className="display text-8xl text-line-strong">{initials(p.display_name)}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-4 p-5">
                      <div>
                        <p className="text-lg font-medium">{p.display_name}</p>
                        {p.bio && <p className="mt-0.5 text-sm text-muted">{p.bio}</p>}
                      </div>
                      <Link
                        href={`${bookHref}?staff=${p.id}`}
                        className="inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-line-strong text-muted hover:border-text hover:text-text"
                        aria-label={`Prenota con ${p.display_name}`}
                      >
                        <ArrowRight className="size-4" aria-hidden="true" />
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
              {gallery.length > 0 && (
                <ul className="mt-5 grid grid-cols-2 gap-5 md:grid-cols-3">
                  {gallery.map((src) => (
                    <li key={src} className="overflow-hidden rounded-3xl bg-surface">
                      {/* eslint-disable-next-line @next/next/no-img-element -- storage images with unknown size */}
                      <img src={src} alt="" className="aspect-square w-full object-cover grayscale" loading="lazy" />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}

        {/* Info */}
        <section id="info" className="scroll-mt-20">
          <div className="mx-auto grid max-w-6xl gap-12 px-5 py-16 md:grid-cols-2 md:py-24">
            <div>
              <h2 className="display text-4xl sm:text-5xl">Orari</h2>
              {hours.length === 0 ? (
                <p className="mt-8 text-muted">Orari in aggiornamento.</p>
              ) : (
                <dl className="mt-8 divide-y divide-line border-y border-line">
                  {week.map((d) => (
                    <div key={d.weekday} className="flex justify-between gap-6 py-3.5">
                      <dt className="text-muted">{d.label}</dt>
                      <dd className={d.text ? "tabular text-right" : "text-subtle"}>{d.text ?? "Chiuso"}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
            <div>
              <h2 className="display text-4xl sm:text-5xl">Contatti</h2>
              <ul className="mt-8 space-y-5">
                {address && (
                  <li className="flex gap-4">
                    <MapPin className="mt-0.5 size-5 shrink-0 text-muted" aria-hidden="true" />
                    <div>
                      <p>{address}</p>
                      {mapsHref && (
                        <a href={mapsHref} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-sm text-muted underline-offset-4 hover:text-text hover:underline">
                          Indicazioni stradali <ArrowUpRight className="size-3.5" aria-hidden="true" />
                        </a>
                      )}
                    </div>
                  </li>
                )}
                {b.phone && (
                  <li className="flex gap-4">
                    <Phone className="mt-0.5 size-5 shrink-0 text-muted" aria-hidden="true" />
                    <a href={`tel:${b.phone.replace(/\s/g, "")}`} className="hover:underline underline-offset-4">{b.phone}</a>
                  </li>
                )}
                {b.email && (
                  <li className="flex gap-4">
                    <Mail className="mt-0.5 size-5 shrink-0 text-muted" aria-hidden="true" />
                    <a href={`mailto:${b.email}`} className="hover:underline underline-offset-4">{b.email}</a>
                  </li>
                )}
                <li className="flex gap-4">
                  <Clock className="mt-0.5 size-5 shrink-0 text-muted" aria-hidden="true" />
                  <p className="text-muted">
                    Prenoti in meno di un minuto, senza registrazione. Puoi spostare o annullare dal link che ricevi via email.
                  </p>
                </li>
              </ul>
              <div className="mt-8 flex flex-wrap gap-3">
                {b.instagram_url && (
                  <a href={b.instagram_url} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center gap-2 rounded-full border border-line-strong px-4 text-sm hover:border-text">
                    <InstagramIcon className="size-4" /> Instagram
                  </a>
                )}
                {b.facebook_url && (
                  <a href={b.facebook_url} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center gap-2 rounded-full border border-line-strong px-4 text-sm hover:border-text">
                    <FacebookIcon className="size-4" /> Facebook
                  </a>
                )}
                {b.reviews_url && (
                  <a href={b.reviews_url} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center gap-2 rounded-full border border-line-strong px-4 text-sm hover:border-text">
                    <Star className="size-4" aria-hidden="true" /> Recensioni
                  </a>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Closing CTA */}
        <section className="border-t border-line">
          <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-5 py-16 sm:flex-row sm:items-center sm:justify-between">
            <p className="display text-3xl sm:text-4xl">Il tuo posto ti aspetta.</p>
            <ButtonLink href={bookHref} size="lg">
              Prenota ora <ArrowRight className="size-4" aria-hidden="true" />
            </ButtonLink>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-8 text-sm text-subtle sm:flex-row sm:items-center sm:justify-between">
          <p>© {b.name}</p>
          <div className="flex gap-5">
            <Link href={`${basePath}/privacy`} className="hover:text-text">Privacy</Link>
            <Link href="/admin" className="hover:text-text">Area riservata</Link>
          </div>
        </div>
      </footer>

      {/* Mobile sticky booking bar */}
      <div className="sticky bottom-0 z-30 border-t border-line bg-bg/90 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md md:hidden">
        <ButtonLink href={bookHref} size="lg" className="w-full">
          Prenota un appuntamento
        </ButtonLink>
      </div>
    </div>
  );
}
