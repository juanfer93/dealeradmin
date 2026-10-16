export type GhlGuardLeadMetadata = {
  lead: Record<string, unknown>;
  qualification: Record<string, unknown> | null;
  location: Record<string, unknown> | null;
  dealer_relations: Array<Record<string, unknown>>;
};

export type GhlGuardCompletedFields = Record<string, {
  before: unknown;
  after: unknown;
  source: 'ghl_guard';
}>;

function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function flatten(value: unknown, path: string, output: Map<string, unknown>): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => flatten(item, `${path}[${index}]`, output));
    return;
  }
  if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, item]) => flatten(item, path ? `${path}.${key}` : key, output));
    return;
  }
  output.set(path, value);
}

/** Returns only blank-to-filled values so the audit remains additive and readable. */
export function completedFieldsBetween(
  before: GhlGuardLeadMetadata | null,
  after: GhlGuardLeadMetadata | null,
): GhlGuardCompletedFields | null {
  if (!before || !after) return null;
  const beforeValues = new Map<string, unknown>();
  const afterValues = new Map<string, unknown>();
  flatten(before, '', beforeValues);
  flatten(after, '', afterValues);
  const completed: GhlGuardCompletedFields = {};
  for (const [path, afterValue] of afterValues) {
    const beforeValue = beforeValues.get(path);
    if (isBlank(beforeValue) && !isBlank(afterValue)) {
      completed[path] = { before: beforeValue ?? null, after: afterValue, source: 'ghl_guard' };
    }
  }
  return Object.keys(completed).length > 0 ? completed : null;
}
