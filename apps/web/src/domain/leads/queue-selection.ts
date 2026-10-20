export type QueueDealer = { id: string };
export type QueueLead = { dealerId: string };

/** Keep the first unfiltered queue load scoped to its initially selected dealer. */
export function selectInitialQueueLeads<T extends QueueLead>(
  leads: T[],
  dealers: QueueDealer[],
  dealerId?: string,
  dealerIds?: string[],
): T[] {
  if (dealerId || dealerIds?.length || !dealers[0]) return leads;
  return leads.filter((lead) => lead.dealerId === dealers[0].id);
}
