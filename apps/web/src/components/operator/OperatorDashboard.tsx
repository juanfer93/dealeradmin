'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Logo } from '../ui/logo';
import { AddLeadModal, type EditableLead } from './AddLeadModal';
import { BulkLeadModal } from './BulkLeadModal';
import { ReassignDropdown } from './ReassignDropdown';
import { CopyLeadDropdown } from './CopyLeadDropdown';
import { getPortfolioLeadResponse, isPortfolioMode, portfolioWriteBlockedMessage } from '../../lib/portfolio-mode';
import { LanguageSwitch, useLanguage } from '../../lib/i18n';
import { selectInitialQueueLeads } from './queue-selection';

type LeadStatus = 'pending' | 'sent';
type Dealer = { id: string; code: string; name: string; pendingCount: number };
type Lead = { id: string; dealerId: string; dealerName: string; name: string; phone: string; vehicleType: string | null; downPayment: string | null; vehicleCategory?: string | null; requiredDownPayment?: number | null; downPaymentAmount?: number | null; previousFinancing?: 'yes' | 'no' | '' | null; downPaymentSufficient?: boolean | null; qualificationStep?: string | null; identification: string | null; bankAccount: string | null; documents: string | null; purchaseTimeline: string | null; status: LeadStatus; messageText: string; createdAt: string };
type LeadResponse = { dealers: Dealer[]; leads: Lead[] };

function clean(value: string | null | undefined) { return value?.trim() ?? ''; }

function isNoDownPayment(value: string | null | undefined): boolean {
  return /^(?:no\s+down(?:\s+payment)?|no\s+tengo\s+down(?:\s+payment)?|sin\s+enganche|no\s+enganche)$/i.test(clean(value));
}

const IDENTIFICATION_DOCUMENT_PATTERN = 'id\\b|identification\\b|identificación\\b|driver.?s license\\b|license\\b|licencia\\b|itin\\b|passport\\b|pasaporte\\b';
const INCOME_DOCUMENT_PATTERN = 'proof of income|income proof|prueba de ingresos|comprobante de ingresos|estados? de cuenta|account statements?|bank statements?|financial statements?|pay stubs?|check stubs?|talones? de pago|colillas? de cheques?|recibos? de n[oó]mina';
const POSITIVE_DOCUMENT_VALUE = 'yes|sí|si|true|yeah|yep|correct|tengo|have it|i do|i have|available';
const NEGATIVE_DOCUMENT_VALUE = 'no|n[oó]|false|not available|not indicated|not specified|no indicado|no especificado|sin|dont|don\'t|no tengo|i do not|do not have|don\'t have';

type DocumentStatus = 'yes' | 'no' | '';

function valueStatus(value: string): DocumentStatus {
  const normalized = clean(value);
  if (!normalized) return '';
  if (new RegExp(`^\\s*(?:${NEGATIVE_DOCUMENT_VALUE})\\s*$`, 'i').test(normalized)) return 'no';
  if (new RegExp(`^\\s*(?:${POSITIVE_DOCUMENT_VALUE})\\s*$`, 'i').test(normalized)) return 'yes';
  return '';
}

function documentStatus(value: string | null, fieldPattern: string): DocumentStatus {
  const source = clean(value);
  if (!source) return '';

  const labeled = source.match(new RegExp(`(?:^|[;,])\\s*(?:${fieldPattern})\\s*[:=]\\s*([^;,]+)`, 'i'))?.[1];
  const labeledStatus = labeled ? valueStatus(labeled) : '';
  if (labeledStatus) return labeledStatus;

  const field = new RegExp(fieldPattern, 'i');
  const match = field.exec(source);
  if (!match || match.index === undefined) return '';
  const context = source.slice(Math.max(0, match.index - 90), Math.min(source.length, match.index + match[0].length + 90));
  if (new RegExp(`(?:${NEGATIVE_DOCUMENT_VALUE})[^;,|\\n]{0,90}(?:${fieldPattern})|(?:${fieldPattern})[^;,|\\n]{0,90}(?:${NEGATIVE_DOCUMENT_VALUE})`, 'i').test(context)) return 'no';
  if (new RegExp(`(?:${POSITIVE_DOCUMENT_VALUE})[^;,|\\n]{0,90}(?:${fieldPattern})|(?:${fieldPattern})[^;,|\\n]{0,90}(?:${POSITIVE_DOCUMENT_VALUE})`, 'i').test(context)) return 'yes';
  return 'yes';
}

function remainingDocumentText(value: string | null): string {
  return clean(value)
    .split(/[;,]/)
    .map((part) => part.trim())
    .filter((part) => part && !new RegExp(`^(?:${IDENTIFICATION_DOCUMENT_PATTERN}|${INCOME_DOCUMENT_PATTERN})\\s*[:=]`, 'i').test(part))
    .join(', ');
}

export function formatQualificationLabels(lead: Pick<Lead, 'identification' | 'documents'>, language: 'es' | 'en') {
  const documentIdentification = documentStatus(lead.documents, IDENTIFICATION_DOCUMENT_PATTERN);
  const documentIncome = documentStatus(lead.documents, INCOME_DOCUMENT_PATTERN);
  const identificationStatus = documentIdentification || valueStatus(lead.identification ?? '') || (clean(lead.identification) ? 'yes' : '');
  const incomeStatus = documentIncome;
  const hasIdentification = identificationStatus === 'yes';
  const hasIncome = incomeStatus === 'yes';
  const incomeLabel = language === 'es' ? 'prueba de ingresos' : 'proof of income';
  const combinedLabel = language === 'es' ? 'ID y prueba de ingresos' : 'ID and proof of income';
  const identificationValue = clean(lead.identification);
  const identificationLabel = identificationValue && !/^yes$/i.test(identificationValue) ? `ID: ${identificationValue}` : 'ID';
  const identification = hasIdentification && hasIncome
    ? ''
    : hasIdentification
      ? identificationLabel
      : valueStatus(lead.identification ?? '') === 'no'
        ? ''
        : clean(lead.identification)
          ? `ID: ${clean(lead.identification)}`
          : '';
  const documents = hasIdentification && hasIncome
    ? combinedLabel
    : hasIncome
      ? incomeLabel
      : remainingDocumentText(lead.documents);

  return { identification, documents };
}

function detectLeadLanguage(lead: Lead): 'es' | 'en' {
  const text = [lead.vehicleType, lead.downPayment, lead.identification, lead.bankAccount, lead.documents, lead.purchaseTimeline].filter(Boolean).join(' ').toLowerCase();
  if (/\bquiere\s+comprar\b/i.test(text)) return 'es';
  if (/\bwants?\s+to\s+buy\b/i.test(text)) return 'en';
  const englishSignals = [' and ', 'wants', 'buy', 'week', 'proof', 'income', 'truck', 'cash', 'bank account', 'today', 'month', 'next'];
  const spanishSignals = ['quiere', 'comprar', 'semana', 'prueba', 'ingreso', 'camioneta', 'cuenta', 'documento', 'hoy', 'mes', 'este', 'esta'];
  return englishSignals.filter((signal) => text.includes(signal)).length > spanishSignals.filter((signal) => text.includes(signal)).length ? 'en' : 'es';
}

function formatBankAccountLabel(value: string | null, language: 'es' | 'en'): string {
  const normalized = clean(value);
  if (!normalized || valueStatus(normalized) === 'no') return '';
  const label = language === 'es' ? 'cuenta bancaria' : 'bank account';
  if (valueStatus(normalized) === 'yes' || /^(?:bank account|cuenta bancaria|cuenta de banco)$/i.test(normalized)) return label;
  return `${label} ${normalized}`;
}

export function formatPurchaseTimelineLabel(value: string | null, language: 'es' | 'en'): string {
  const normalized = clean(value);
  if (!normalized) return '';
  if (/^(?:quiere\s+ver\s+opciones|wants?\s+to\s+see\s+options)$/i.test(normalized)) {
    return language === 'es' ? 'Quiere ver opciones' : 'wants to see options';
  }
  const sourceLanguage = /\bquiere\s+comprar\b/i.test(normalized) ? 'es' : /\bwants?\s+to\s+buy\b/i.test(normalized) ? 'en' : language;
  const source = normalized.replace(/\b(?:quiere\s+comprar|wants?\s+to\s+buy)\b/gi, '').trim().toLowerCase();
  if (/^(?:solo\s+estoy\s+|estoy\s+solo\s+|just\s+|only\s+)?(?:mirando|observando|viendo|explorando|browsing|looking|checking)\s+(?:options?|opciones)$/i.test(source)) {
    return sourceLanguage === 'es' ? 'Quiere ver opciones' : 'wants to see options';
  }
  const localized = /^(?:today|hoy|now|ahora|asap|as soon as possible|lo m[aá]s pronto posible|lo antes posible)$/i.test(source)
    ? (sourceLanguage === 'es' ? 'lo más pronto posible' : 'asap')
    : /^(?:this|esta)\s+(?:week|semana)$/i.test(source)
      ? (sourceLanguage === 'es' ? 'esta semana' : 'this week')
      : /^(?:next|pr[oó]xima?|siguiente)\s+(?:week|semana)$/i.test(source)
        ? (sourceLanguage === 'es' ? 'próxima semana' : 'next week')
        : /^(?:this|este|esta)\s+(?:month|mes)$/i.test(source)
          ? (sourceLanguage === 'es' ? 'este mes' : 'this month')
          : /^(?:next|pr[oó]ximo?|siguiente)\s+(?:month|mes)$/i.test(source)
            ? (sourceLanguage === 'es' ? 'próximo mes' : 'next month')
            : source;
  return sourceLanguage === 'es' ? `quiere comprar ${localized}` : `wants to buy ${localized}`;
}

function formatVehicleCategory(value: string | null | undefined, language: 'es' | 'en'): string {
  const labels: Record<string, string> = language === 'es'
    ? { sedan: 'Sedán', luxury_sedan: 'Sedán de lujo', suv_or_van: 'SUV o van', truck: 'Troca o camión' }
    : { sedan: 'Sedan', luxury_sedan: 'Luxury sedan', suv_or_van: 'SUV or van', truck: 'Truck' };
  return value ? labels[value] ?? value : '';
}

function formatQualificationStep(value: string | null | undefined, language: 'es' | 'en'): string {
  const labels: Record<string, string> = language === 'es'
    ? { real_name: 'nombre', vehicle_type: 'vehículo', phone: 'teléfono', down_payment: 'down payment', purchase_timeline: 'tiempo de compra', documents: 'documentos', bank_account: 'cuenta bancaria', complete: 'completo' }
    : { real_name: 'name', vehicle_type: 'vehicle', phone: 'phone', down_payment: 'down payment', purchase_timeline: 'purchase timing', documents: 'documents', bank_account: 'bank account', complete: 'complete' };
  return value ? labels[value] ?? value : '';
}

export function formatLeadMessage(lead: Lead, language?: 'es' | 'en') {
  const resolvedLanguage = language ?? detectLeadLanguage(lead);
  const identity = [clean(lead.name), clean(lead.phone), clean(lead.vehicleType)].filter(Boolean).join(' ');
  const downValue = clean(lead.downPayment);
  const down = downValue && !isNoDownPayment(downValue) ? (resolvedLanguage === 'es' ? `${downValue} de down` : `${downValue} down`) : '';
  const previousFinancing = lead.previousFinancing === 'yes'
    && lead.downPaymentAmount != null
    && lead.requiredDownPayment != null
    && lead.downPaymentAmount < lead.requiredDownPayment
    ? (resolvedLanguage === 'es' ? 'Ya ha financiado antes' : 'Has financed before')
    : '';
  const qualificationLabels = formatQualificationLabels(lead, resolvedLanguage);
  const identification = qualificationLabels.identification;
  const bank = formatBankAccountLabel(lead.bankAccount, resolvedLanguage);
  const documents = qualificationLabels.documents;
  const timeline = formatPurchaseTimelineLabel(lead.purchaseTimeline, resolvedLanguage);
  return [identity, down, previousFinancing, identification, bank, documents, timeline].filter(Boolean).join(', ') + '.';
}

function formatDate(value: string, language: 'es' | 'en') {
  return new Intl.DateTimeFormat(language === 'es' ? 'es-CO' : 'en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

export function dealerIdentity(name: string): { group: string; location: string } {
  const normalized = name.trim();
  if (/^arlington motors of woodbridge$/i.test(normalized)) {
    return { group: 'Arlington Motors of Woodbridge', location: 'Woodbridge' };
  }
  if (/^easterns\b/i.test(normalized)) {
    return { group: 'Easterns Automotive Group', location: normalized.replace(/^easterns\s*/i, '') || normalized };
  }
  if (/^koons\b/i.test(normalized)) {
    const location = normalized.match(/\b(?:of|de)\s+(.+)$/i)?.[1] ?? normalized;
    return { group: normalized, location };
  }
  return { group: 'Offlease Motors', location: normalized.replace(/^offlease(?:\s+motors)?\s*/i, '') || normalized };
}

function Qualification({ lead, language, empty }: { lead: Lead; language: 'es' | 'en'; empty: Record<string, string> }) {
  const evidence = (label: string, value: string | null) => {
    const normalized = clean(value);
    if (!normalized) return '';
    return /^yes$/i.test(normalized) ? label : `${label} ${normalized}`;
  };
  const labels = formatQualificationLabels(lead, language);
  const identification = labels.identification || (labels.documents ? '' : evidence('ID', lead.identification));
  const bankAccount = formatBankAccountLabel(lead.bankAccount, language);
  const documents = labels.documents;
  const tag = (value: string, fallback: string) => value ? <span className="rounded bg-[var(--brand-soft)] px-2 py-1 text-xs">{value}</span> : <span className="rounded bg-[var(--surface-raised)] px-2 py-1 text-xs text-[var(--text-muted)]">{fallback}</span>;
  const category = formatVehicleCategory(lead.vehicleCategory, language);
  const minimum = lead.requiredDownPayment != null ? `$${lead.requiredDownPayment.toLocaleString('en-US')}` : '';
  const downRule = lead.downPaymentSufficient == null
    ? ''
    : lead.downPaymentSufficient
      ? (language === 'es' ? 'suficiente' : 'meets minimum')
      : (language === 'es' ? 'insuficiente' : 'below minimum');
  const step = formatQualificationStep(lead.qualificationStep, language);
  const previousFinancing = lead.previousFinancing === 'yes'
    && lead.downPaymentAmount != null
    && lead.requiredDownPayment != null
    && lead.downPaymentAmount < lead.requiredDownPayment
    ? (language === 'es' ? 'Ya ha financiado antes' : 'Has financed before')
    : '';
  return <div className="space-y-2"><div className="flex max-w-[300px] flex-wrap gap-1.5">{tag(lead.downPayment && !isNoDownPayment(lead.downPayment) ? lead.downPayment : '', empty.downPayment)}{previousFinancing && tag(previousFinancing, '')}{tag(identification, empty.identification)}{tag(bankAccount, empty.bankAccount)}{tag(documents, empty.documents)}{tag(formatPurchaseTimelineLabel(lead.purchaseTimeline, language).replace(/^(?:quiere comprar|wants to buy)\s+/i, ''), empty.purchaseTimeline)}</div>{(category || minimum || downRule || step) && <div className="max-w-[340px] rounded border border-[var(--border)] bg-[var(--surface-raised)] px-2.5 py-2 text-[11px] leading-5 text-[var(--text-muted)]"><span className="font-semibold text-[var(--text)]">{language === 'es' ? 'Normalizado' : 'Normalized'}</span>{category && <span className="ml-2">{language === 'es' ? 'categoría' : 'category'}: {category}</span>}{minimum && <span className="ml-2">{language === 'es' ? 'mínimo' : 'minimum'}: {minimum}</span>}{downRule && <span className={`ml-2 font-semibold ${lead.downPaymentSufficient ? 'text-[var(--brand-strong)]' : 'text-[var(--error)]'}`}>{downRule}</span>}{step && <span className="ml-2">{language === 'es' ? 'paso' : 'step'}: {step}</span>}</div>}</div>;
}

export default function OperatorDashboard() {
  const router = useRouter();
  const { language, t } = useLanguage();
  const [dealers, setDealers] = useState<Dealer[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selectedDealerId, setSelectedDealerId] = useState('');
  const [selectedDealerIds, setSelectedDealerIds] = useState<string[]>([]);
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([]);
  const [status, setStatus] = useState<LeadStatus>('pending');
  const [copiedLeadId, setCopiedLeadId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isAddLeadOpen, setIsAddLeadOpen] = useState(false);
  const [editingLead, setEditingLead] = useState<EditableLead | null>(null);
  const [isBulkLeadOpen, setIsBulkLeadOpen] = useState(false);
  const [deletingLeadId, setDeletingLeadId] = useState<string | null>(null);
  const [leadPendingDelete, setLeadPendingDelete] = useState<Lead | null>(null);
  const [deletingSelected, setDeletingSelected] = useState(false);
  const [leadPendingBulkDelete, setLeadPendingBulkDelete] = useState<number | null>(null);
  const [copyingLeadId, setCopyingLeadId] = useState<string | null>(null);
  const [leadPendingCopy, setLeadPendingCopy] = useState<{ lead: Lead; targetDealer: Dealer } | null>(null);

  const loadLeads = useCallback(async (nextStatus: LeadStatus, dealerId?: string, dealerIds?: string[]) => {
    setLoading(true); setError('');
    const params = new URLSearchParams({ status: nextStatus });
    if (dealerId) params.set('dealerId', dealerId);
    if (dealerIds?.length) params.set('dealerIds', dealerIds.join(','));
    try {
      let data: LeadResponse;
      if (isPortfolioMode) data = getPortfolioLeadResponse(nextStatus, dealerId, dealerIds);
      else {
        const response = await fetch(`/api/leads?${params.toString()}`, { credentials: 'include' });
        if (response.status === 401) { router.replace('/login'); return; }
        if (!response.ok) throw new Error(t.app.errors.loadQueue);
        data = await response.json() as LeadResponse;
      }
      setDealers(data.dealers); setLeads(selectInitialQueueLeads(data.leads, data.dealers, dealerId, dealerIds)); setSelectedLeadIds([]);
      setSelectedDealerId((current) => current || data.dealers[0]?.id || '');
      setSelectedDealerIds((current) => current.length ? current : (data.dealers[0]?.id ? [data.dealers[0].id] : []));
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : t.app.errors.loadQueue); }
    finally { setLoading(false); }
  }, [router, t]);

  useEffect(() => {
    if (isPortfolioMode) { void loadLeads('pending'); return undefined; }
    let active = true;
    fetch('/api/auth/session', { credentials: 'include' }).then((response) => response.json() as Promise<{ authenticated: boolean }>).then(({ authenticated }) => { if (!active) return; if (!authenticated) { router.replace('/login'); return; } void loadLeads('pending'); }).catch(() => router.replace('/login'));
    return () => { active = false; };
  }, [loadLeads, router]);

  useEffect(() => {
    if (isPortfolioMode) return undefined;
    const interval = window.setInterval(() => {
      const multipleDealers = selectedDealerIds.length > 1;
      void loadLeads(status, multipleDealers ? undefined : selectedDealerId || undefined, multipleDealers ? selectedDealerIds : undefined);
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [loadLeads, selectedDealerId, selectedDealerIds, status]);

  const activeDealer = useMemo(() => dealers.find((dealer) => dealer.id === selectedDealerId) ?? dealers[0], [dealers, selectedDealerId]);
  const selectedVisibleLeadIds = useMemo(() => selectedLeadIds.filter((id) => leads.some((lead) => lead.id === id)), [leads, selectedLeadIds]);
  const allVisibleLeadsSelected = leads.length > 0 && selectedVisibleLeadIds.length === leads.length;

  async function selectDealer(dealerId: string) { setSelectedDealerId(dealerId); setSelectedDealerIds([dealerId]); await loadLeads(status, dealerId); }
  async function toggleDealer(dealerId: string) { const next = selectedDealerIds.includes(dealerId) ? selectedDealerIds.filter((id) => id !== dealerId) : [...selectedDealerIds, dealerId]; setSelectedDealerIds(next); setSelectedDealerId(next[0] || ''); await loadLeads(status, undefined, next); }
  async function selectStatus(nextStatus: LeadStatus) { setStatus(nextStatus); await loadLeads(nextStatus, selectedDealerId || undefined); }
  async function refreshQueue() { await loadLeads(status, selectedDealerIds.length > 1 ? undefined : selectedDealerId || undefined, selectedDealerIds.length > 1 ? selectedDealerIds : undefined); }
  async function copyMessage(lead: Lead) { await navigator.clipboard.writeText(lead.messageText || formatLeadMessage(lead)); setCopiedLeadId(lead.id); window.setTimeout(() => setCopiedLeadId((current) => current === lead.id ? null : current), 1600); }
  async function copyAllSelected() { if (!leads.length) return; await navigator.clipboard.writeText(leads.map((lead) => lead.messageText || formatLeadMessage(lead)).join('\n')); setCopiedLeadId('__all__'); window.setTimeout(() => setCopiedLeadId((current) => current === '__all__' ? null : current), 1600); }
  async function copySelectedLeads() { const selected = leads.filter((lead) => selectedLeadIds.includes(lead.id)); if (!selected.length) return; await navigator.clipboard.writeText(selected.map((lead) => lead.messageText || formatLeadMessage(lead)).join('\n')); setCopiedLeadId('__selected__'); window.setTimeout(() => setCopiedLeadId((current) => current === '__selected__' ? null : current), 1600); }
  function toggleLead(leadId: string) { setSelectedLeadIds((current) => current.includes(leadId) ? current.filter((id) => id !== leadId) : [...current, leadId]); }
  function toggleAllVisibleLeads() { setSelectedLeadIds((current) => allVisibleLeadsSelected ? current.filter((id) => !leads.some((lead) => lead.id === id)) : Array.from(new Set([...current, ...leads.map((lead) => lead.id)]))); }
  async function copyDealerLeads(dealerId: string) {
    try {
      const payloads = isPortfolioMode ? (['pending', 'sent'] as LeadStatus[]).map((item) => getPortfolioLeadResponse(item, dealerId)) : await Promise.all((['pending', 'sent'] as LeadStatus[]).map(async (item) => { const response = await fetch(`/api/leads?status=${item}&dealerId=${dealerId}`, { credentials: 'include' }); if (response.status === 401) { router.replace('/login'); return null; } if (!response.ok) throw new Error(t.app.errors.loadDealerLeads); return response.json() as Promise<LeadResponse>; }));
      const validPayloads = payloads.filter((payload): payload is LeadResponse => payload !== null);
      if (!validPayloads.length) return;
      const dealerLeads = validPayloads.flatMap((payload) => payload.leads);
      if (!dealerLeads.length) { setError(t.app.errors.noLeadsToCopy); return; }
      await navigator.clipboard.writeText(dealerLeads.map((lead) => lead.messageText || formatLeadMessage(lead)).join('\n')); const key = `dealer-${dealerId}`; setCopiedLeadId(key); window.setTimeout(() => setCopiedLeadId((current) => current === key ? null : current), 1600);
    } catch (copyError) { setError(copyError instanceof Error ? copyError.message : t.app.errors.copyFailed); }
  }
  async function markSent(lead: Lead) { if (isPortfolioMode) { setError(language === 'es' ? portfolioWriteBlockedMessage : 'Demo mode: this action is disabled to protect production data.'); return; } const response = await fetch(`/api/leads/${lead.id}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ status: 'sent', dealerId: lead.dealerId }) }); if (!response.ok) { setError(t.app.errors.markSent); return; } setLeads((current) => current.filter((item) => item.id !== lead.id)); setSelectedLeadIds((current) => current.filter((id) => id !== lead.id)); setDealers((current) => current.map((dealer) => dealer.id === lead.dealerId ? { ...dealer, pendingCount: Math.max(0, dealer.pendingCount - 1) } : dealer)); }
  function deleteLead(lead: Lead) {
    if (isPortfolioMode) { setError(language === 'es' ? portfolioWriteBlockedMessage : 'Demo mode: this action is disabled to protect production data.'); return; }
    if (lead.status !== 'pending') return;
    setLeadPendingDelete(lead);
  }
  function deleteSelectedLeads() {
    if (isPortfolioMode) { setError(language === 'es' ? portfolioWriteBlockedMessage : 'Demo mode: this action is disabled to protect production data.'); return; }
    if (!selectedVisibleLeadIds.length) return;
    if (leads.some((lead) => selectedVisibleLeadIds.includes(lead.id) && lead.status !== 'pending')) return;
    setError('');
    setLeadPendingBulkDelete(selectedVisibleLeadIds.length);
  }
  function editLead(lead: Lead) {
    if (isPortfolioMode) { setError(language === 'es' ? portfolioWriteBlockedMessage : 'Demo mode: this action is disabled to protect production data.'); return; }
    setError('');
    setEditingLead(lead);
  }
  async function confirmDeleteLead() {
    const lead = leadPendingDelete;
    if (!lead) return;
    setDeletingLeadId(lead.id); setError('');
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(`/api/leads/${lead.id}?dealerId=${encodeURIComponent(lead.dealerId)}`, { method: 'DELETE', credentials: 'include', signal: controller.signal });
      if (response.status === 401) { router.replace('/login'); return; }
      if (!response.ok) {
        let message: string = t.app.errors.deleteLead;
        try {
          const payload = await response.json() as { message?: string | string[] };
          if (typeof payload.message === 'string') message = payload.message;
          else if (Array.isArray(payload.message)) message = payload.message.join(', ');
        } catch { /* Keep the translated fallback when the API has no JSON body. */ }
        throw new Error(message);
      }
      setLeads((current) => current.filter((item) => item.id !== lead.id));
      setSelectedLeadIds((current) => current.filter((id) => id !== lead.id));
      if (lead.status === 'pending') setDealers((current) => current.map((dealer) => dealer.id === lead.dealerId ? { ...dealer, pendingCount: Math.max(0, dealer.pendingCount - 1) } : dealer));
      setLeadPendingDelete(null);
      await refreshQueue();
    } catch (deleteError) { setError(deleteError instanceof DOMException && deleteError.name === 'AbortError' ? t.app.errors.deleteLeadTimeout : deleteError instanceof Error ? deleteError.message : t.app.errors.deleteLead); }
    finally { window.clearTimeout(timeout); setDeletingLeadId(null); }
  }
  async function confirmDeleteSelectedLeads() {
    const selected = leads.filter((lead) => selectedVisibleLeadIds.includes(lead.id));
    if (!selected.length) return;
    setDeletingSelected(true); setError('');
    try {
      const response = await fetch('/api/leads', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ items: selected.map((lead) => ({ leadId: lead.id, dealerId: lead.dealerId })) }),
      });
      if (response.status === 401) { router.replace('/login'); return; }
      if (!response.ok) {
        let message: string = t.app.errors.deleteLead;
        try {
          const payload = await response.json() as { message?: string | string[] };
          if (typeof payload.message === 'string') message = payload.message;
          else if (Array.isArray(payload.message)) message = payload.message.join(', ');
        } catch { /* Keep the translated fallback when the API has no JSON body. */ }
        throw new Error(message);
      }
      setLeadPendingBulkDelete(null);
      setSelectedLeadIds((current) => current.filter((id) => !selected.some((lead) => lead.id === id)));
      await refreshQueue();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : t.app.errors.deleteLead);
    } finally {
      setDeletingSelected(false);
    }
  }
  function requestCopyLead(lead: Lead, targetDealerId: string) {
    if (isPortfolioMode) { setError(language === 'es' ? portfolioWriteBlockedMessage : 'Demo mode: this action is disabled to protect production data.'); return; }
    const targetDealer = dealers.find((dealer) => dealer.id === targetDealerId);
    if (!targetDealer || targetDealer.id === lead.dealerId) return;
    setError(''); setLeadPendingCopy({ lead, targetDealer });
  }
  async function confirmCopyLead() {
    const pendingCopy = leadPendingCopy;
    if (!pendingCopy) return;
    setCopyingLeadId(pendingCopy.lead.id); setError('');
    try {
      const response = await fetch(`/api/leads/${encodeURIComponent(pendingCopy.lead.id)}/copy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ sourceDealerId: pendingCopy.lead.dealerId, targetDealerId: pendingCopy.targetDealer.id }),
      });
      if (!response.ok) {
        let message: string = t.app.errors.copyLead;
        try {
          const payload = await response.json() as { message?: string | string[] };
          if (typeof payload.message === 'string') message = payload.message;
          else if (Array.isArray(payload.message)) message = payload.message.join(', ');
        } catch { /* Keep the translated fallback when the API has no JSON body. */ }
        throw new Error(message);
      }
      setLeadPendingCopy(null);
      await refreshQueue();
    } catch (copyError) { setError(copyError instanceof Error ? copyError.message : t.app.errors.copyLead); }
    finally { setCopyingLeadId(null); }
  }
  async function logout() { if (!isPortfolioMode) await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => undefined); router.replace(isPortfolioMode ? '/' : '/login'); }

  const statusLabel = status === 'pending' ? t.app.pending.toLowerCase() : t.app.sent.toLowerCase();
  return <main className="operator-shell min-h-screen bg-[var(--page)]">
    <header className="flex h-16 items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-3 sm:px-5"><div className="flex items-center gap-3"><Logo size={32} /><span className="text-[15px] font-semibold tracking-[-0.02em]">dealerADMIN</span></div><div className="flex items-center gap-3 text-xs sm:gap-5"><Link href="/app/reports" className="min-h-11 inline-flex items-center text-[var(--text-muted)] hover:text-[var(--text)]">{t.app.reports}</Link><Link href="/app/problems" className="min-h-11 inline-flex items-center text-[var(--text-muted)] hover:text-[var(--text)]">{t.app.problems}</Link><span className="hidden items-center gap-2 font-medium text-[var(--brand)] sm:flex"><span className="h-2 w-2 rounded-full bg-[var(--brand)]" />{t.app.webhook}</span><LanguageSwitch /><button type="button" onClick={logout} className="min-h-11 text-[var(--text-muted)] hover:text-[var(--text)]">{t.app.logout}</button></div></header>
    <div className="border-b border-[var(--border)] bg-[var(--surface)] px-3 py-3 sm:px-5">
      <div className="mx-auto flex max-w-[1400px] items-center gap-3" aria-live="polite" aria-label={language === 'es' ? 'Dealer activo' : 'Active dealer'}>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--brand-soft)] text-xs font-bold text-[var(--brand)]" aria-hidden="true">D</span>
        <div className="min-w-0">
          <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">{language === 'es' ? 'Dealer activo' : 'Active dealer'}</span>
          {activeDealer ? <span className="block truncate text-sm font-semibold text-[var(--text)]">{activeDealer.name}</span> : <span className="text-sm text-[var(--text-muted)]">{language === 'es' ? 'Selecciona un dealer' : 'Select a dealer'}</span>}
        </div>
      </div>
    </div>
    <div className="operator-layout flex min-h-[calc(100vh-56px)] flex-col md:flex-row">
      <aside className="w-full shrink-0 border-b border-[var(--border)] bg-[var(--surface-raised)] px-3 py-3 md:w-60 md:border-b-0 md:border-r md:py-5" aria-label={t.app.dealerNavigation}><div className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)] md:pb-3">{t.app.dealers}</div><nav className="flex gap-1 overflow-x-auto md:block md:space-y-1">{dealers.map((dealer) => { const active = dealer.id === (activeDealer?.id ?? selectedDealerId); const checked = selectedDealerIds.includes(dealer.id); const copied = copiedLeadId === `dealer-${dealer.id}`; return <div key={dealer.id} className={`flex min-w-[270px] items-center gap-2 border-l-2 px-2 py-1 md:min-w-0 ${active ? 'border-[var(--brand)] bg-[var(--brand-soft)]' : 'border-transparent'}`}><input type="checkbox" checked={checked} onChange={() => void toggleDealer(dealer.id)} aria-label={`${t.app.dealers}: ${dealer.name}`} className="h-4 w-4 accent-[var(--brand)]" /><button type="button" onClick={() => void selectDealer(dealer.id)} className={`flex min-h-11 min-w-0 flex-1 items-center justify-between px-1 text-left text-sm ${active ? 'font-semibold text-[var(--text)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`}><span className="truncate pr-2 leading-5">{dealer.name}</span><span className="tabular-nums rounded-full bg-[var(--surface)] px-2 py-0.5 text-xs text-[var(--text-muted)]">{dealer.pendingCount}</span></button><button type="button" onClick={() => void copyDealerLeads(dealer.id)} aria-label={`${t.app.copyAll} ${dealer.name}`} className="min-h-11 shrink-0 rounded border border-[var(--border)] px-2 text-[11px] font-semibold text-[var(--text-muted)] hover:border-[var(--brand)] hover:text-[var(--text)]">{copied ? 'Listo' : t.app.copy}</button></div>; })}</nav></aside>
      <section className="min-w-0 flex-1 px-3 py-5 sm:px-6 sm:py-7 lg:px-9"><div className="mx-auto max-w-[1400px]"><div className="mb-6 flex flex-wrap items-end justify-between gap-4"><div><p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--brand)]">{t.app.eyebrow}</p><h1 className="text-xl font-semibold tracking-[-0.035em] sm:text-2xl">{t.app.title}</h1><p className="mt-2 text-sm text-[var(--text-muted)]">{t.app.description}</p>{isPortfolioMode && <p className="mt-3 inline-flex rounded-full border border-[var(--review)]/40 bg-[var(--review)]/10 px-3 py-1.5 text-xs font-semibold text-[var(--review)]">{t.app.portfolioPreview}</p>}</div><div className="flex rounded border border-[var(--border)] bg-[var(--surface)] p-1" role="tablist" aria-label={t.app.statusFilter}>{(['pending', 'sent'] as LeadStatus[]).map((tab) => <button key={tab} type="button" role="tab" aria-selected={status === tab} onClick={() => void selectStatus(tab)} className={`rounded px-3 py-1.5 text-xs font-semibold capitalize ${status === tab ? 'bg-[var(--text)] text-[var(--surface)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`}>{tab === 'pending' ? t.app.pending : t.app.sent}</button>)}</div></div>{error && <div role="alert" className="mb-4 border border-[var(--error)]/30 bg-[var(--error)]/10 px-4 py-3 text-sm text-[var(--error)]">{error}</div>}
        <div className="overflow-hidden rounded border border-[var(--border)] bg-[var(--surface)]"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3 sm:px-5"><div className="flex items-center gap-3"><span className="text-sm font-semibold">{selectedDealerIds.length > 1 ? t.app.selectedDealers(selectedDealerIds.length) : activeDealer?.name ?? t.app.allDealers}</span><span className="text-xs text-[var(--text-muted)]">{t.app.leadCount(leads.length, statusLabel)}</span></div><div className="flex flex-wrap items-center gap-2"><span className="hidden text-xs text-[var(--text-muted)] sm:inline">{t.app.webhookStream} <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-[var(--brand)]" /></span>{leads.length > 0 && <label className="inline-flex min-h-11 items-center gap-2 rounded border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text-muted)]"><input type="checkbox" checked={allVisibleLeadsSelected} onChange={toggleAllVisibleLeads} aria-label={t.app.selectAll} className="h-4 w-4 accent-[var(--brand)]" /><span>{t.app.selected(selectedVisibleLeadIds.length)}</span></label>}{selectedVisibleLeadIds.length > 0 && <><button type="button" onClick={() => void copySelectedLeads()} className="min-h-11 rounded border border-[var(--border)] px-3 py-2 text-xs font-semibold hover:border-[var(--brand)]">{copiedLeadId === '__selected__' ? t.app.selectedCopied : t.app.copySelected}</button><button type="button" onClick={deleteSelectedLeads} disabled={deletingSelected} className="min-h-11 rounded border border-[var(--error)]/45 px-3 py-2 text-xs font-semibold text-[var(--error)] hover:bg-[var(--error)]/10 disabled:opacity-60">{deletingSelected ? t.app.deletingSelected : t.app.deleteSelected}</button></>}{selectedDealerIds.length > 1 && <button type="button" onClick={() => void copyAllSelected()} disabled={!leads.length} className="min-h-11 rounded border border-[var(--border)] px-3 py-2 text-xs font-semibold hover:border-[var(--brand)] disabled:opacity-50">{copiedLeadId === '__all__' ? t.app.allCopied : t.app.copyAll}</button>}<button type="button" id="btn-add-manual-lead" onClick={() => setIsAddLeadOpen(true)} disabled={!activeDealer} className="min-h-11 rounded bg-[var(--brand)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{t.app.addManual}</button><button type="button" id="btn-bulk-leads" onClick={() => setIsBulkLeadOpen(true)} disabled={!activeDealer} className="min-h-11 rounded border border-[var(--brand)] px-3 py-2 text-xs font-semibold text-[var(--brand)] disabled:opacity-50">{language === 'es' ? 'Carga masiva' : 'Bulk upload'}</button></div></div>
          <div className="space-y-3 p-3 md:hidden">{loading && <p className="px-2 py-8 text-center text-sm text-[var(--text-muted)]">{t.app.loading}</p>}{!loading && leads.length === 0 && <p className="px-2 py-8 text-center text-sm text-[var(--text-muted)]">{t.app.noLeads(statusLabel)}</p>}{leads.map((lead) => <article key={lead.id} className="rounded border border-[var(--border)] bg-[var(--page)] p-4"><div className="flex items-start justify-between gap-3"><div className="flex items-start gap-3"><input type="checkbox" checked={selectedLeadIds.includes(lead.id)} onChange={() => toggleLead(lead.id)} aria-label={`${t.app.lead} ${lead.name}`} className="mt-1 h-4 w-4 accent-[var(--brand)]" /><div><h2 className="font-semibold">{lead.name}</h2><p className="mt-1 tabular-nums text-xs text-[var(--text-muted)]">{lead.phone}</p></div></div><span className="text-right text-xs text-[var(--text-muted)]"><span className="block text-[10px] uppercase tracking-[0.08em]">{t.app.received}</span>{formatDate(lead.createdAt, language)}</span></div><p className="mt-3 text-sm font-medium">{lead.vehicleType || t.app.vehicleNotIndicated}</p><div className="mt-3"><Qualification lead={lead} language={language} empty={t.app.empty} /></div><p className="mt-3 text-xs leading-5 text-[var(--text-muted)]">{lead.messageText || formatLeadMessage(lead)}</p><div className="mt-4 flex flex-wrap gap-2"><CopyLeadDropdown leadId={lead.id} currentDealerId={lead.dealerId} dealers={dealers} disabled={copyingLeadId === lead.id} label={t.app.copyTo} chooseLabel={t.app.copyTo} onRequestCopy={(targetDealerId) => requestCopyLead(lead, targetDealerId)} /><ReassignDropdown leadId={lead.id} currentDealerId={lead.dealerId} onReassigned={refreshQueue} /><button type="button" onClick={() => editLead(lead)} className="min-h-11 flex-1 rounded border border-[var(--brand)]/45 px-3 py-2 text-xs font-semibold text-[var(--brand-strong)]" aria-label={`${t.app.editLead}: ${lead.name}`}>{t.app.editLead}</button><button type="button" onClick={() => void copyMessage(lead)} className="min-h-11 flex-1 rounded border border-[var(--border)] px-3 py-2 text-xs font-semibold">{copiedLeadId === lead.id ? t.app.copied : t.app.copy}</button>{status === 'pending' && <button type="button" onClick={() => void markSent(lead)} className="min-h-11 flex-1 rounded bg-[var(--brand)] px-3 py-2 text-xs font-semibold text-white">{language === 'es' ? 'Marcar enviado' : 'Mark sent'}</button>}<button type="button" onClick={() => void deleteLead(lead)} disabled={deletingLeadId === lead.id} className="min-h-11 flex-1 rounded border border-[var(--error)]/40 px-3 py-2 text-xs font-semibold text-[var(--error)] hover:bg-[var(--error)]/10 disabled:opacity-60">{deletingLeadId === lead.id ? t.app.deletingLead : t.app.deleteLead}</button></div></article>)}</div>
          <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[920px] text-left text-sm"><thead className="bg-[var(--surface-raised)] text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]"><tr><th className="px-5 py-3">{t.app.lead}</th><th className="px-5 py-3">{t.app.vehicle}</th><th className="px-5 py-3">{t.app.qualification}</th><th className="px-5 py-3">{t.app.receivedColumn}</th><th className="px-5 py-3 text-right">{t.app.actions}</th></tr></thead><tbody className="divide-y divide-[var(--border)]">{!loading && leads.length === 0 && <tr><td colSpan={5} className="px-5 py-16 text-center text-sm text-[var(--text-muted)]">{t.app.noLeads(statusLabel)}</td></tr>}{loading && <tr><td colSpan={5} className="px-5 py-16 text-center text-sm text-[var(--text-muted)]">{t.app.loading}</td></tr>}{leads.map((lead) => <tr key={lead.id} className="align-top transition-colors hover:bg-[var(--brand-soft)]/40"><td className="px-5 py-4"><div className="flex items-start gap-3"><input type="checkbox" checked={selectedLeadIds.includes(lead.id)} onChange={() => toggleLead(lead.id)} aria-label={`${t.app.lead} ${lead.name}`} className="mt-1 h-4 w-4 accent-[var(--brand)]" /><div><div className="font-semibold">{lead.name}</div><div className="mt-1 tabular-nums text-xs text-[var(--text-muted)]">{lead.phone}</div><div className="mt-3 max-w-[240px] text-xs leading-5 text-[var(--text-muted)]">{lead.messageText || formatLeadMessage(lead)}</div></div></div></td><td className="px-5 py-4"><div className="font-medium">{lead.vehicleType || t.app.vehicleNotIndicated}</div><div className="mt-2 text-xs text-[var(--text-muted)]">{lead.dealerName}</div></td><td className="px-5 py-4"><Qualification lead={lead} language={language} empty={t.app.empty} /></td><td className="whitespace-nowrap px-5 py-4 text-xs tabular-nums text-[var(--text-muted)]"><span className="mb-1 block text-[10px] uppercase tracking-[0.08em]">{t.app.received}</span>{formatDate(lead.createdAt, language)}</td><td className="px-5 py-4"><div className="flex flex-wrap justify-end gap-2"><CopyLeadDropdown leadId={lead.id} currentDealerId={lead.dealerId} dealers={dealers} disabled={copyingLeadId === lead.id} label={t.app.copyTo} chooseLabel={t.app.copyTo} onRequestCopy={(targetDealerId) => requestCopyLead(lead, targetDealerId)} /><ReassignDropdown leadId={lead.id} currentDealerId={lead.dealerId} onReassigned={refreshQueue} /><button type="button" onClick={() => editLead(lead)} className="min-h-11 rounded border border-[var(--brand)]/45 px-3 py-2 text-xs font-semibold text-[var(--brand-strong)]" aria-label={`${t.app.editLead}: ${lead.name}`} title={t.app.editLead}>✎ <span className="sr-only">{t.app.editLead}</span></button><button type="button" onClick={() => void copyMessage(lead)} className="min-h-11 rounded border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text)]">{copiedLeadId === lead.id ? t.app.copied : t.app.copy}</button>{status === 'pending' && <button type="button" onClick={() => void markSent(lead)} className="min-h-11 rounded bg-[var(--brand)] px-3 py-2 text-xs font-semibold text-white">{language === 'es' ? 'Marcar enviado' : 'Mark sent'}</button>}<button type="button" onClick={() => void deleteLead(lead)} disabled={deletingLeadId === lead.id} className="min-h-11 rounded border border-[var(--error)]/40 px-3 py-2 text-xs font-semibold text-[var(--error)] hover:bg-[var(--error)]/10 disabled:opacity-60">{deletingLeadId === lead.id ? t.app.deletingLead : t.app.deleteLead}</button></div></td></tr>)}</tbody></table></div></div>
          <AddLeadModal isOpen={isAddLeadOpen || Boolean(editingLead)} onClose={() => { setIsAddLeadOpen(false); setEditingLead(null); }} dealerId={editingLead?.dealerId ?? activeDealer?.id ?? ''} editingLead={editingLead} onLeadAdded={() => void loadLeads(status, activeDealer?.id)} onLeadUpdated={() => void refreshQueue()} />
          <BulkLeadModal isOpen={isBulkLeadOpen} onClose={() => setIsBulkLeadOpen(false)} dealerId={activeDealer?.id ?? ''} onImported={() => void loadLeads(status, activeDealer?.id)} />
          {leadPendingDelete && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4" role="presentation">
            <section role="dialog" aria-modal="true" aria-labelledby="delete-lead-title" aria-describedby="delete-lead-description" className="w-full max-w-md rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[0_24px_70px_rgba(18,32,24,0.24)] sm:p-6">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--error)]/10 text-[var(--error)]" aria-hidden="true"><svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.3 4.7 2.9 18a2 2 0 0 0 1.7 3h14.8a2 2 0 0 0 1.7-3L13.7 4.7a2 2 0 0 0-3.4 0Z" /></svg></span>
                <div><h2 id="delete-lead-title" className="text-base font-semibold tracking-[-0.02em]">{t.app.deleteWarningTitle}</h2><p id="delete-lead-description" className="mt-2 text-sm leading-6 text-[var(--text-muted)]">{t.app.deleteWarningBody(leadPendingDelete.name)}</p></div>
              </div>
              <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={() => setLeadPendingDelete(null)} disabled={deletingLeadId === leadPendingDelete.id} className="min-h-11 rounded border border-[var(--border)] px-4 py-2 text-xs font-semibold text-[var(--text)] hover:border-[var(--text-muted)] disabled:opacity-60">{t.app.cancelDelete}</button><button type="button" onClick={() => void confirmDeleteLead()} disabled={deletingLeadId === leadPendingDelete.id} className="min-h-11 rounded bg-[var(--error)] px-4 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60">{deletingLeadId === leadPendingDelete.id ? t.app.deletingLead : t.app.confirmDelete}</button></div>
            </section>
          </div>}
          {leadPendingBulkDelete !== null && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4" role="presentation">
            <section role="dialog" aria-modal="true" aria-labelledby="bulk-delete-lead-title" aria-describedby="bulk-delete-lead-description" onKeyDown={(event) => { if (event.key === 'Escape' && !deletingSelected) setLeadPendingBulkDelete(null); }} className="w-full max-w-md rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[0_24px_70px_rgba(18,32,24,0.24)] sm:p-6">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--error)]/10 text-[var(--error)]" aria-hidden="true"><svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.3 4.7 2.9 18a2 2 0 0 0 1.7 3h14.8a2 2 0 0 0 1.7 3L13.7 4.7a2 2 0 0 0-3.4 0Z" /></svg></span>
                <div><h2 id="bulk-delete-lead-title" className="text-base font-semibold tracking-[-0.02em]">{t.app.bulkDeleteWarningTitle}</h2><p id="bulk-delete-lead-description" className="mt-2 text-sm leading-6 text-[var(--text-muted)]">{t.app.bulkDeleteWarningBody(leadPendingBulkDelete)}</p></div>
              </div>
              <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" autoFocus onClick={() => setLeadPendingBulkDelete(null)} disabled={deletingSelected} className="min-h-11 rounded border border-[var(--border)] px-4 py-2 text-xs font-semibold text-[var(--text)] hover:border-[var(--text-muted)] disabled:opacity-60">{t.app.cancelDelete}</button><button type="button" onClick={() => void confirmDeleteSelectedLeads()} disabled={deletingSelected} className="min-h-11 rounded bg-[var(--error)] px-4 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60">{deletingSelected ? t.app.deletingSelected : t.app.confirmBulkDelete}</button></div>
            </section>
          </div>}
          {leadPendingCopy && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4" role="presentation">
            <section role="dialog" aria-modal="true" aria-labelledby="copy-lead-title" aria-describedby="copy-lead-description" className="w-full max-w-md rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[0_24px_70px_rgba(18,32,24,0.24)] sm:p-6">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--brand-soft)] text-[var(--brand)]" aria-hidden="true"><svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="2"><rect x="9" y="9" width="11" height="11" rx="2" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3" /></svg></span>
                <div><h2 id="copy-lead-title" className="text-base font-semibold tracking-[-0.02em]">{t.app.copyLeadTitle}</h2><p id="copy-lead-description" className="mt-2 text-sm leading-6 text-[var(--text-muted)]">{t.app.copyLeadBody(leadPendingCopy.lead.name, leadPendingCopy.lead.dealerName, leadPendingCopy.targetDealer.name)}</p><p className="mt-3 text-xs leading-5 text-[var(--text-muted)]">{t.app.copyLeadDuplicateHint}</p></div>
              </div>
              <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={() => setLeadPendingCopy(null)} disabled={copyingLeadId === leadPendingCopy.lead.id} className="min-h-11 rounded border border-[var(--border)] px-4 py-2 text-xs font-semibold text-[var(--text)] hover:border-[var(--text-muted)] disabled:opacity-60">{t.app.cancelCopy}</button><button type="button" onClick={() => void confirmCopyLead()} disabled={copyingLeadId === leadPendingCopy.lead.id} className="min-h-11 rounded bg-[var(--brand)] px-4 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60">{copyingLeadId === leadPendingCopy.lead.id ? t.app.copyingLead : t.app.confirmCopy}</button></div>
            </section>
          </div>}
        </div></section>
    </div>
  </main>;
}
