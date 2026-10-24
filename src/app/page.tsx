import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BusinessPage } from "@/components/public/business-page";
import { PublicPageSkeleton, PublicShell } from "@/components/public/shell";
import { getPublicCatalog } from "@/server/public";

/**
 * Root of the site. On a single-business deployment (custom domain of the
 * shop) it shows that business; DEFAULT_BUSINESS_SLUG selects which one.
 */
export default function Home() {
  return (
    <Suspense fallback={<PublicPageSkeleton />}>
      <DefaultBusiness />
    </Suspense>
  );
}

async function DefaultBusiness() {
  const slug = process.env.DEFAULT_BUSINESS_SLUG;
  if (!slug) notFound();
  const catalog = await getPublicCatalog(slug);
  if (!catalog) notFound();
  return (
    <PublicShell business={catalog.business}>
      <BusinessPage catalog={catalog} basePath={`/${slug}`} />
    </PublicShell>
  );
}
