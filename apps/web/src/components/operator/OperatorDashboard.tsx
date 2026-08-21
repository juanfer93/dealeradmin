'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Logo } from '../ui/logo';

type LeadStatus = 'pending' | 'sent';
type Dealer = { id: string; code: string; name: string; pendingCount: number };
type Lead = {
  id: string; dealerId: string; dealerName: string; name: string; phone: string;
  vehicleType: string | null; downPayment: string | null; identification: string | null; bankAccount: string | null;
  documents: string | null; purchaseTimeline: string | null;
  status: LeadStatus; messageText: string; createdAt: string;
};
type LeadResponse = { dealers: Dealer[]; leads: Lead[] };

const emptyLabel: Record<'downPayment' | 'identification' | 'bankAccount' | 'documents' | 'purchaseTimeline', string> = {
  downPayment: 'down no indicado', identification: 'ID no indicado', bankAccount: 'cuenta bancaria no indicada',
  documents: 'documentos no indicados', purchaseTimeline: 'tiempo no indicado',
};

function EmptyValue({ field }: { field: keyof typeof emptyLabel }) {
  return <span className="inline-flex rounded bg-[var(--surface-raised)] px-2 py-1 text-xs text-[var(--text-muted)]">{emptyLabel[field]}</span>;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

function clean(value: string | null | undefined) {
  return value?.trim() ?? '';
}

function formatLeadMessage(lead: Lead) {
  const identity = [clean(lead.name), clean(lead.phone), clean(lead.vehicleType)].filter(Boolean).join(' ');
  const downValue = clean(lead.downPayment);
  const down = downValue ? `${downValue} de down` : '';
  const identificationValue = clean(lead.identification);
  const identification = identificationValue ? `ID ${identificationValue}` : '';
  const bankAccountValue = clean(lead.bankAccount);
  const bankAccount = bankAccountValue ? `cuenta bancaria ${bankAccountValue}` : '';
  const timelineValue = clean(lead.purchaseTimeline);
  const timeline = timelineValue ? `quiere comprar ${timelineValue.toLowerCase()}` : '';
  return [identity, down, identification, bankAccount, timeline].filter(Boolean).join(', ') + '.';
}

export default function OperatorDashboard() {
  const router = useRouter();
  const [dealers, setDealers] = useState<Dealer[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selectedDealerId, setSelectedDealerId] = useState('');
  const [status, setStatus] = useState<LeadStatus>('pending');
  const [copiedLeadId, setCopiedLeadId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadLeads = useCallback(async (nextStatus: LeadStatus, dealerId?: string) => {
    setLoading(true); setError('');
    const params = new URLSearchParams({ status: nextStatus });
    if (dealerId) params.set('dealerId', dealerId);
    try {
      const response = await fetch(`/api/leads?${params.toString()}`, { credentials: 'include' });
      if (response.status === 401) { router.replace('/login'); return; }
      if (!response.ok) throw new Error('Unable to load the operator queue.');
      const data = await response.json() as LeadResponse;
      setDealers(data.dealers); setLeads(data.leads);
      setSelectedDealerId((current) => current || data.dealers[0]?.id || '');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load the operator queue.');
    } finally { setLoading(false); }
  }, [router]);

  useEffect(() => {
    let active = true;
    fetch('/api/auth/session', { credentials: 'include' })
      .then((response) => response.json() as Promise<{ authenticated: boolean }>)
      .then(({ authenticated }) => {
        if (!active) return;
        if (!authenticated) { router.replace('/login'); return; }
        void loadLeads('pending');
      }).catch(() => router.replace('/login'));
    return () => { active = false; };
  }, [loadLeads, router]);

  const activeDealer = useMemo(() => dealers.find((dealer) => dealer.id === selectedDealerId) ?? dealers[0], [dealers, selectedDealerId]);

  async function selectDealer(dealerId: string) { setSelectedDealerId(dealerId); await loadLeads(status, dealerId); }
  async function selectStatus(nextStatus: LeadStatus) { setStatus(nextStatus); await loadLeads(nextStatus, selectedDealerId || undefined); }
  async function copyMessage(lead: Lead) {
    await navigator.clipboard.writeText(formatLeadMessage(lead)); setCopiedLeadId(lead.id);
    window.setTimeout(() => setCopiedLeadId((current) => current === lead.id ? null : current), 1600);
  }
  async function markSent(lead: Lead) {
    const response = await fetch(`/api/leads/${lead.id}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ status: 'sent' }) });
    if (!response.ok) { setError('The lead could not be marked as sent.'); return; }
    setLeads((current) => current.filter((item) => item.id !== lead.id));
    setDealers((current) => current.map((dealer) => dealer.id === lead.dealerId ? { ...dealer, pendingCount: Math.max(0, dealer.pendingCount - 1) } : dealer));
  }
  async function logout() { await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => undefined); router.replace('/login'); }

  return (
    <main className="min-h-screen bg-[var(--page)]">
      <header className="flex h-14 items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-3 sm:px-5">
        <div className="flex items-center gap-3"><Logo size={32} /><span className="text-[15px] font-semibold tracking-[-0.02em]">dealerADMIN</span></div>
        <div className="flex items-center gap-3 text-xs sm:gap-5"><span className="hidden items-center gap-2 font-medium text-[var(--brand)] sm:flex"><span className="h-2 w-2 rounded-full bg-[var(--brand)]" />Webhook: Active</span><button type="button" onClick={logout} className="text-[var(--text-muted)] hover:text-[var(--text)]">Log out</button></div>
      </header>
      <div className="flex min-h-[calc(100vh-56px)] flex-col md:flex-row">
        <aside className="w-full shrink-0 border-b border-[var(--border)] bg-[var(--surface-raised)] px-3 py-3 md:w-60 md:border-b-0 md:border-r md:py-5" aria-label="Dealer navigation">
          <div className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)] md:pb-3">Dealers</div>
          <nav className="flex gap-1 overflow-x-auto md:block md:space-y-1">
            {dealers.map((dealer) => { const active = dealer.id === (activeDealer?.id ?? selectedDealerId); return <button type="button" key={dealer.id} onClick={() => void selectDealer(dealer.id)} className={`flex min-w-[210px] items-center justify-between border-l-2 px-3 py-2.5 text-left text-sm transition-colors md:min-w-0 md:py-3 ${active ? 'border-[var(--brand)] bg-[var(--brand-soft)] font-semibold text-[var(--text)]' : 'border-transparent text-[var(--text-muted)] hover:bg-[var(--surface)] hover:text-[var(--text)]'}`}><span className="pr-2 leading-5">{dealer.name}</span><span className="tabular-nums rounded-full bg-[var(--surface)] px-2 py-0.5 text-xs text-[var(--text-muted)]">{dealer.pendingCount}</span></button>; })}
          </nav>
        </aside>
        <section className="min-w-0 flex-1 px-3 py-5 sm:px-6 sm:py-7 lg:px-9"><div className="mx-auto max-w-[1400px]">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4"><div><p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--brand)]">Operations / queue</p><h1 className="text-xl font-semibold tracking-[-0.035em] sm:text-2xl">Lead work queue</h1><p className="mt-2 text-sm text-[var(--text-muted)]">Review, prepare, and dispatch qualified leads.</p></div><div className="flex rounded border border-[var(--border)] bg-[var(--surface)] p-1" role="tablist" aria-label="Lead status filter">{(['pending', 'sent'] as LeadStatus[]).map((tab) => <button key={tab} type="button" role="tab" aria-selected={status === tab} onClick={() => void selectStatus(tab)} className={`rounded px-3 py-1.5 text-xs font-semibold capitalize ${status === tab ? 'bg-[var(--text)] text-[var(--surface)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`}>{tab === 'pending' ? 'Pending' : 'Sent'}</button>)}</div></div>
          {error && <div role="alert" className="mb-4 border border-[var(--error)]/30 bg-[var(--error)]/10 px-4 py-3 text-sm text-[var(--error)]">{error}</div>}
          <div className="overflow-hidden rounded border border-[var(--border)] bg-[var(--surface)]"><div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3 sm:px-5"><div className="flex items-center gap-3"><span className="text-sm font-semibold">{activeDealer?.name ?? 'All dealers'}</span><span className="text-xs text-[var(--text-muted)]">{leads.length} {status} {leads.length === 1 ? 'lead' : 'leads'}</span></div><span className="hidden text-xs text-[var(--text-muted)] sm:inline">Webhook stream <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-[var(--brand)]" /></span></div>
            <div className="space-y-3 p-3 md:hidden">
              {loading && <p className="px-2 py-8 text-center text-sm text-[var(--text-muted)]">Loading queue…</p>}
              {!loading && leads.length === 0 && <p className="px-2 py-8 text-center text-sm text-[var(--text-muted)]">No {status} leads in this queue.</p>}
              {leads.map((lead) => <article key={lead.id} className="rounded border border-[var(--border)] bg-[var(--page)] p-4"><div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold">{lead.name}</h2><p className="mt-1 tabular-nums text-xs text-[var(--text-muted)]">{lead.phone}</p></div><span className="text-xs text-[var(--text-muted)]">{formatDate(lead.createdAt)}</span></div><p className="mt-3 text-sm font-medium">{lead.vehicleType || 'Vehicle not indicated'}</p><div className="mt-3 flex flex-wrap gap-1.5">{lead.downPayment ? <span className="rounded bg-[var(--brand-soft)] px-2 py-1 text-xs">{lead.downPayment}</span> : <EmptyValue field="downPayment" />}{lead.identification ? <span className="rounded bg-[var(--brand-soft)] px-2 py-1 text-xs">ID {lead.identification}</span> : <EmptyValue field="identification" />}{lead.bankAccount ? <span className="rounded bg-[var(--brand-soft)] px-2 py-1 text-xs">cuenta {lead.bankAccount}</span> : <EmptyValue field="bankAccount" />}</div><p className="mt-3 text-xs leading-5 text-[var(--text-muted)]">{formatLeadMessage(lead)}</p><div className="mt-4 flex gap-2"><button type="button" onClick={() => void copyMessage(lead)} className="flex-1 rounded border border-[var(--border)] px-3 py-2 text-xs font-semibold">{copiedLeadId === lead.id ? '¡Copiado!' : 'Copiar'}</button>{status === 'pending' && <button type="button" onClick={() => void markSent(lead)} className="flex-1 rounded bg-[var(--brand)] px-3 py-2 text-xs font-semibold text-white">Marcar enviado</button>}</div></article>)}
            </div>
            <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[920px] text-left text-sm"><thead className="bg-[var(--surface-raised)] text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]"><tr><th className="px-5 py-3">Lead</th><th className="px-5 py-3">Vehicle</th><th className="px-5 py-3">Qualification</th><th className="px-5 py-3">Received</th><th className="px-5 py-3 text-right">Actions</th></tr></thead><tbody className="divide-y divide-[var(--border)]">
              {!loading && leads.length === 0 && <tr><td colSpan={5} className="px-5 py-16 text-center text-sm text-[var(--text-muted)]">No {status} leads in this queue.</td></tr>}
              {loading && <tr><td colSpan={5} className="px-5 py-16 text-center text-sm text-[var(--text-muted)]">Loading queue…</td></tr>}
              {leads.map((lead) => <tr key={lead.id} className="align-top transition-colors hover:bg-[var(--brand-soft)]/40"><td className="px-5 py-4"><div className="font-semibold">{lead.name}</div><div className="mt-1 tabular-nums text-xs text-[var(--text-muted)]">{lead.phone}</div><div className="mt-3 max-w-[240px] text-xs leading-5 text-[var(--text-muted)]">{formatLeadMessage(lead)}</div></td><td className="px-5 py-4"><div className="font-medium">{lead.vehicleType || 'Vehicle not indicated'}</div><div className="mt-2 text-xs text-[var(--text-muted)]">{lead.dealerName}</div></td><td className="px-5 py-4"><div className="flex max-w-[260px] flex-wrap gap-1.5">{lead.downPayment ? <span className="rounded bg-[var(--brand-soft)] px-2 py-1 text-xs">{lead.downPayment}</span> : <EmptyValue field="downPayment" />}{lead.identification ? <span className="rounded bg-[var(--brand-soft)] px-2 py-1 text-xs">ID {lead.identification}</span> : <EmptyValue field="identification" />}{lead.bankAccount ? <span className="rounded bg-[var(--brand-soft)] px-2 py-1 text-xs">cuenta {lead.bankAccount}</span> : <EmptyValue field="bankAccount" />}{lead.documents ? <span className="rounded bg-[var(--brand-soft)] px-2 py-1 text-xs">{lead.documents}</span> : <EmptyValue field="documents" />}{lead.purchaseTimeline ? <span className="rounded bg-[var(--brand-soft)] px-2 py-1 text-xs">{lead.purchaseTimeline}</span> : <EmptyValue field="purchaseTimeline" />}</div></td><td className="whitespace-nowrap px-5 py-4 text-xs tabular-nums text-[var(--text-muted)]">{formatDate(lead.createdAt)}</td><td className="px-5 py-4"><div className="flex justify-end gap-2"><button type="button" onClick={() => void copyMessage(lead)} className="rounded border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text)] hover:border-[var(--brand)]">{copiedLeadId === lead.id ? '¡Copiado!' : 'Copiar'}</button>{status === 'pending' && <button type="button" onClick={() => void markSent(lead)} className="rounded bg-[var(--brand)] px-3 py-2 text-xs font-semibold text-white hover:bg-[var(--brand-strong)]">Marcar enviado</button>}</div></td></tr>)}
            </tbody></table></div>
          </div>
        </div></section>
      </div>
    </main>
  );
}
