'use client';

import React from 'react';

export type QueueStatus = 'pending' | 'wrote_again' | 'sent';

type QueueTabsProps = {
  status: QueueStatus;
  wroteAgainCount: number;
  labels: { pending: string; wroteAgain: string; sent: string; ariaLabel: string };
  onChange: (status: QueueStatus) => void;
};

export function QueueTabs({ status, wroteAgainCount, labels, onChange }: QueueTabsProps) {
  const tabs: Array<{ value: QueueStatus; label: string }> = [
    { value: 'pending', label: labels.pending },
    { value: 'wrote_again', label: labels.wroteAgain },
    { value: 'sent', label: labels.sent },
  ];
  const hasAlert = wroteAgainCount > 0;

  return (
    <div className="flex flex-wrap rounded border border-[var(--border)] bg-[var(--surface)] p-1" role="tablist" aria-label={labels.ariaLabel}>
      {tabs.map((tab) => {
        const active = status === tab.value;
        const reengagementTab = tab.value === 'wrote_again';
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.value)}
            className={`relative rounded px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]/30 ${
              reengagementTab && hasAlert
                ? 'bg-[#FEF2F2] text-[#B91C1C] ring-1 ring-inset ring-[#EF4444]/35 hover:bg-[#FEE2E2]'
                : active
                  ? 'bg-[var(--text)] text-[var(--surface)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text)]'
            }`}
          >
            {tab.label}
            {reengagementTab && hasAlert && <span className="ml-2 inline-flex min-w-5 items-center justify-center rounded-full bg-[#EF4444] px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-white">{wroteAgainCount}</span>}
          </button>
        );
      })}
    </div>
  );
}
