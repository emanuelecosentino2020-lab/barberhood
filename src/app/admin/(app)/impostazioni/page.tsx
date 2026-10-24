import { PageHeader } from "@/components/admin/page-header";
import { BrandingImages, PasswordForm, SettingsForm } from "@/components/admin/settings-form";
import { canManage, requireMember } from "@/server/auth";
import { isEmailConfigured } from "@/server/notifications/supabase-store";

export const metadata = { title: "Impostazioni" };

export default async function SettingsPage() {
  const { business: b, role, user } = await requireMember();
  const manage = canManage(role);
  return (
    <div className="space-y-8">
      <PageHeader title="Impostazioni" description={manage ? "Profilo pubblico, regole di prenotazione e notifiche." : "Il tuo account."} />
      {manage && (
        <>
          <BrandingImages logoUrl={b.logo_url} coverUrl={b.cover_image_url} gallery={b.gallery ?? []} />
          <SettingsForm business={b} emailConfigured={isEmailConfigured()} />
        </>
      )}
      <PasswordForm email={user.email ?? ""} />
    </div>
  );
}
