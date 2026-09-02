type Queryable = { query(sql: string, parameters?: unknown[]): Promise<unknown> };

export type DealerLeadDuplicate = { id: string; first_name: string; last_name: string };

export async function findDealerLeadDuplicate(
  queryable: Queryable,
  dealerId: string,
  name: string,
  phone: string,
  excludeLeadId?: string,
): Promise<DealerLeadDuplicate | undefined> {
  const parameters = [dealerId, phone, name.trim().toLowerCase()];
  const exclusion = excludeLeadId ? 'AND l.id <> $4' : '';
  if (excludeLeadId) parameters.push(excludeLeadId);
  const rows = await queryable.query(
    `SELECT l.id, l.first_name, l.last_name
     FROM leads l
     INNER JOIN lead_dealers ld ON ld.lead_id = l.id
     WHERE COALESCE(ld.assigned_dealer_id, ld.dealer_id) = $1
       AND l.canonical_phone = $2
       AND LOWER(TRIM(CONCAT_WS(' ', l.first_name, l.last_name))) = $3
       ${exclusion}
     LIMIT 1
     FOR UPDATE OF l`,
    parameters,
  ) as DealerLeadDuplicate[];
  return rows[0];
}
