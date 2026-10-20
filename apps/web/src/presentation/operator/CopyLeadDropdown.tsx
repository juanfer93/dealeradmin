'use client';

import React from 'react';

type CopyDealer = { id: string; name: string };
type ReengagementLanguage = 'es' | 'en';

type CopyLeadDropdownProps = {
  leadId: string;
  currentDealerId: string;
  dealers: CopyDealer[];
  disabled?: boolean;
  label: string;
  chooseLabel: string;
  onRequestCopy: (targetDealerId: string) => void;
  reengagementPhone?: string;
  reengagementName?: string;
  copyContactLabel?: string;
  contactCopied?: boolean;
  onCopyContact?: () => void;
};

export function formatReengagedContact(name: string, phone: string, reengagementCount = 1, language: ReengagementLanguage = 'es'): string {
  const label = language === 'en'
    ? (reengagementCount >= 3 ? 'writes insistently' : 'writes again')
    : (reengagementCount >= 3 ? 'escribe de forma insistente' : 'volvio a escribir');
  const contactName = name.trim() || 'Contacto';
  return `*${contactName} ${phone} ${label}*`;
}

export function CopyLeadDropdown({
  leadId,
  currentDealerId,
  dealers,
  disabled = false,
  label,
  chooseLabel,
  onRequestCopy,
  reengagementPhone,
  reengagementName,
  copyContactLabel,
  contactCopied = false,
  onCopyContact,
}: CopyLeadDropdownProps) {
  const targetDealers = dealers.filter((dealer) => dealer.id !== currentDealerId);

  return (
    <div className="flex min-w-[150px] flex-wrap gap-2">
      {reengagementPhone && reengagementName && onCopyContact && <button type="button" onClick={onCopyContact} className="min-h-11 rounded border border-[#F97316]/45 bg-[#FFF7ED] px-3 py-2 text-xs font-semibold text-[#C2410C] hover:bg-[#FFEDD5]">{contactCopied ? 'Copiado' : copyContactLabel ?? 'Copiar contacto'}</button>}
      <label htmlFor={`copy-lead-${leadId}`} className="sr-only">{label}</label>
      <select
        id={`copy-lead-${leadId}`}
        aria-label={label}
        defaultValue=""
        disabled={disabled || targetDealers.length === 0}
        onChange={(event) => {
          const targetDealerId = event.currentTarget.value;
          event.currentTarget.value = '';
          if (targetDealerId) onRequestCopy(targetDealerId);
        }}
        className="min-h-11 w-full rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-semibold text-[var(--text)] outline-none transition-colors hover:border-[var(--brand)] focus-visible:border-[var(--brand)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]/20 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <option value="" disabled>{chooseLabel}</option>
        {targetDealers.map((dealer) => <option key={dealer.id} value={dealer.id}>{dealer.name}</option>)}
      </select>
    </div>
  );
}
