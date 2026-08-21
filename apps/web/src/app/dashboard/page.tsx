'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function DashboardPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let active = true;
    fetch('/api/auth/session', { credentials: 'include' })
      .then((response) => {
        if (!response.ok) throw new Error('Session check failed');
        return response.json() as Promise<{ authenticated: boolean }>;
      })
      .then(({ authenticated }) => {
        if (!authenticated) router.replace('/login');
        else if (active) setChecking(false);
      })
      .catch(() => router.replace('/login'));
    return () => { active = false; };
  }, [router]);

  if (checking) {
    return <main className="flex min-h-screen items-center justify-center text-sm text-[var(--muted)]">Checking session…</main>;
  }

  return (
    <main className="min-h-screen bg-[var(--page)] px-5 py-10 sm:px-10">
      <div className="mx-auto max-w-5xl">
        <header className="flex items-center justify-between border-b border-[var(--line)] pb-6">
          <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--teal)]">dealerADMIN</p><h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em]">Operator dashboard</h1></div>
          <span className="rounded-full border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--muted)]">Session active</span>
        </header>
        <section className="mt-8 grid gap-4 sm:grid-cols-3" aria-label="Lead routing overview">
          <article className="rounded-[10px] border border-[var(--line)] bg-[var(--surface)] p-5"><p className="text-sm text-[var(--muted)]">Pending leads</p><p className="mt-4 text-3xl font-semibold tabular-nums">0</p></article>
          <article className="rounded-[10px] border border-[var(--line)] bg-[var(--surface)] p-5"><p className="text-sm text-[var(--muted)]">Active dealers</p><p className="mt-4 text-3xl font-semibold tabular-nums">0</p></article>
          <article className="rounded-[10px] border border-[var(--line)] bg-[var(--surface)] p-5"><p className="text-sm text-[var(--muted)]">Webhook status</p><p className="mt-4 text-lg font-semibold text-[var(--teal)]">Ready</p></article>
        </section>
      </div>
    </main>
  );
}
