type Queryable = { query(sql: string, parameters?: unknown[]): Promise<unknown> };

export type DealerLeadDuplicate = {
  id: string;
  first_name: string;
  last_name: string;
  canonical_phone?: string | null;
  status?: string | null;
};

export type QueuedConversationDuplicate = DealerLeadDuplicate & {
  conversation_id: string;
  conversation_status: 'queued';
};

export function normalizeLeadName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

export async function findDealerLeadDuplicate(
  queryable: Queryable,
  dealerId: string,
  name: string,
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
  const parameters: unknown[] = [dealerId, phone, normalizeLeadName(name)];
  const exclusion = excludeLeadId ? 'AND l.id <> $4' : '';
  if (excludeLeadId) parameters.push(excludeLeadId);
  const rows = await queryable.query(
    `SELECT l.id, l.first_name, l.last_name, l.canonical_phone, ld.status
     FROM leads l
     INNER JOIN lead_dealers ld ON ld.lead_id = l.id
     WHERE COALESCE(ld.assigned_dealer_id, ld.dealer_id) = $1
       AND l.canonical_phone = $2
       AND LOWER(REGEXP_REPLACE(TRIM(CONCAT_WS(' ', l.first_name, l.last_name)), '\\s+', ' ', 'g')) = $3
       ${exclusion}
     LIMIT 1
     FOR UPDATE OF l`,
    parameters,
  ) as DealerLeadDuplicate[];
  return rows[0];
}

/**
 * Finds an already queued conversation for the same source dealer, normalized
 * name, and canonical phone. This is separate from the generic lead duplicate
 * lookup because manual leads do not necessarily have a conversation row.
 */
export async function findQueuedConversationDuplicate(
  queryable: Queryable,
  dealerId: string,
  name: string,
  phone: string,
  excludeConversationId?: string,
): Promise<QueuedConversationDuplicate | undefined> {
  const normalizedName = normalizeLeadName(name);
  if (!normalizedName || normalizedName === 'lead' || !phone) return undefined;

  const parameters: unknown[] = [dealerId, phone, normalizedName];
  const exclusion = excludeConversationId ? 'AND c.id <> $4' : '';
  if (excludeConversationId) parameters.push(excludeConversationId);
  const rows = await queryable.query(
    `SELECT l.id, l.first_name, l.last_name, l.canonical_phone,
            c.id AS conversation_id, c.status AS conversation_status, ld.status
     FROM conversations c
     INNER JOIN leads l ON l.id = c.lead_id
     INNER JOIN lead_dealers ld ON ld.lead_id = l.id
     WHERE (ld.dealer_id = $1 OR COALESCE(ld.assigned_dealer_id, ld.dealer_id) = $1)
       AND l.canonical_phone = $2
       AND LOWER(REGEXP_REPLACE(TRIM(CONCAT_WS(' ', l.first_name, l.last_name)), '\\s+', ' ', 'g')) = $3
       AND c.status = 'queued'
       ${exclusion}
     ORDER BY c.updated_at DESC
     LIMIT 1
     FOR UPDATE OF c`,
    parameters,
  ) as QueuedConversationDuplicate[];
  return rows[0];
}
