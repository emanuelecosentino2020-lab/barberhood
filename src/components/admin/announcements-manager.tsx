"use client";

import { createClient } from "@supabase/supabase-js";
import { Copy, Eye, EyeOff, MessageCircle, Trash2, Video } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import {
  createAnnouncementAction,
  createVideoUploadAction,
  deleteAnnouncementAction,
  setAnnouncementPublishedAction,
} from "@/app/admin/actions";
import { AnnouncementVideo } from "@/components/announcement-video";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Card, Notice } from "@/components/ui/misc";
import { videoEmbed, whatsAppShareUrl, type Announcement } from "@/lib/announcements";

type Row = Announcement & { is_published: boolean };
type Result = { ok: boolean; text: string } | null;

export function AnnouncementsManager({ items, pageUrl, today }: { items: Row[]; pageUrl: string; today: string }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [uploading, setUploading] = useState(false);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<Result>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setResult(null);
    setUploading(true);
    try {
      const r = await createVideoUploadAction({ contentType: file.type, size: file.size });
      if (!r.ok) return setResult({ ok: false, text: r.error });
      const storage = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!).storage;
      const { error } = await storage.from("business-videos").uploadToSignedUrl(r.data!.path, r.data!.token, file, { contentType: file.type });
      if (error) return setResult({ ok: false, text: "Caricamento non riuscito. Controlla la connessione e riprova." });
      setVideoUrl(r.data!.publicUrl);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const preview = videoUrl ? videoEmbed(videoUrl) : null;

  return (
    <div className="space-y-6">
      <Card className="p-4 sm:p-5">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await createAnnouncementAction({ title, body, videoUrl, expiresOn });
              setResult(r.ok ? { ok: true, text: r.message ?? "Pubblicato." } : { ok: false, text: r.error });
              if (r.ok) {
                setTitle("");
                setBody("");
                setVideoUrl("");
                setExpiresOn("");
              }
            });
          }}
        >
          <p className="text-sm font-medium">Nuova comunicazione</p>
          <Field label="Titolo" htmlFor="ann-title">
            <Input id="ann-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="Es. Sabato 2 novembre chiusi" required />
          </Field>
          <Field label="Testo (facoltativo)" htmlFor="ann-body">
            <Textarea id="ann-body" rows={3} value={body} maxLength={2000} onChange={(e) => setBody(e.target.value)} />
          </Field>
          <Field
            label="Video (facoltativo)"
            htmlFor="ann-video"
            hint="Carica un video dal telefono (MP4 o MOV, massimo 50 MB) oppure incolla il link di un video YouTube o Instagram."
          >
            <div className="flex flex-wrap gap-2">
              <Input id="ann-video" type="url" className="min-w-0 flex-1" value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="https://…" />
              <input
                ref={fileRef}
                type="file"
                accept="video/mp4,video/quicktime,video/webm"
                className="sr-only"
                id="ann-file"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void upload(f);
                }}
              />
              <Button type="button" variant="secondary" loading={uploading} onClick={() => fileRef.current?.click()}>
                <Video className="size-4" aria-hidden="true" /> {uploading ? "Caricamento…" : "Carica video"}
              </Button>
            </div>
          </Field>
          {preview && (
            <div className="max-w-sm">
              <AnnouncementVideo url={videoUrl} title={title || "Anteprima"} />
            </div>
          )}
          <Field label="Togli dalla pagina dopo il (facoltativo)" htmlFor="ann-exp" hint="Lascia vuoto per tenerla finché non la nascondi tu.">
            <Input id="ann-exp" type="date" min={today} className="w-48" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
          </Field>
          {result && <Notice tone={result.ok ? "success" : "error"} title={result.text} />}
          <Button type="submit" loading={pending} disabled={uploading}>
            Pubblica sulla pagina
          </Button>
        </form>
      </Card>

      {items.length === 0 ? (
        <p className="text-sm text-muted">Nessuna comunicazione ancora.</p>
      ) : (
        <ul className="space-y-3">
          {items.map((a) => {
            const expired = !!a.expires_on && a.expires_on < today;
            const live = a.is_published && !expired;
            return (
              <li key={a.id}>
                <Card className="p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{a.title}</p>
                      <p className="mt-0.5 text-sm text-muted">
                        {live ? "Visibile sulla pagina" : expired ? "Scaduta" : "Nascosta"}
                        {a.video_url && " · con video"}
                        {a.expires_on && !expired && ` · fino al ${new Date(`${a.expires_on}T12:00:00`).toLocaleDateString("it-IT", { day: "numeric", month: "long" })}`}
                      </p>
                      {a.body && <p className="mt-2 whitespace-pre-line text-sm">{a.body}</p>}
                    </div>
                    <button
                      type="button"
                      aria-label="Elimina comunicazione"
                      disabled={pending}
                      onClick={() => {
                        if (window.confirm("Eliminare questa comunicazione?")) start(() => deleteAnnouncementAction(a.id).then(() => undefined));
                      }}
                      className="rounded-full p-2 text-muted hover:bg-surface-2 hover:text-danger"
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </button>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <a
                      href={whatsAppShareUrl(a, pageUrl)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-9 items-center gap-2 rounded-full border border-line-strong px-4 text-sm hover:border-text"
                    >
                      <MessageCircle className="size-4" aria-hidden="true" /> Invia su WhatsApp
                    </a>
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard?.writeText([a.title, a.body, pageUrl].filter(Boolean).join("\n\n")).then(() => setCopied(a.id));
                      }}
                      className="inline-flex h-9 items-center gap-2 rounded-full border border-line-strong px-4 text-sm hover:border-text"
                    >
                      <Copy className="size-4" aria-hidden="true" /> {copied === a.id ? "Copiato" : "Copia testo e link"}
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => start(() => setAnnouncementPublishedAction(a.id, !a.is_published).then(() => undefined))}
                      className="inline-flex h-9 items-center gap-2 rounded-full border border-line-strong px-4 text-sm hover:border-text"
                    >
                      {a.is_published ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
                      {a.is_published ? "Nascondi" : "Mostra di nuovo"}
                    </button>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
