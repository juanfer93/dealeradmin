'use client';

import { useState } from 'react';

const EASTERN_DEALERS = [
  { id: 'd1111111-1111-1111-1111-111111111111', name: 'Rosedale' },
  { id: 'd2222222-2222-2222-2222-222222222222', name: 'Laurel' },
  { id: 'd3333333-3333-3333-3333-333333333333', name: 'Sterling' },
] as const;

type ReassignDropdownProps = {
  leadId: string;
  currentDealerId: string;
  onReassigned: () => Promise<void> | void;
};

export function ReassignDropdown({ leadId, currentDealerId, onReassigned }: ReassignDropdownProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const options = EASTERN_DEALERS.filter((dealer) => dealer.id !== currentDealerId);
  if (!EASTERN_DEALERS.some((dealer) => dealer.id === currentDealerId)) return null;

  async function handleChange(targetDealerId: string) {
    if (!targetDealerId) return;
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/leads/${leadId}/reassign`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ currentDealerId, targetDealerId }),
      });
      if (!response.ok) throw new Error('No se pudo reasignar el lead.');
      await onReassigned();
    } catch (reassignError) {
      setError(reassignError instanceof Error ? reassignError.message : 'No se pudo reasignar el lead.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-w-[132px] items-center gap-1.5">
      <label className="sr-only" htmlFor={`reassign-${leadId}`}>Reasignar lead</label>
      <select
        id={`reassign-${leadId}`}
        aria-label="Reasignar lead"
        defaultValue=""
        disabled={loading}
        onChange={(event) => void handleChange(event.target.value)}
        className="min-h-11 rounded border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--text-muted)] hover:text-[var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] disabled:opacity-60"
      >
        <option value="" disabled>{loading ? 'Guardando…' : 'Reasignar…'}</option>
        {options.map((dealer) => <option key={dealer.id} value={dealer.id}>{dealer.name}</option>)}
      </select>
      {error && <span role="alert" className="sr-only">{error}</span>}
    </div>
  );
}
