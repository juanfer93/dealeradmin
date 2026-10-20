import { apiFetch } from '../http/api-client';

export function updateLead(leadId: string, body: unknown) {
  return apiFetch(`/api/leads/${leadId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function createLead(dealerId: string, body: unknown) {
  return apiFetch(`/api/dealers/${dealerId}/leads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function importLeads(dealerId: string, text: string) {
  return apiFetch(`/api/dealers/${dealerId}/leads/bulk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
}

export function reassignLead(leadId: string, currentDealerId: string, targetDealerId: string) {
  return apiFetch(`/api/leads/${leadId}/reassign`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentDealerId, targetDealerId }),
  });
}
