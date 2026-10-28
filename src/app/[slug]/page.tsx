import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BusinessPage } from "@/components/public/business-page";
import { PublicPageSkeleton, PublicShell } from "@/components/public/shell";
import { getPublicCatalog } from "@/server/public";
import { publicBasePath } from "@/server/tenant";

export async function generateMetadata({ params }: PageProps<"/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const catalog = await getPublicCatalog(slug);
  if (!catalog) return { title: "Pagina non trovata" };
  const b = catalog.business;
  const description = b.description ?? `Prenota online da ${b.name}${b.city ? ` a ${b.city}` : ""}.`;
  return {
    title: `${b.name}${b.city ? ` · ${b.city}` : ""} · Prenota online`,
    description,
    openGraph: { title: b.name, description, images: b.gallery[0] ? [b.gallery[0]] : undefined, type: "website" },
  };
}

export default function Page({ params }: PageProps<"/[slug]">) {
  return (
    <Suspense fallback={<PublicPageSkeleton />}>
      <Content params={params} />
    </Suspense>
  );
}

async function Content({ params }: { params: PageProps<"/[slug]">["params"] }) {
  const { slug } = await params;
  const catalog = await getPublicCatalog(slug);
  if (!catalog) notFound();
  return (
    <PublicShell business={catalog.business}>
      <BusinessPage catalog={catalog} basePath={await publicBasePath(slug)} />
    </PublicShell>
  );
}
