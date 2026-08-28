'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Logo } from '../../../components/ui/logo';

type Dealer = { id: string; code: string; name: string; pendingCount?: number };

function buildQuery(dealerId: string, from: string, to: string): string {
  const params = new URLSearchParams({ dealerId, from, to });
  return params.toString();
}

export default function ReportsPage() {
  const router = useRouter();
  const errorRef = useRef<HTMLParagraphElement>(null);
  const [dealers, setDealers] = useState<Dealer[]>([]);
  const [dealersLoading, setDealersLoading] = useState(true);
  const [selectedDealer, setSelectedDealer] = useState('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setDealersLoading(true);
    fetch('/api/dealers', { credentials: 'include', signal: controller.signal })
      .then(async (response) => {
        if (response.status === 401) {
          router.replace('/login');
          return null;
        }
        if (!response.ok) throw new Error('No se pudo cargar la lista de dealers.');
        return response.json() as Promise<Dealer[]>;
      })
      .then((data) => {
        if (data) setDealers(data);
      })
      .catch((loadError: unknown) => {
        if (loadError instanceof DOMException && loadError.name === 'AbortError') return;
        setError(loadError instanceof Error ? loadError.message : 'No se pudo cargar la lista de dealers.');
      })
      .finally(() => setDealersLoading(false));
    return () => controller.abort();
  }, [router]);

  const hasDates = Boolean(fromDate && toDate);
  const hasValidRange = hasDates && fromDate <= toDate;
  const rangeLabel = useMemo(() => {
    if (!hasValidRange) return '';
    return `${fromDate} a ${toDate}`;
  }, [fromDate, hasValidRange, toDate]);

  function resetPreview() {
    setPreviewCount(null);
    setError('');
  }

  function updateFromDate(value: string) {
    setFromDate(value);
    resetPreview();
  }

  function updateToDate(value: string) {
    setToDate(value);
    resetPreview();
  }

  async function handlePreview() {
    if (!hasDates) {
      setError('Selecciona las fechas Desde y Hasta.');
      window.requestAnimationFrame(() => errorRef.current?.focus());
      return;
    }
    if (!hasValidRange) {
      setError('La fecha Desde no puede ser posterior a la fecha Hasta.');
      window.requestAnimationFrame(() => errorRef.current?.focus());
      return;
    }

    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/reports/preview?${buildQuery(selectedDealer, fromDate, toDate)}`, { credentials: 'include' });
      if (response.status === 401) {
        router.replace('/login');
        return;
      }
      if (!response.ok) throw new Error('No se pudo consultar el rango seleccionado.');
      const data = await response.json() as { count: number };
      setPreviewCount(data.count);
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : 'No se pudo consultar el rango seleccionado.');
    } finally {
      setLoading(false);
    }
  }

  function handleDownload() {
    if (!hasValidRange) {
      setError(hasDates ? 'La fecha Desde no puede ser posterior a la fecha Hasta.' : 'Selecciona las fechas Desde y Hasta.');
      window.requestAnimationFrame(() => errorRef.current?.focus());
      return;
    }
    window.location.assign(`/api/reports/export?${buildQuery(selectedDealer, fromDate, toDate)}`);
  }

  return (
    <main className="min-h-screen bg-[var(--page)]">
      <header className="flex min-h-14 items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-3 sm:px-5">
        <div className="flex items-center gap-3">
          <Logo size={32} />
          <span className="text-[15px] font-semibold tracking-[-0.02em]">dealerADMIN</span>
        </div>
        <nav className="flex items-center gap-3 text-xs sm:gap-5" aria-label="Navegación principal">
          <Link href="/app" className="min-h-11 inline-flex items-center text-[var(--text-muted)] hover:text-[var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)]">Cola de leads</Link>
          <span className="hidden items-center gap-2 font-medium text-[var(--brand)] sm:flex"><span className="h-2 w-2 rounded-full bg-[var(--brand)]" aria-hidden="true" />Webhook activo</span>
        </nav>
      </header>

      <section className="mx-auto max-w-5xl px-3 py-6 sm:px-6 sm:py-9" aria-labelledby="reports-title">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--brand)]">Reportes / exportación</p>
            <h1 id="reports-title" className="text-2xl font-semibold tracking-[-0.035em] sm:text-3xl">Reportes de leads</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-muted)]">Consulta un rango y descarga un XLSX generado bajo demanda, sin crear archivos persistentes con datos sensibles.</p>
          </div>
          <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs text-[var(--text-muted)]">Procesamiento en memoria</span>
        </div>

        <div className="overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--surface)] shadow-[0_12px_32px_rgba(19,32,29,0.05)]">
          <div className="border-b border-[var(--border)] px-4 py-4 sm:px-6">
            <h2 className="text-base font-semibold">Define el rango del reporte</h2>
            <p className="mt-1 text-sm text-[var(--text-muted)]">El rango incluye todo el día seleccionado en Desde y Hasta.</p>
          </div>

          <div className="grid gap-4 px-4 py-5 sm:grid-cols-3 sm:px-6">
            <div>
              <label htmlFor="report-dealer" className="mb-2 block text-sm font-medium">Dealer</label>
              <select
                id="report-dealer"
                name="dealerId"
                value={selectedDealer}
                onChange={(event) => { setSelectedDealer(event.target.value); resetPreview(); }}
                disabled={dealersLoading}
                className="h-11 w-full rounded-[6px] border border-[var(--border)] bg-[var(--surface)] px-3 text-base text-[var(--text)] outline-none transition-[border-color,box-shadow] duration-150 focus:border-[var(--brand)] focus:ring-2 focus:ring-[color:var(--brand)]/20 disabled:cursor-not-allowed disabled:opacity-60 md:text-sm"
              >
                <option value="all">Todos los dealers</option>
                {dealers.map((dealer) => <option key={dealer.id} value={dealer.id}>{dealer.name}</option>)}
              </select>
              {dealersLoading && <p className="mt-2 text-xs text-[var(--text-muted)]" role="status">Cargando dealers…</p>}
            </div>

            <div>
              <label htmlFor="report-from" className="mb-2 block text-sm font-medium">Fecha Desde</label>
              <input id="report-from" name="from" type="date" value={fromDate} onChange={(event) => updateFromDate(event.target.value)} className="h-11 w-full rounded-[6px] border border-[var(--border)] bg-[var(--surface)] px-3 text-base text-[var(--text)] outline-none transition-[border-color,box-shadow] duration-150 focus:border-[var(--brand)] focus:ring-2 focus:ring-[color:var(--brand)]/20 md:text-sm" />
            </div>

            <div>
              <label htmlFor="report-to" className="mb-2 block text-sm font-medium">Fecha Hasta</label>
              <input id="report-to" name="to" type="date" value={toDate} min={fromDate || undefined} onChange={(event) => updateToDate(event.target.value)} aria-invalid={hasDates && !hasValidRange} aria-describedby="report-date-help" className="h-11 w-full rounded-[6px] border border-[var(--border)] bg-[var(--surface)] px-3 text-base text-[var(--text)] outline-none transition-[border-color,box-shadow] duration-150 focus:border-[var(--brand)] focus:ring-2 focus:ring-[color:var(--brand)]/20 aria-[invalid=true]:border-[var(--error)] md:text-sm" />
              <p id="report-date-help" className="mt-2 text-xs text-[var(--text-muted)]">Usa fechas del mismo rango de operación.</p>
            </div>
          </div>

          {error && <p ref={errorRef} tabIndex={-1} role="alert" className="mx-4 mb-4 border border-[var(--error)]/30 bg-[var(--error)]/10 px-4 py-3 text-sm leading-5 text-[var(--error)] sm:mx-6">{error}</p>}

          <div className="mx-4 mb-5 flex flex-col gap-4 rounded-[6px] border border-[var(--border)] bg-[var(--surface-raised)] p-4 sm:mx-6 sm:flex-row sm:items-center sm:justify-between">
            <div aria-live="polite" aria-busy={loading}>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Previsualización</p>
              {loading ? <p className="mt-1 text-sm text-[var(--text-muted)]">Consultando registros…</p> : previewCount !== null ? <p className="mt-1 text-sm text-[var(--text-muted)]">Se encontraron <strong className="tabular-nums text-lg text-[var(--text)]">{previewCount}</strong> registros{rangeLabel ? ` entre ${rangeLabel}` : ''}.</p> : <p className="mt-1 text-sm text-[var(--text-muted)]">Selecciona fechas para conocer el tamaño del archivo.</p>}
            </div>
            <button type="button" onClick={() => void handlePreview()} disabled={loading || !hasDates} className="min-h-11 rounded-[6px] border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-semibold text-[var(--text)] transition-[background-color,border-color,opacity] duration-150 hover:border-[var(--brand)] hover:bg-[var(--brand-soft)] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)]">{loading ? 'Consultando…' : 'Previsualizar conteo'}</button>
          </div>

          <div className="flex flex-col gap-3 border-t border-[var(--border)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <p className="text-xs leading-5 text-[var(--text-muted)]">El archivo tendrá tres pestañas: Resumen, Detalle y Errores.</p>
            <button type="button" onClick={handleDownload} disabled={!hasValidRange} className="min-h-11 rounded-[6px] bg-[var(--brand)] px-5 py-2 text-sm font-semibold text-white transition-[background-color,opacity,transform] duration-150 hover:bg-[var(--brand-strong)] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)]">Generar y descargar XLSX</button>
          </div>
        </div>
      </section>
    </main>
  );
}
