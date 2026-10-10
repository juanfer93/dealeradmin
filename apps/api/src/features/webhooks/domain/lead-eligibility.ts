export type LeadEligibilityInput = {
  phone?: string | null;
  dealerId?: string | null;
  dealerCode?: string | null;
  ghlLocationId?: string | null;
  dealerActive?: boolean;
  channel?: string | null;
  allowedChannels?: readonly string[];
};

export type LeadEligibility = {
  eligible: boolean;
  reasons: string[];
};

export function evaluateLeadEligibility(input: LeadEligibilityInput): LeadEligibility {
  const reasons: string[] = [];
  if (!input.phone?.trim()) reasons.push('PHONE_REQUIRED');
  if (!input.dealerId?.trim()) reasons.push('DEALER_REQUIRED');
  if (!input.ghlLocationId?.trim()) reasons.push('GHL_LOCATION_REQUIRED');
  if (input.dealerActive === false) reasons.push('DEALER_INACTIVE');
  const dealerCode = input.dealerCode?.trim().toLowerCase();
  const allowedChannels = input.allowedChannels
    ?? (dealerCode === 'stafford' ? ['whatsapp', 'messenger'] : undefined);
  const channel = input.channel?.trim().toLowerCase();
  if (channel && allowedChannels && !allowedChannels.some((candidate) => candidate.toLowerCase() === channel)) {
    reasons.push('CHANNEL_NOT_SUPPORTED');
  }
  return { eligible: reasons.length === 0, reasons };
}
