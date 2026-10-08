export type VehicleCandidate = {
  label: string;
  score: number;
  lineIndex: number;
  hasModel: boolean;
  brand: string;
  isColloquialTruck: boolean;
};

/**
 * Select the active vehicle answer without changing the collector's existing
 * rule: a later explicit answer wins, except that a colloquial truck token
 * does not replace an earlier, more specific model in the same answer chain.
 */
export function resolveVehicleCandidate(candidates: VehicleCandidate[]): VehicleCandidate | undefined {
  const latest = candidates
    .slice()
    .sort((left, right) => right.lineIndex - left.lineIndex || right.score - left.score)[0];
  return latest?.isColloquialTruck && !latest.hasModel
    ? candidates.find((candidate) => candidate.hasModel && candidate.lineIndex < latest.lineIndex) ?? latest
    : latest;
}
