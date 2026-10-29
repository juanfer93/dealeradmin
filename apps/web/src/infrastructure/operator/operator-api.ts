import { apiFetch } from '../http/api-client';
import type { LeadStatus } from '../../domain/leads/lead.types';

export function getLeads(status: LeadStatus, dealerId?: string, dealerIds?: string[]) {
  const params = new URLSearchParams({ status });
  if (dealerId) params.set('dealerId', dealerId);
  if (dealerIds?.length) params.set('dealerIds', dealerIds.join(','));
  return apiFetch(`/api/leads?${params.toString()}`);
}

export function getDealerLeads(status: LeadStatus, dealerId: string) {
  return apiFetch(`/api/leads?status=${status}&dealerId=${dealerId}`);
}

export function markLeadSent(leadId: string, dealerId: string) {
  return apiFetch(`/api/leads/${leadId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'sent', dealerId }),
  });
}

export function deleteLead(leadId: string, dealerId: string, signal?: AbortSignal) {
  return apiFetch(`/api/leads/${encodeURIComponent(leadId)}/purge?dealerId=${encodeURIComponent(dealerId)}`, { method: 'DELETE', signal });
}

export function deleteLeads(items: Array<{ leadId: string; dealerId: string }>) {
  return apiFetch('/api/leads/purge', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  });
}

export function copyLead(leadId: string, sourceDealerId: string, targetDealerId: string) {
  return apiFetch(`/api/leads/${encodeURIComponent(leadId)}/copy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourceDealerId, targetDealerId }),
  });
}
