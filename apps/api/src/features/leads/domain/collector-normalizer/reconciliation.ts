import { EMPTY } from './constants';
import { isAdvisorHandoffVehicle } from './flow-policy';
import type { CollectorInput, QualificationStep } from './types';
import { clean, firstNonEmpty } from './text-cleaner';

/**
 * Marks the minimum routing qualification, not the end of information
 * collection. A phone and a real vehicle are enough to enter the durable
 * waiting_window recovery contract; down payment, timeline, documents and
 * banking evidence are additive fields collected during its cycles.
 */
export function isQualificationComplete(input: {
  real_name?: string | null;
  phone?: string | null;
  vehicle_type?: string | null;
  down_payment?: string | null;
  purchase_timeline?: string | null;
  has_identification?: string | null;
  has_income_proof?: string | null;
  bank_account?: string | null;
  advisor_handoff_requested?: boolean;
}): boolean {
  const hasRoutableVehicle = Boolean(clean(input.vehicle_type) && !isAdvisorHandoffVehicle(input.vehicle_type));
  const hasExplicitHandoff = Boolean(input.advisor_handoff_requested && isAdvisorHandoffVehicle(input.vehicle_type));
  return Boolean(clean(input.phone) && (hasRoutableVehicle || hasExplicitHandoff));
}

export function hasMinimumRoutingQualification(
  input: Pick<CollectorInput, 'real_name' | 'phone' | 'vehicle_type'> & { advisor_handoff_requested?: boolean },
): boolean {
  const hasRoutableVehicle = Boolean(firstNonEmpty(input.vehicle_type) && !isAdvisorHandoffVehicle(input.vehicle_type));
  const hasExplicitHandoff = Boolean(input.advisor_handoff_requested && isAdvisorHandoffVehicle(input.vehicle_type));
  return Boolean(firstNonEmpty(input.phone) && (hasRoutableVehicle || hasExplicitHandoff));
}

export function missingQualification(phone: string, hasRealVehicle: boolean, requiresLocation: boolean, customerLocation: string, advisorHandoffRequested = false): string[] {
  return [
    !phone ? 'phone' : EMPTY,
    !hasRealVehicle && !advisorHandoffRequested ? 'vehicle_type' : EMPTY,
    requiresLocation && !customerLocation ? 'customer_location' : EMPTY,
  ].filter(Boolean);
}

export function qualificationStep(hasRealVehicle: boolean, requiresLocation: boolean, customerLocation: string, phoneSatisfied: boolean): QualificationStep {
  return !hasRealVehicle
    ? 'vehicle_type'
    : requiresLocation && !customerLocation
      ? 'customer_location'
      : !phoneSatisfied
        ? 'phone'
        : 'complete';
}
