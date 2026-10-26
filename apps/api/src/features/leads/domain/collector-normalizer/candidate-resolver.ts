export type VehicleCandidate = {
  label: string;
  score: number;
  lineIndex: number;
  hasModel: boolean;
  brand: string;
  isColloquialTruck: boolean;
  /** Image/OCR evidence may describe a trade-in and must not override text. */
  isSyntheticEvidence?: boolean;
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
  // A later make-only request such as "Toyota" should not erase an earlier,
  // explicit model such as "Tacoma". The caller can combine that make with
  // the specific model after resolution. A later category-only answer still
  // wins, preserving the existing behavior when the buyer changes vehicle
  // type explicitly.
  if (latest && latest.brand && !latest.hasModel) {
    const earlierModel = candidates
      .filter((candidate) => candidate.hasModel && candidate.lineIndex < latest.lineIndex)
      .sort((left, right) => right.lineIndex - left.lineIndex || right.score - left.score)[0];
    if (earlierModel) return earlierModel;
  }
  return latest?.isColloquialTruck && !latest.hasModel
    ? candidates.find((candidate) => candidate.hasModel && candidate.lineIndex < latest.lineIndex) ?? latest
    : latest;
}
