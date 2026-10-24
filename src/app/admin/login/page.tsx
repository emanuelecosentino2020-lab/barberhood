import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Accesso", robots: { index: false } };

export default function LoginPage() {
  return (
    <main className="theme-light flex min-h-dvh flex-1 items-center justify-center bg-bg px-5 text-text">
      <div className="w-full max-w-sm">
        <p className="eyebrow">Area riservata</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Accedi</h1>
        <p className="mt-2 text-sm text-muted">Gestisci appuntamenti, orari e servizi.</p>
        <LoginForm />
      </div>
    </main>
  );
}
