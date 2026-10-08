import { EMPTY } from './constants';
import { isAdvisorHandoffVehicle } from './flow-policy';
import type { CollectorInput, QualificationStep } from './types';
import { clean, firstNonEmpty } from './text-cleaner';

export function isQualificationComplete(input: {
  real_name?: string | null;
  phone?: string | null;
  vehicle_type?: string | null;
  down_payment?: string | null;
  purchase_timeline?: string | null;
  has_identification?: string | null;
  has_income_proof?: string | null;
  bank_account?: string | null;
}): boolean {
  return Boolean(clean(input.phone) && clean(input.vehicle_type) && !isAdvisorHandoffVehicle(input.vehicle_type));
}

export function hasMinimumRoutingQualification(
  input: Pick<CollectorInput, 'real_name' | 'phone' | 'vehicle_type'>,
): boolean {
  return Boolean(firstNonEmpty(input.phone) && firstNonEmpty(input.vehicle_type) && !isAdvisorHandoffVehicle(input.vehicle_type));
}

export function missingQualification(phone: string, hasRealVehicle: boolean, requiresLocation: boolean, customerLocation: string): string[] {
  return [
    !phone ? 'phone' : EMPTY,
    !hasRealVehicle ? 'vehicle_type' : EMPTY,
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
