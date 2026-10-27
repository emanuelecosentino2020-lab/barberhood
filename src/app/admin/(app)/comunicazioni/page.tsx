import { AnnouncementsManager } from "@/components/admin/announcements-manager";
import { PageHeader } from "@/components/admin/page-header";
import { Notice } from "@/components/ui/misc";
import type { Announcement } from "@/lib/announcements";
import { todayIn } from "@/lib/booking/time";
import { serverEnv } from "@/lib/env";
import { requireMember } from "@/server/auth";

export const metadata = { title: "Comunicazioni" };

export default async function AnnouncementsPage() {
  const { db, business: b } = await requireMember("admin");
  const { data, error } = await db
    .from("announcements")
    .select("id, title, body, video_url, created_at, expires_on, is_published")
    .eq("business_id", b.id)
    .order("created_at", { ascending: false })
    .limit(50);
  const pageUrl = `${serverEnv().NEXT_PUBLIC_SITE_URL.replace(/\/$/, "")}/${b.slug}#novita`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Comunicazioni"
        description="Annunci con testo e video: compaiono in cima alla pagina del negozio e li mandi ai clienti su WhatsApp con un tocco."
      />
      {error ? (
        <Notice tone="warning" title="Manca l'aggiornamento del database">
          Esegui lo script di aggiornamento nello SQL Editor di Supabase, poi ricarica questa pagina.
        </Notice>
      ) : (
        <AnnouncementsManager items={(data ?? []) as (Announcement & { is_published: boolean })[]} pageUrl={pageUrl} today={todayIn(b.timezone)} />
      )}
    </div>
  );
}
