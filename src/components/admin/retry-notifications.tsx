"use client";

import { useState, useTransition } from "react";
import { retryFailedNotificationsAction } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";

export function RetryNotifications() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        loading={pending}
        onClick={() =>
          start(async () => {
            const r = await retryFailedNotificationsAction();
            setMsg(r.ok ? (r.message ?? "Fatto") : r.error);
          })
        }
      >
        Riprova invio
      </Button>
      {msg && <span role="status">{msg}</span>}
    </>
  );
}
