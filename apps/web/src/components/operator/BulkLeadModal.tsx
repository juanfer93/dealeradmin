'use client';

import { useEffect, useState } from 'react';
import { isPortfolioMode, portfolioWriteBlockedMessage } from '../../lib/portfolio-mode';
import { useLanguage } from '../../lib/i18n';

type BulkRow = { rowNumber: number; name: string; phone: string; status: 'inserted' | 'duplicate' | 'invalid'; reason?: string };
type BulkResponse = { summary: { received: number; inserted: number; duplicates: number; invalid: number }; rows: BulkRow[] };

interface BulkLeadModalProps { isOpen: boolean; onClose: () => void; dealerId: string; onImported: () => void; }

function responseMessage(body: unknown, fallback: string): string {
  if (typeof body === 'object' && body !== null && 'message' in body && typeof body.message === 'string') return body.message;
  return fallback;
}

export function BulkLeadModal({ isOpen, onClose, dealerId, onImported }: BulkLeadModalProps) {
  const { language } = useLanguage();
  const copy = language === 'es' ? {
    eyebrow: 'Ingesta de leads', title: 'Subir leads masivamente', help: 'Un lead por línea. Pega la conversación resumida en lenguaje natural, sin separadores especiales.', inputLabel: 'Leads para procesar', placeholder: 'Ana Torres 3019876543 SUV, 2000 de down, ID y cuenta bancaria, quiere comprar este mes, prueba de ingresos', format: 'Ejemplo: Nombre teléfono vehículo, down, ID y cuenta bancaria, quiere comprar este mes, documentos.', close: 'Cerrar', cancel: 'Cancelar', saving: 'Procesando…', submit: 'Subir leads', inserted: 'Insertado', duplicate: 'Duplicado', invalid: 'Inválido', unnamed: 'Sin nombre', errors: { save: 'No se pudo procesar la carga', connection: 'Hubo un error de conexión' }, summary: (received: number, inserted: number, duplicates: number, invalid: number) => `${received} recibidos · ${inserted} insertados · ${duplicates} duplicados · ${invalid} inválidos`,
  } : {
    eyebrow: 'Lead ingestion', title: 'Bulk upload leads', help: 'One lead per line. Paste a natural-language summary without special separators.', inputLabel: 'Leads to process', placeholder: 'Ana Torres 3019876543 SUV, 2000 down, ID and bank account, wants to buy this month, proof of income', format: 'Example: Name phone vehicle, down, ID and bank account, wants to buy this month, documents.', close: 'Close', cancel: 'Cancel', saving: 'Processing…', submit: 'Upload leads', inserted: 'Inserted', duplicate: 'Duplicate', invalid: 'Invalid', unnamed: 'Unnamed', errors: { save: 'Unable to process the upload', connection: 'There was a connection error' }, summary: (received: number, inserted: number, duplicates: number, invalid: number) => `${received} received · ${inserted} inserted · ${duplicates} duplicates · ${invalid} invalid`,
  };
  const [text, setText] = useState('');
  const [result, setResult] = useState<BulkResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !loading) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, loading, onClose]);

  if (!isOpen) return null;
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setResult(null);
    if (isPortfolioMode) { setError(language === 'es' ? portfolioWriteBlockedMessage : 'Demo mode: this action is disabled to protect production data.'); return; }
    setLoading(true);
    try {
      const response = await fetch(`/api/dealers/${dealerId}/leads/bulk`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ text }) });
      const body: unknown = await response.json().catch(() => undefined);
      if (!response.ok) throw new Error(responseMessage(body, copy.errors.save));
      setResult(body as BulkResponse); onImported();
    } catch (submitError) { setError(submitError instanceof Error ? submitError.message : copy.errors.connection); }
    finally { setLoading(false); }
  }

  const statusLabel = (status: BulkRow['status']) => status === 'inserted' ? copy.inserted : status === 'duplicate' ? copy.duplicate : copy.invalid;
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm" role="presentation">
    <section role="dialog" aria-modal="true" aria-labelledby="bulk-lead-modal-title" className="max-h-[calc(100vh-2rem)] w-full max-w-3xl overflow-y-auto rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[0_24px_70px_rgba(19,32,29,0.22)] sm:p-6">
      <div className="mb-5 flex items-start justify-between gap-4 border-b border-[var(--border)] pb-4"><div><p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--brand)]">{copy.eyebrow}</p><h2 id="bulk-lead-modal-title" className="text-lg font-semibold text-[var(--text)]">{copy.title}</h2><p className="mt-1 text-xs text-[var(--text-muted)]">{copy.help}</p></div><button type="button" onClick={onClose} disabled={loading} aria-label={copy.close} className="rounded p-1 text-xl leading-none text-[var(--text-muted)] hover:bg-[var(--surface-raised)] disabled:opacity-50">×</button></div>
      {error && <div role="alert" className="mb-4 rounded border border-[var(--error)]/30 bg-[var(--error)]/10 px-3 py-2 text-sm text-[var(--error)]">{error}</div>}
      <form onSubmit={(event) => void submit(event)} className="space-y-4">
        <div><label htmlFor="bulk-lead-text" className="mb-1 block text-xs font-semibold text-[var(--text-muted)]">{copy.inputLabel}</label><textarea id="bulk-lead-text" required value={text} onChange={(event) => setText(event.target.value)} rows={8} placeholder={copy.placeholder} className="w-full resize-y rounded border border-[var(--border)] bg-[var(--page)] px-3 py-3 text-sm leading-6 text-[var(--text)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15" /></div>
        <p className="rounded border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-xs leading-5 text-[var(--text-muted)]">{copy.format}</p>
        <div className="flex items-center justify-end gap-3 border-t border-[var(--border)] pt-4"><button type="button" onClick={onClose} disabled={loading} className="min-h-11 rounded border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--text)] hover:bg-[var(--surface-raised)] disabled:opacity-50">{copy.cancel}</button><button type="submit" disabled={loading || !text.trim()} className="min-h-11 rounded bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--brand-strong)] disabled:opacity-50">{loading ? copy.saving : copy.submit}</button></div>
      </form>
      {result && <div className="mt-5 space-y-3" aria-live="polite"><div className="rounded border border-[var(--brand)]/30 bg-[var(--brand-soft)] px-3 py-3 text-sm font-semibold text-[var(--text)]">{copy.summary(result.summary.received, result.summary.inserted, result.summary.duplicates, result.summary.invalid)}</div><div className="max-h-64 space-y-2 overflow-y-auto">{result.rows.map((row) => <div key={row.rowNumber} className="rounded border border-[var(--border)] px-3 py-2 text-xs"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold">{row.rowNumber}. {row.name || copy.unnamed}</span><span className="rounded bg-[var(--surface-raised)] px-2 py-1 font-semibold">{statusLabel(row.status)}</span></div><div className="mt-1 tabular-nums text-[var(--text-muted)]">{row.phone}</div>{row.reason && <div className="mt-1 text-[var(--error)]">{row.reason}</div>}</div>)}</div></div>}
    </section>
  </div>;
}
