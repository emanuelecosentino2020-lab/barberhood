"use client";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="theme-dark flex min-h-dvh flex-1 flex-col items-center justify-center bg-bg px-6 text-center text-text">
      <h1 className="display text-4xl">Qualcosa è andato storto</h1>
      <p className="mt-4 max-w-sm text-muted">Non è colpa tua. Riprova tra qualche secondo.</p>
      <button onClick={reset} className="mt-8 h-11 rounded-full bg-accent px-6 text-sm font-medium text-accent-ink">
        Riprova
      </button>
    </main>
  );
}
