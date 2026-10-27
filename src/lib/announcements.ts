export interface Announcement {
  id: string;
  title: string;
  body: string | null;
  video_url: string | null;
  created_at: string;
  expires_on: string | null;
}

export type VideoEmbed =
  | { kind: "file"; src: string }
  | { kind: "youtube"; src: string }
  | { kind: "link"; href: string; label: string };

/** Decides how to show an announcement video: our own file, a YouTube embed, or a plain link (Instagram, TikTok…). */
export function videoEmbed(url: string): VideoEmbed | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  if (u.pathname.includes("/business-videos/") || /\.(mp4|mov|webm)$/i.test(u.pathname)) return { kind: "file", src: u.toString() };

  const host = u.hostname.replace(/^www\.|^m\./, "");
  let yt: string | null = null;
  if (host === "youtu.be") yt = u.pathname.slice(1).split("/")[0] ?? null;
  else if (host === "youtube.com") {
    yt = u.searchParams.get("v") ?? u.pathname.match(/^\/(?:shorts|embed|live)\/([^/?#]+)/)?.[1] ?? null;
  }
  if (yt && /^[\w-]{6,20}$/.test(yt)) return { kind: "youtube", src: `https://www.youtube-nocookie.com/embed/${yt}` };

  const label = host.includes("instagram.com") ? "Guarda il video su Instagram" : host.includes("tiktok.com") ? "Guarda il video su TikTok" : "Guarda il video";
  return { kind: "link", href: u.toString(), label };
}

/** Prefilled WhatsApp share (the owner picks contacts or a broadcast list in the app). */
export function whatsAppShareUrl(a: Pick<Announcement, "title" | "body">, pageUrl: string): string {
  const text = [a.title, a.body, pageUrl].filter(Boolean).join("\n\n");
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
