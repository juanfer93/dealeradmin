'use client';

import { useCallback, useEffect, useState } from 'react';
import { getSession } from '../../infrastructure/auth/auth-api';
import { getLeads } from '../../infrastructure/operator/operator-api';
import { getPortfolioLeadResponse, isPortfolioMode } from '../../infrastructure/portfolio/portfolio-repository';
import { selectInitialQueueLeads } from '../../domain/leads/queue-selection';
import type { Dealer, Lead, LeadResponse, LeadStatus } from '../../domain/leads/lead.types';

type UseOperatorQueueOptions = {
  onUnauthorized: () => void;
  loadErrorMessage: string;
  formatLead: (lead: Lead) => string;
};

export function useOperatorQueue({ onUnauthorized, loadErrorMessage, formatLead }: UseOperatorQueueOptions) {
  const [dealers, setDealers] = useState<Dealer[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selectedDealerId, setSelectedDealerId] = useState('');
  const [selectedDealerIds, setSelectedDealerIds] = useState<string[]>([]);
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([]);
  const [status, setStatus] = useState<LeadStatus>('pending');
  const [wroteAgainCount, setWroteAgainCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sessionStatus, setSessionStatus] = useState<'checking' | 'authenticated'>(isPortfolioMode ? 'authenticated' : 'checking');

  const loadLeads = useCallback(async (nextStatus: LeadStatus, dealerId?: string, dealerIds?: string[]) => {
    setLoading(true);
    setError('');
    try {
      let data: LeadResponse;
      if (isPortfolioMode) {
        data = getPortfolioLeadResponse(nextStatus, dealerId, dealerIds);
      } else {
        const response = await getLeads(nextStatus, dealerId, dealerIds);
        if (response.status === 401) {
          onUnauthorized();
          return;
        }
        if (!response.ok) throw new Error(loadErrorMessage);
        data = await response.json() as LeadResponse;
      }
      const displayLeads = data.leads.map((lead) => ({ ...lead, messageText: formatLead(lead) }));
      setDealers(data.dealers);
      setLeads(selectInitialQueueLeads(displayLeads, data.dealers, dealerId, dealerIds));
      setWroteAgainCount(data.wroteAgainCount ?? 0);
      setSelectedLeadIds([]);
      setSelectedDealerId((current) => current || data.dealers[0]?.id || '');
      setSelectedDealerIds((current) => current.length ? current : (data.dealers[0]?.id ? [data.dealers[0].id] : []));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : loadErrorMessage);
    } finally {
      setLoading(false);
    }
  }, [formatLead, loadErrorMessage, onUnauthorized]);

  useEffect(() => {
    if (isPortfolioMode) {
      void loadLeads('pending');
      return undefined;
    }
    let active = true;
    getSession()
      .then((response) => response.json() as Promise<{ authenticated: boolean }>)
      .then(({ authenticated }) => {
        if (!active) return;
        if (!authenticated) {
          onUnauthorized();
          return;
        }
        setSessionStatus('authenticated');
        void loadLeads('pending');
      })
      .catch(() => onUnauthorized());
    return () => { active = false; };
  }, [loadLeads, onUnauthorized]);

  useEffect(() => {
    if (isPortfolioMode || sessionStatus !== 'authenticated') return undefined;
    const interval = window.setInterval(() => {
      const multipleDealers = selectedDealerIds.length > 1;
      void loadLeads(status, multipleDealers ? undefined : selectedDealerId || undefined, multipleDealers ? selectedDealerIds : undefined);
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [loadLeads, selectedDealerId, selectedDealerIds, sessionStatus, status]);

  async function selectDealer(dealerId: string) {
    setSelectedDealerId(dealerId);
    setSelectedDealerIds([dealerId]);
    await loadLeads(status, dealerId);
  }

  async function toggleDealer(dealerId: string) {
    const next = selectedDealerIds.includes(dealerId) ? selectedDealerIds.filter((id) => id !== dealerId) : [...selectedDealerIds, dealerId];
    setSelectedDealerIds(next);
    setSelectedDealerId(next[0] || '');
    await loadLeads(status, undefined, next);
  }

  async function selectStatus(nextStatus: LeadStatus) {
    setStatus(nextStatus);
    await loadLeads(nextStatus, selectedDealerId || undefined);
  }

  async function refreshQueue() {
    await loadLeads(status, selectedDealerIds.length > 1 ? undefined : selectedDealerId || undefined, selectedDealerIds.length > 1 ? selectedDealerIds : undefined);
  }

  return {
    dealers, setDealers,
    leads, setLeads,
    selectedDealerId, setSelectedDealerId,
    selectedDealerIds, setSelectedDealerIds,
    selectedLeadIds, setSelectedLeadIds,
    status, setStatus,
    wroteAgainCount, setWroteAgainCount,
    loading, error, setError,
    sessionStatus,
    loadLeads, selectDealer, toggleDealer, selectStatus, refreshQueue,
  };
}
