import { describe, expect, it } from "vitest";
import { videoEmbed, whatsAppShareUrl } from "./announcements";

describe("videoEmbed", () => {
  it("plays uploaded files directly", () => {
    expect(videoEmbed("https://x.supabase.co/storage/v1/object/public/business-videos/b/v.mp4")).toEqual({
      kind: "file",
      src: "https://x.supabase.co/storage/v1/object/public/business-videos/b/v.mp4",
    });
  });

  it("embeds YouTube links, shorts included, without tracking cookies", () => {
    expect(videoEmbed("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toEqual({ kind: "youtube", src: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ" });
    expect(videoEmbed("https://youtu.be/dQw4w9WgXcQ?si=abc")).toMatchObject({ kind: "youtube" });
    expect(videoEmbed("https://youtube.com/shorts/dQw4w9WgXcQ")).toMatchObject({ kind: "youtube" });
  });

  it("links out to Instagram and refuses non-https or broken URLs", () => {
    expect(videoEmbed("https://www.instagram.com/reel/abc/")).toMatchObject({ kind: "link", label: "Guarda il video su Instagram" });
    expect(videoEmbed("http://example.com/v.mp4")).toBeNull();
    expect(videoEmbed("javascript:alert(1)")).toBeNull();
    expect(videoEmbed("not a url")).toBeNull();
  });
});

describe("whatsAppShareUrl", () => {
  it("puts title, text and page link in the message", () => {
    const url = whatsAppShareUrl({ title: "Chiusi lunedì", body: "Ci vediamo martedì" }, "https://x.it/barberhood#novita");
    expect(decodeURIComponent(url.split("text=")[1]!)).toBe("Chiusi lunedì\n\nCi vediamo martedì\n\nhttps://x.it/barberhood#novita");
  });
});
