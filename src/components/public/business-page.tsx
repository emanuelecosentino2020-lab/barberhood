import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { formatDuration, formatPrice } from "@/lib/format";
import { weeklySummary } from "@/lib/hours";
import type { PublicCatalog } from "@/server/public";
import { BrandMark } from "./brand-mark";

export function BusinessPage({ catalog, basePath }: { catalog: PublicCatalog; basePath: string }) {
  const { business: b, services, staff, hours } = catalog;
  const bookHref = `${basePath}/prenota`;
  const hero = b.cover_image_url ?? b.gallery[0] ?? null;
  const staffPhotos = new Set(staff.map((p) => p.avatar_url).filter(Boolean));
  const gallery = b.gallery.filter((g) => g !== hero && !staffPhotos.has(g));
  const address = [b.address_line, [b.postal_code, b.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const week = weeklySummary(hours);
  const pictured = staff.filter((p) => p.avatar_url);
  const unpictured = staff.filter((p) => !p.avatar_url);
  const team = joinNames(pictured.map((p) => p.display_name.split(" ")[0]));
  const mapsHref = b.google_maps_url ?? (address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${b.name} ${address}`)}` : null);

  return (
    <div className="flex min-h-dvh flex-col">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-line bg-bg">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5">
          <Link href={basePath || "/"} className="text-text" aria-label={`${b.name}, home`}>
            <BrandMark business={b} className="h-5 w-auto sm:h-6" />
          </Link>
          <nav aria-label="Sezioni" className="hidden items-center gap-7 text-sm text-muted md:flex">
            <a href="#servizi" className="hover:text-text">Listino</a>
            {staff.length > 0 && <a href="#team" className="hover:text-text">Barbieri</a>}
            <a href="#info" className="hover:text-text">Orari e indirizzo</a>
          </nav>
          <ButtonLink href={bookHref} size="sm">
            Prenota
          </ButtonLink>
        </div>
      </header>

      <main id="main" className="flex-1">
        {/* Hero: photo first, like a shop window; text sits beside it, not centered */}
        <section className="border-b border-line">
          <div className="mx-auto grid max-w-6xl md:grid-cols-12 md:gap-10 md:px-5 md:pt-14 md:pb-16">
            <div className="order-2 px-5 pt-8 pb-12 md:order-1 md:col-span-5 md:flex md:flex-col md:justify-end md:px-0 md:pt-0 md:pb-2">
              <h1>
                <span className="sr-only">{b.name}</span>
                <BrandMark business={b} className="h-auto w-full max-w-[26rem] text-text" />
              </h1>
              {b.tagline && <p className="mt-4 text-lg text-muted">{b.tagline}</p>}
              {b.description && <p className="mt-6 max-w-md leading-relaxed">{b.description}</p>}
              <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
                <ButtonLink href={bookHref} size="lg">
                  Prenota
                </ButtonLink>
                <a href="#servizi" className="text-sm text-muted underline underline-offset-4 decoration-line-strong hover:text-text">
                  Listino
                </a>
              </div>
            </div>
            {hero && (
              <figure className="order-1 md:order-2 md:col-span-7">
                {/* eslint-disable-next-line @next/next/no-img-element -- business images come from storage with unknown size */}
                <img src={hero} alt={team ? `${team}, ${b.name}` : b.name} className="aspect-[4/5] w-full object-cover grayscale md:aspect-[5/6]" fetchPriority="high" />
                {(team || b.city) && (
                  <figcaption className="mt-2 px-5 text-xs text-subtle md:px-0">
                    {[team, b.city].filter(Boolean).join(" · ")}
                  </figcaption>
                )}
              </figure>
            )}
          </div>
        </section>

        {/* Services: a price list, the way it hangs on the wall */}
        <section id="servizi" className="scroll-mt-20 border-b border-line">
          <div className="mx-auto max-w-6xl px-5 py-16 md:py-24">
            <h2 className="display text-4xl sm:text-5xl">Listino</h2>
            <ul className="mt-10 grid gap-x-16 md:grid-cols-2">
              {services.map((s) => (
                <li key={s.id}>
                  <Link href={`${bookHref}?servizio=${s.id}`} className="group block py-4" aria-label={`Prenota ${s.name}, ${formatPrice(s.price_cents, b.currency)}`}>
                    <span className="flex items-baseline gap-3">
                      <span className="font-medium group-hover:underline group-hover:underline-offset-4">{s.name}</span>
                      <span className="flex-1 translate-y-[-0.3em] border-b border-dotted border-line-strong" aria-hidden="true" />
                      <span className="tabular font-medium">{formatPrice(s.price_cents, b.currency)}</span>
                    </span>
                    <span className="tabular mt-0.5 block text-sm text-subtle">
                      {formatDuration(s.duration_minutes)}
                      {s.description && ` · ${s.description}`}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Team: portraits staggered, no card chrome; people without a photo are named in text */}
        {staff.length > 0 && (
          <section id="team" className="scroll-mt-20 border-b border-line">
            <div className="mx-auto max-w-6xl px-5 py-16 md:py-24">
              <h2 className="display text-4xl sm:text-5xl">Chi ti taglia</h2>
              {pictured.length > 0 && (
                <ul className="mt-10 grid grid-cols-2 gap-4 sm:gap-8 md:max-w-4xl">
                  {pictured.map((p, i) => (
                    <li key={p.id} className={i % 2 === 1 ? "mt-12 md:mt-24" : undefined}>
                      <Link href={`${bookHref}?staff=${p.id}`} className="group block" aria-label={`Prenota con ${p.display_name}`}>
                        {/* eslint-disable-next-line @next/next/no-img-element -- storage images with unknown size */}
                        <img src={p.avatar_url!} alt={p.display_name} className="aspect-[4/5] w-full object-cover grayscale transition-[filter] duration-300 group-hover:grayscale-0" loading="lazy" />
                        <p className="display mt-3 text-xl sm:text-2xl">{p.display_name}</p>
                        {p.bio && <p className="text-sm text-muted">{p.bio}</p>}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {unpictured.length > 0 && (
                <p className="mt-10 text-muted">
                  {pictured.length > 0 ? "In negozio anche " : ""}
                  {unpictured.map((p, i) => (
                    <span key={p.id}>
                      {i > 0 && (i === unpictured.length - 1 ? " e " : ", ")}
                      <Link href={`${bookHref}?staff=${p.id}`} className="text-text underline underline-offset-4 decoration-line-strong hover:decoration-text">
                        {p.display_name}
                      </Link>
                    </span>
                  ))}
                  .
                </p>
              )}
              {gallery.length > 0 && (
                <ul className="mt-12 grid grid-cols-2 gap-4 md:grid-cols-3">
                  {gallery.map((src) => (
                    <li key={src}>
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
          <div className="mx-auto grid max-w-6xl gap-14 px-5 py-16 md:grid-cols-12 md:py-24">
            <div className="md:col-span-5">
              <h2 className="display text-4xl sm:text-5xl">Orari</h2>
              {hours.length === 0 ? (
                <p className="mt-8 text-muted">Orari in aggiornamento.</p>
              ) : (
                <dl className="mt-8">
                  {week.map((d) => (
                    <div key={d.weekday} className="flex justify-between gap-6 border-b border-line py-3">
                      <dt className="text-muted">{d.label}</dt>
                      <dd className={d.text ? "tabular text-right" : "text-subtle"}>{d.text ?? "Chiuso"}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
            <div className="md:col-span-6 md:col-start-7">
              <h2 className="display text-4xl sm:text-5xl">Dove siamo</h2>
              <dl className="mt-8 space-y-6">
                {address && (
                  <div>
                    <dt className="text-sm text-subtle">Indirizzo</dt>
                    <dd className="mt-1 text-lg">
                      {address}
                      {mapsHref && (
                        <a href={mapsHref} target="_blank" rel="noopener noreferrer" className="mt-1 block text-sm text-muted underline underline-offset-4 decoration-line-strong hover:text-text">
                          Apri in Maps
                        </a>
                      )}
                    </dd>
                  </div>
                )}
                {b.phone && (
                  <div>
                    <dt className="text-sm text-subtle">Telefono</dt>
                    <dd className="mt-1 text-lg">
                      <a href={`tel:${b.phone.replace(/\s/g, "")}`} className="tabular hover:underline underline-offset-4">{b.phone}</a>
                    </dd>
                  </div>
                )}
                {b.email && (
                  <div>
                    <dt className="text-sm text-subtle">Email</dt>
                    <dd className="mt-1 text-lg">
                      <a href={`mailto:${b.email}`} className="hover:underline underline-offset-4">{b.email}</a>
                    </dd>
                  </div>
                )}
                {(b.instagram_url || b.facebook_url || b.reviews_url) && (
                  <div>
                    <dt className="text-sm text-subtle">Online</dt>
                    <dd className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-lg">
                      {b.instagram_url && (
                        <a href={b.instagram_url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 decoration-line-strong hover:decoration-text">
                          {instagramHandle(b.instagram_url) ?? "Instagram"}
                        </a>
                      )}
                      {b.facebook_url && (
                        <a href={b.facebook_url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 decoration-line-strong hover:decoration-text">
                          Facebook
                        </a>
                      )}
                      {b.reviews_url && (
                        <a href={b.reviews_url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 decoration-line-strong hover:decoration-text">
                          Recensioni Google
                        </a>
                      )}
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          </div>
        </section>

        {/* Closing */}
        <section className="border-t border-line">
          <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-5 py-14 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="display text-3xl sm:text-4xl">{b.city ? `Ci vediamo a ${b.city}.` : "Ci vediamo in negozio."}</p>
              <p className="mt-2 text-sm text-muted">Niente registrazione. Se cambi idea, sposti o annulli dal link nell&apos;email.</p>
            </div>
            <ButtonLink href={bookHref} size="lg">
              Prenota
            </ButtonLink>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-8 text-sm text-subtle sm:flex-row sm:items-center sm:justify-between">
          <p>© {b.name}</p>
          <div className="flex gap-5">
            <Link href={`${basePath}/privacy`} className="hover:text-text">Privacy</Link>
          </div>
        </div>
      </footer>

      {/* Mobile sticky booking bar */}
      <div className="sticky bottom-0 z-30 border-t border-line bg-bg p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden">
        <ButtonLink href={bookHref} size="lg" className="w-full">
          Prenota
        </ButtonLink>
      </div>
    </div>
  );
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
}

function instagramHandle(url: string): string | null {
  const m = url.match(/instagram\.com\/([A-Za-z0-9._]+)/);
  return m ? `@${m[1]}` : null;
}
