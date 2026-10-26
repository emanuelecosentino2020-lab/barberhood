import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PublicShell } from "@/components/public/shell";
import { getPublicCatalog } from "@/server/public";

export const metadata: Metadata = { title: "Informativa privacy" };

export default function Page({ params }: PageProps<"/[slug]/privacy">) {
  return (
    <Suspense fallback={null}>
      <Content params={params} />
    </Suspense>
  );
}

/**
 * Template of the privacy notice for customers (art. 13 GDPR).
 * It is generated from the business data but MUST be reviewed by a qualified
 * professional before going live: see docs/PRIVACY-CHECKLIST.md.
 */
async function Content({ params }: { params: PageProps<"/[slug]/privacy">["params"] }) {
  const { slug } = await params;
  const catalog = await getPublicCatalog(slug);
  if (!catalog) notFound();
  const b = catalog.business;
  const controller = b.privacy_controller_name ?? b.name;
  const contact = b.privacy_controller_email ?? b.email ?? "[email da indicare]";
  const address = [b.address_line, b.postal_code, b.city].filter(Boolean).join(", ") || "[indirizzo da indicare]";

  return (
    <PublicShell business={b}>
      <main className="mx-auto w-full max-w-2xl px-5 py-14">
        <Link href={`/${slug}`} className="text-sm text-muted hover:text-text">
          ← {b.name}
        </Link>
        <h1 className="display mt-8 text-4xl">Informativa privacy</h1>
        <p className="mt-2 text-sm text-subtle">Prenotazioni online · ai sensi dell&apos;art. 13 del Regolamento (UE) 2016/679</p>

        <div className="mt-10 space-y-8 leading-relaxed text-muted [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-medium [&_h2]:text-text">
          <section>
            <h2>Titolare del trattamento</h2>
            <p>
              {controller}, {address}. Contatto: {contact}.
            </p>
          </section>
          <section>
            <h2>Dati raccolti</h2>
            <p>
              Nome e cognome, email, telefono, servizio e orario scelti, eventuale nota facoltativa. Non chiediamo dati sulla salute: ti
              preghiamo di non inserirli nelle note.
            </p>
          </section>
          <section>
            <h2>Finalità e base giuridica</h2>
            <p>
              Usiamo i dati solo per gestire la prenotazione: registrarla, inviarti conferma, promemoria e avvisi di modifica o
              annullamento, e contattarti in caso di imprevisti. Dopo l&apos;appuntamento possiamo inviarti una sola email per
              chiederti una recensione (al massimo una ogni sei mesi): se non la vuoi, rispondi a quella email o scrivici e non la
              riceverai più. La base giuridica è l&apos;esecuzione di misure precontrattuali e del
              contratto di servizio richiesto (art. 6.1.b GDPR). Non inviamo comunicazioni promozionali e non facciamo profilazione.
            </p>
          </section>
          <section>
            <h2>Conservazione</h2>
            <p>
              I dati del cliente vengono anonimizzati dopo {b.data_retention_months} mesi dall&apos;ultimo appuntamento, salvo obblighi di
              legge che richiedano una conservazione più lunga.
            </p>
          </section>
          <section>
            <h2>Fornitori che trattano i dati per nostro conto</h2>
            <p>
              Hosting dell&apos;applicazione (Vercel), database e autenticazione (Supabase, server nell&apos;Unione europea), invio email
              transazionali (Resend). Sono nominati responsabili del trattamento e, dove i dati possono essere trasferiti fuori dallo
              Spazio economico europeo, il trasferimento avviene con le garanzie previste dal GDPR.
            </p>
          </section>
          <section>
            <h2>Cookie</h2>
            <p>
              Il sito pubblico non usa cookie di profilazione né strumenti di tracciamento. L&apos;area riservata al personale usa solo
              cookie tecnici necessari all&apos;accesso.
            </p>
          </section>
          <section>
            <h2>I tuoi diritti</h2>
            <p>
              Puoi chiedere accesso, rettifica, cancellazione, limitazione, portabilità dei dati e opporti al trattamento scrivendo a{" "}
              {contact}. Hai anche il diritto di proporre reclamo al Garante per la protezione dei dati personali (garanteprivacy.it).
            </p>
          </section>
        </div>
      </main>
    </PublicShell>
  );
}
