"use client";

import { useActionState, useRef, useTransition } from "react";
import { anonymizeCustomerAction, updateCustomerAction, type ActionResult } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/misc";
import type { Customer } from "@/lib/types";

export function CustomerForm({ customer: c, canErase }: { customer: Customer; canErase: boolean }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(updateCustomerAction, null);
  const [erasing, startErase] = useTransition();
  const dialog = useRef<HTMLDialogElement>(null);

  return (
    <>
      <form action={action} className="space-y-4">
        <input type="hidden" name="id" value={c.id} />
        <Field label="Nome" htmlFor="full_name">
          <Input id="full_name" name="full_name" defaultValue={c.full_name} required maxLength={120} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Telefono" htmlFor="phone">
            <Input id="phone" name="phone" type="tel" defaultValue={c.phone ?? ""} />
          </Field>
          <Field label="Email" htmlFor="email">
            <Input id="email" name="email" type="email" defaultValue={c.email ?? ""} />
          </Field>
        </div>
        <Field label="Note interne" htmlFor="notes" hint="Visibili solo al negozio. Non inserire dati sensibili (salute, ecc.).">
          <Textarea id="notes" name="notes" defaultValue={c.notes ?? ""} maxLength={1000} />
        </Field>
        {state && <Notice tone={state.ok ? "success" : "error"} title={state.ok ? state.message : state.error} />}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button type="submit" size="sm" loading={pending}>
            Salva
          </Button>
          {canErase && (
            <Button type="button" variant="ghost" size="sm" onClick={() => dialog.current?.showModal()}>
              Cancella dati personali
            </Button>
          )}
        </div>
      </form>

      <dialog ref={dialog} aria-labelledby="erase-title" className="m-auto w-[min(92vw,28rem)] rounded-3xl border border-line bg-surface p-6 text-text backdrop:bg-black/50">
        <h2 id="erase-title" className="text-lg font-semibold">
          Cancellare i dati personali?
        </h2>
        <p className="mt-2 text-sm text-muted">
          Nome, telefono, email e note vengono eliminati in modo definitivo (richiesta di cancellazione GDPR). Gli appuntamenti restano in forma anonima per le statistiche. Non si può annullare.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => dialog.current?.close()}>
            Indietro
          </Button>
          <Button
            type="button"
            variant="danger"
            size="sm"
            loading={erasing}
            onClick={() =>
              startErase(async () => {
                await anonymizeCustomerAction(c.id);
                dialog.current?.close();
              })
            }
          >
            Cancella definitivamente
          </Button>
        </div>
      </dialog>
    </>
  );
}
