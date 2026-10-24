"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/misc";
import { login } from "../actions";

export function LoginForm() {
  const [state, action, pending] = useActionState(login, null);
  return (
    <form action={action} className="mt-8 space-y-4">
      <Field label="Email" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="username" required />
      </Field>
      <Field label="Password" htmlFor="password">
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </Field>
      {state && !state.ok && <Notice tone="error">{state.error}</Notice>}
      <Button type="submit" size="lg" className="w-full" loading={pending}>
        Entra
      </Button>
      <p className="text-xs text-subtle">Hai dimenticato la password? Chiedi al titolare di reimpostarla.</p>
    </form>
  );
}
