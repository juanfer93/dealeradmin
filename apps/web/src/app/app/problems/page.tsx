'use client';

import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Logo } from '../../../components/ui/logo';
import { isPortfolioMode, portfolioWriteBlockedMessage } from '../../../lib/portfolio-mode';
import { LanguageSwitch, useLanguage } from '../../../lib/i18n';

type ProblemTicket = {
  id: string;
  ticketNumber: number;
  problem: string;
  evidence: string;
  scope: string;
  outOfScope: string;
  markdown: string;
  createdAt: string;
};

function fileName(ticketNumber: number): string {
  return `ticket-${String(ticketNumber).padStart(4, '0')}.md`;
}

function downloadMarkdown(ticket: ProblemTicket): void {
  const blob = new Blob([ticket.markdown], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName(ticket.ticketNumber);
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function ProblemsPage() {
  const router = useRouter();
  const { language, t } = useLanguage();
  const errorRef = useRef<HTMLParagraphElement>(null);
  const successRef = useRef<HTMLParagraphElement>(null);
  const [problem, setProblem] = useState('');
  const [evidence, setEvidence] = useState('');
  const [scope, setScope] = useState('');
  const [outOfScope, setOutOfScope] = useState('');
  const [tickets, setTickets] = useState<ProblemTicket[]>([]);
  const [loadingTickets, setLoadingTickets] = useState(!isPortfolioMode);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (isPortfolioMode) return undefined;
    const controller = new AbortController();
    fetch('/api/problems', { credentials: 'include', signal: controller.signal })
      .then(async (response) => {
        if (response.status === 401) {
          router.replace('/login');
          return null;
        }
        if (!response.ok) throw new Error(t.problems.loadError);
        return response.json() as Promise<ProblemTicket[]>;
      })
      .then((data) => { if (data) setTickets(data); })
      .catch((loadError: unknown) => {
        if (loadError instanceof DOMException && loadError.name === 'AbortError') return;
        setError(loadError instanceof Error ? loadError.message : t.problems.loadError);
      })
      .finally(() => setLoadingTickets(false));
    return () => controller.abort();
  }, [router, t.problems.loadError]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSuccess('');
    if (isPortfolioMode) {
      setError(portfolioWriteBlockedMessage);
      window.requestAnimationFrame(() => errorRef.current?.focus());
      return;
    }
    if (!problem.trim()) {
      setError(t.problems.problemHelp);
      window.requestAnimationFrame(() => errorRef.current?.focus());
      return;
    }

    setSaving(true);
    try {
      const response = await fetch('/api/problems', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ problem, evidence, scope, outOfScope }),
      });
      if (response.status === 401) {
        router.replace('/login');
        return;
      }
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { message?: string } | null;
        throw new Error(payload?.message || t.problems.error);
      }
      const ticket = await response.json() as ProblemTicket;
      setTickets((current) => [ticket, ...current]);
      setProblem('');
      setEvidence('');
      setScope('');
      setOutOfScope('');
      setSuccess(t.problems.created(fileName(ticket.ticketNumber)));
      downloadMarkdown(ticket);
      window.requestAnimationFrame(() => successRef.current?.focus());
    } catch (saveError: unknown) {
      setError(saveError instanceof Error ? saveError.message : t.problems.error);
      window.requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      setSaving(false);
    }
  }

  const dateFormatter = new Intl.DateTimeFormat(language === 'es' ? 'es-CO' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <main className="min-h-screen bg-[var(--page)]">
      <header className="flex min-h-16 items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-3 sm:px-5">
        <div className="flex items-center gap-3"><Logo size={32} /><span className="text-[15px] font-semibold tracking-[-0.02em]">dealerADMIN</span></div>
        <nav className="flex items-center gap-3 text-xs sm:gap-5" aria-label="Navegación principal">
          <Link href="/app" className="inline-flex min-h-11 items-center text-[var(--text-muted)] hover:text-[var(--text)]">{t.app.queue}</Link>
          <Link href="/app/reports" className="inline-flex min-h-11 items-center text-[var(--text-muted)] hover:text-[var(--text)]">{t.app.reports}</Link>
          <span className="hidden items-center gap-2 font-medium text-[var(--brand)] sm:flex"><span className="h-2 w-2 rounded-full bg-[var(--brand)]" aria-hidden="true" />{t.app.webhook}</span>
          <LanguageSwitch />
        </nav>
      </header>

      <section className="mx-auto max-w-6xl px-3 py-7 sm:px-6 sm:py-10" aria-labelledby="problems-title">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--brand)]">{t.problems.eyebrow}</p>
            <h1 id="problems-title" className="text-2xl font-semibold tracking-[-0.035em] sm:text-3xl">{t.problems.title}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-muted)]">{t.problems.description}</p>
          </div>
          <span className="rounded-[4px] border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs text-[var(--text-muted)]">Markdown persistente</span>
        </div>

        {isPortfolioMode && <p className="mb-4 border border-[var(--review)]/40 bg-[var(--review)]/10 px-4 py-3 text-sm text-[var(--review)]" role="status">{t.problems.demoBlocked}</p>}
        {error && <p ref={errorRef} tabIndex={-1} role="alert" className="mb-4 border border-[var(--error)]/30 bg-[var(--error)]/10 px-4 py-3 text-sm leading-5 text-[var(--error)]">{error}</p>}
        {success && <p ref={successRef} tabIndex={-1} role="status" className="mb-4 border border-[var(--brand)]/30 bg-[var(--brand-soft)] px-4 py-3 text-sm leading-5 text-[var(--brand-strong)]">{success}</p>}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.38fr)]">
          <form onSubmit={(event) => void handleSubmit(event)} className="overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--surface)] shadow-[0_10px_24px_rgba(19,32,29,0.04)]">
            <div className="border-b border-[var(--border)] px-4 py-4 sm:px-6">
              <h2 className="text-base font-semibold">Historia de usuario</h2>
              <p className="mt-1 text-sm text-[var(--text-muted)]">{t.problems.generatedNote}</p>
            </div>
            <div className="space-y-5 px-4 py-5 sm:px-6">
              <div>
                <label htmlFor="problem-description" className="mb-2 block text-sm font-medium">{t.problems.problem} <span aria-hidden="true">*</span></label>
                <textarea id="problem-description" name="problem" required value={problem} onChange={(event) => setProblem(event.target.value)} rows={7} placeholder="Ej. El lead de Stafford conserva el vehículo anterior cuando el cliente cambia de modelo…" className="min-h-40 w-full resize-y rounded-[6px] border border-[var(--border)] bg-[var(--surface)] px-3 py-3 text-base leading-6 text-[var(--text)] outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-[var(--text-muted)]/70 focus:border-[var(--brand)] focus:ring-2 focus:ring-[color:var(--brand)]/20 md:text-sm" aria-describedby="problem-description-help" />
                <p id="problem-description-help" className="mt-2 text-xs leading-5 text-[var(--text-muted)]">{t.problems.problemHelp}</p>
              </div>
              <div>
                <label htmlFor="problem-evidence" className="mb-2 block text-sm font-medium">{t.problems.evidence} <span className="text-xs font-normal text-[var(--text-muted)]">({t.problems.optional})</span></label>
                <textarea id="problem-evidence" name="evidence" value={evidence} onChange={(event) => setEvidence(event.target.value)} rows={4} placeholder="Conversación, lead, fecha, pasos para reproducir, logs…" className="w-full resize-y rounded-[6px] border border-[var(--border)] bg-[var(--surface)] px-3 py-3 text-base leading-6 text-[var(--text)] outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-[var(--text-muted)]/70 focus:border-[var(--brand)] focus:ring-2 focus:ring-[color:var(--brand)]/20 md:text-sm" aria-describedby="problem-evidence-help" />
                <p id="problem-evidence-help" className="mt-2 text-xs leading-5 text-[var(--text-muted)]">{t.problems.evidenceHelp}</p>
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                <div>
                  <label htmlFor="problem-scope" className="mb-2 block text-sm font-medium">{t.problems.scope} <span className="text-xs font-normal text-[var(--text-muted)]">({t.problems.optional})</span></label>
                  <textarea id="problem-scope" name="scope" value={scope} onChange={(event) => setScope(event.target.value)} rows={4} placeholder="Ej. Solo normalización de Stafford WhatsApp…" className="w-full resize-y rounded-[6px] border border-[var(--border)] bg-[var(--surface)] px-3 py-3 text-base leading-6 text-[var(--text)] outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-[var(--text-muted)]/70 focus:border-[var(--brand)] focus:ring-2 focus:ring-[color:var(--brand)]/20 md:text-sm" aria-describedby="problem-scope-help" />
                  <p id="problem-scope-help" className="mt-2 text-xs leading-5 text-[var(--text-muted)]">{t.problems.scopeHelp}</p>
                </div>
                <div>
                  <label htmlFor="problem-out-of-scope" className="mb-2 block text-sm font-medium">{t.problems.outOfScope} <span className="text-xs font-normal text-[var(--text-muted)]">({t.problems.optional})</span></label>
                  <textarea id="problem-out-of-scope" name="outOfScope" value={outOfScope} onChange={(event) => setOutOfScope(event.target.value)} rows={4} placeholder="Ej. No cambiar reglas de Fredericksburg Messenger…" className="w-full resize-y rounded-[6px] border border-[var(--border)] bg-[var(--surface)] px-3 py-3 text-base leading-6 text-[var(--text)] outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-[var(--text-muted)]/70 focus:border-[var(--brand)] focus:ring-2 focus:ring-[color:var(--brand)]/20 md:text-sm" aria-describedby="problem-out-of-scope-help" />
                  <p id="problem-out-of-scope-help" className="mt-2 text-xs leading-5 text-[var(--text-muted)]">{t.problems.outOfScopeHelp}</p>
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-3 border-t border-[var(--border)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <p className="text-xs leading-5 text-[var(--text-muted)]">Se descargará automáticamente un archivo con el formato <code>ticket-0001.md</code>.</p>
              <button type="submit" disabled={saving || isPortfolioMode} className="min-h-11 rounded-[6px] bg-[var(--brand)] px-5 py-2 text-sm font-semibold text-white transition-[background-color,opacity,transform] duration-150 hover:bg-[var(--brand-strong)] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)]">{saving ? t.problems.generating : t.problems.generate}</button>
            </div>
          </form>

          <aside className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[0_10px_24px_rgba(19,32,29,0.035)] sm:p-5 lg:sticky lg:top-5 lg:self-start" aria-labelledby="recent-problems-title">
            <div className="flex items-start justify-between gap-3">
              <div><p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Tickets</p><h2 id="recent-problems-title" className="mt-1 text-base font-semibold">{t.problems.recent}</h2></div>
              <span className="tabular-nums rounded-full border border-[var(--border)] bg-[var(--surface-raised)] px-2.5 py-1 text-xs font-semibold text-[var(--text-muted)]">{tickets.length}</span>
            </div>
            <div className="mt-4 space-y-2.5">
              {loadingTickets && <p className="text-sm text-[var(--text-muted)]" role="status">Cargando…</p>}
              {!loadingTickets && tickets.length === 0 && <p className="text-sm leading-6 text-[var(--text-muted)]">{t.problems.empty}</p>}
              {tickets.map((ticket) => <article key={ticket.id} className="rounded-[8px] border border-[var(--border)] bg-[var(--surface-raised)] p-3.5 transition-colors hover:border-[var(--brand)]/40 hover:bg-[var(--brand-soft)]/35"><div className="flex items-center justify-between gap-3"><p className="min-w-0 truncate font-mono text-[11px] font-semibold text-[var(--brand-strong)]">{fileName(ticket.ticketNumber)}</p><a href={`/api/problems/${ticket.ticketNumber}/markdown`} className="shrink-0 rounded-[5px] border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--brand-strong)] transition-colors hover:border-[var(--brand)] hover:bg-[var(--brand-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)]">{t.problems.download}</a></div><h3 className="mt-3 line-clamp-2 text-sm font-medium leading-5 text-[var(--text)]">{ticket.problem}</h3><p className="mt-3 border-t border-[var(--border)] pt-2.5 text-[11px] text-[var(--text-muted)]">{dateFormatter.format(new Date(ticket.createdAt))}</p></article>)}
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}
