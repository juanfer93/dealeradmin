export type LeadEligibilityInput = {
  phone?: string | null;
  dealerId?: string | null;
  ghlLocationId?: string | null;
  dealerActive?: boolean;
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
  return { eligible: reasons.length === 0, reasons };
}
