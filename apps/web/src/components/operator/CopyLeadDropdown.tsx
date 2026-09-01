'use client';

import React from 'react';

type CopyDealer = { id: string; name: string };

type CopyLeadDropdownProps = {
  leadId: string;
  currentDealerId: string;
  dealers: CopyDealer[];
  disabled?: boolean;
  label: string;
  chooseLabel: string;
  onRequestCopy: (targetDealerId: string) => void;
};

export function CopyLeadDropdown({
  leadId,
  currentDealerId,
  dealers,
  disabled = false,
  label,
  chooseLabel,
  onRequestCopy,
}: CopyLeadDropdownProps) {
  const targetDealers = dealers.filter((dealer) => dealer.id !== currentDealerId);

  return (
    <div className="min-w-[150px]">
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
