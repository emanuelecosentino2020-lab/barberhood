"use client";

import { Check, UserX } from "lucide-react";
import { useTransition, useState } from "react";
import { setStatusAction } from "@/app/admin/actions";
import { Spinner } from "@/components/ui/spinner";

/** One-tap "done" / "no-show" for today's appointments. */
export function QuickStatus({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (status: "completed" | "no_show") =>
    start(async () => {
      const r = await setStatusAction({ id, status });
      setError(r.ok ? null : r.error);
    });
  if (pending) return <Spinner className="size-5 text-muted" label="Aggiornamento" />;
  return (
    <div className="flex items-center gap-1.5">
      {error && <span className="sr-only" role="alert">{error}</span>}
      <button
        type="button"
        onClick={() => run("completed")}
        className="inline-flex size-9 items-center justify-center rounded-full border border-line-strong text-muted hover:border-success hover:text-success"
        aria-label="Segna come completato"
        title="Completato"
      >
        <Check className="size-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={() => run("no_show")}
        className="inline-flex size-9 items-center justify-center rounded-full border border-line-strong text-muted hover:border-warning hover:text-warning"
        aria-label="Segna come non presentato"
        title="Non presentato"
      >
        <UserX className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}
