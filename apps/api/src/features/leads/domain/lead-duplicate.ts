type Queryable = { query(sql: string, parameters?: unknown[]): Promise<unknown> };

export type DealerLeadDuplicate = {
  id: string;
  first_name: string;
  last_name: string;
  canonical_phone?: string | null;
  status?: string | null;
};

export async function findDealerLeadDuplicate(
  queryable: Queryable,
  dealerId: string,
  _name: string,
  phone: string,
  excludeLeadId?: string,
): Promise<DealerLeadDuplicate | undefined> {
  // Duplicate identity is scoped to the target dealer. The advisory lock also
  // serializes concurrent uploads for the same dealer and phone when the
  // lookup finds no existing row yet.
  await queryable.query(
    `SELECT pg_advisory_xact_lock(hashtext($1))`,
    [`dealer-lead:${dealerId}:${phone}`],
  );
  const parameters: unknown[] = [dealerId, phone];
  const exclusion = excludeLeadId ? 'AND l.id <> $3' : '';
  if (excludeLeadId) parameters.push(excludeLeadId);
  const rows = await queryable.query(
    `SELECT l.id, l.first_name, l.last_name, l.canonical_phone, ld.status
     FROM leads l
     INNER JOIN lead_dealers ld ON ld.lead_id = l.id
     WHERE COALESCE(ld.assigned_dealer_id, ld.dealer_id) = $1
       AND l.canonical_phone = $2
       ${exclusion}
     LIMIT 1
     FOR UPDATE OF l`,
    parameters,
  ) as DealerLeadDuplicate[];
  return rows[0];
}
