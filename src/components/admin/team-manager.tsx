"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { saveStaffAction, uploadImageAction } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/field";
import { Avatar, Card, Notice } from "@/components/ui/misc";
import type { Staff } from "@/lib/types";

function StaffForm({ member, onDone }: { member: Staff | null; onDone: () => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [avatar, setAvatar] = useState<string | null>(member?.avatar_url ?? null);
  const [uploading, startUpload] = useTransition();
  const prefix = member?.id ?? "new";

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setError(null);
        start(async () => {
          const r = await saveStaffAction(member?.id ?? null, {
            display_name: String(f.get("display_name") ?? ""),
            bio: String(f.get("bio") ?? ""),
            is_active: f.get("is_active") === "on",
            avatar_url: avatar,
          });
          if (!r.ok) setError(r.error);
          else onDone();
        });
      }}
    >
      <div className="flex items-center gap-4">
        <Avatar name={member?.display_name ?? "?"} src={avatar} size={64} />
        <div className="flex flex-wrap gap-2">
          <label className="inline-flex h-9 cursor-pointer items-center rounded-full border border-line-strong px-4 text-sm hover:border-text focus-within:ring-2 focus-within:ring-text">
            {uploading ? "Caricamento…" : "Carica foto"}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const fd = new FormData();
                fd.set("file", file);
                fd.set("target", "staff");
                startUpload(async () => {
                  const r = await uploadImageAction(fd);
                  if (r.ok) setAvatar(r.data!.url);
                  else setError(r.error);
                });
              }}
            />
          </label>
          {avatar && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setAvatar(null)}>
              Rimuovi foto
            </Button>
          )}
        </div>
      </div>
      <Field label="Nome mostrato" htmlFor={`${prefix}-name`}>
        <Input id={`${prefix}-name`} name="display_name" defaultValue={member?.display_name} required maxLength={80} />
      </Field>
      <Field label="Presentazione (facoltativa)" htmlFor={`${prefix}-bio`}>
        <Textarea id={`${prefix}-bio`} name="bio" defaultValue={member?.bio ?? ""} maxLength={500} />
      </Field>
      <Checkbox name="is_active" defaultChecked={member?.is_active ?? true} label="Attivo e prenotabile" />
      {!member && <p className="text-sm text-muted">Il nuovo professionista esegue tutti i servizi attivi e segue gli orari del negozio. Puoi cambiarli dopo.</p>}
      {error && <Notice tone="error" title={error} />}
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={pending} disabled={uploading}>
          Salva
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Annulla
        </Button>
      </div>
    </form>
  );
}

export function TeamManager({ staff }: { staff: Staff[] }) {
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      {editing === "new" ? (
        <Card className="p-5">
          <h2 className="mb-4 font-medium">Nuovo professionista</h2>
          <StaffForm member={null} onDone={() => setEditing(null)} />
        </Card>
      ) : (
        <Button size="sm" onClick={() => setEditing("new")}>
          <Plus className="size-4" aria-hidden="true" /> Aggiungi
        </Button>
      )}
      <Card>
        <ul className="divide-y divide-line">
          {staff.map((s) => (
            <li key={s.id} className="px-4 py-4 sm:px-5">
              {editing === s.id ? (
                <StaffForm member={s} onDone={() => setEditing(null)} />
              ) : (
                <div className="flex items-center gap-4">
                  <Avatar name={s.display_name} src={s.avatar_url} />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {s.display_name}
                      {!s.is_active && <span className="ml-2 text-xs font-normal text-subtle">non attivo</span>}
                    </p>
                    {s.bio && <p className="truncate text-sm text-muted">{s.bio}</p>}
                  </div>
                  <Link href={`/admin/orari?staff=${s.id}`} className="hidden text-sm text-muted hover:text-text sm:inline">
                    Orari
                  </Link>
                  <Button size="sm" variant="secondary" onClick={() => setEditing(s.id)}>
                    Modifica
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
