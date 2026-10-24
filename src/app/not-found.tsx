import Link from "next/link";

export default function NotFound() {
  return (
    <main className="theme-dark flex min-h-dvh flex-1 flex-col items-center justify-center bg-bg px-6 text-center text-text">
      <p className="eyebrow">Errore 404</p>
      <h1 className="display mt-4 text-5xl">Pagina non trovata</h1>
      <p className="mt-4 max-w-sm text-muted">Il link potrebbe essere scaduto o non corretto.</p>
      <Link href="/" className="mt-8 text-sm underline underline-offset-4">
        Torna alla home
      </Link>
    </main>
  );
}
