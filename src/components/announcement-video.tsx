import { ArrowUpRight } from "lucide-react";
import { videoEmbed } from "@/lib/announcements";

/** Video of an announcement: our own file plays inline, YouTube is embedded, anything else is a link. */
export function AnnouncementVideo({ url, title }: { url: string; title: string }) {
  const v = videoEmbed(url);
  if (!v) return null;
  if (v.kind === "file") {
    return <video src={v.src} controls playsInline preload="metadata" className="aspect-[9/16] max-h-[70vh] w-full rounded-2xl bg-black object-contain" aria-label={title} />;
  }
  if (v.kind === "youtube") {
    return (
      <iframe
        src={v.src}
        title={title}
        loading="lazy"
        allow="accelerometer; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        className="aspect-video w-full rounded-2xl bg-black"
      />
    );
  }
  return (
    <a href={v.href} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 self-start items-center gap-2 rounded-full border border-line-strong px-4 text-sm hover:border-text">
      {v.label} <ArrowUpRight className="size-4" aria-hidden="true" />
    </a>
  );
}
