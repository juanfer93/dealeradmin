import { apiFetch } from '../http/api-client';

export function getDealers(signal?: AbortSignal) {
  return apiFetch('/api/dealers', { signal });
}

export function getMonthlyStatus(signal?: AbortSignal) {
  return apiFetch('/api/reports/monthly/status', { signal });
}

export function getReportPreview(query: string, signal?: AbortSignal) {
  return apiFetch(`/api/reports/preview?${query}`, { signal });
}

export function getReportExportUrl(query: string) {
  return `/api/reports/export?${query}`;
}
