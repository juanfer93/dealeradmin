import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { isInvalidRealName } from '../../leads/domain/collector-normalizer';

export type GhlContextChannel = 'whatsapp' | 'messenger';
export type GhlConversationContextRequest = {
  locationId: string;
  contactId: string;
  conversationId?: string;
  channel: GhlContextChannel;
};

const CONTEXT_FIELDS = ['customer_name', 'vehicle_type', 'down_payment', 'purchase_timeline', 'documents'] as const;
type ContextField = typeof CONTEXT_FIELDS[number];
type ContextValues = Record<ContextField, string | null> & { vehicle_intent: 'buy' | 'sell' | null };
type ContextRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  ghl_conversation_id: string;
  qualification_snapshot: unknown;
  last_message_at: string | Date | null;
  latest_inbound_at: string | Date | null;
  conversation_match: boolean;
  dealer_vehicle_type: string | null;
  dealer_down_payment: string | null;
  dealer_purchase_timeline: string | null;
  dealer_documents: string | null;
};

const DEFAULT_STALE_AFTER_MS = 15 * 60 * 1000;
const FIELD_TO_SNAPSHOT_KEY: Record<ContextField, string> = {
  customer_name: 'real_name',
  vehicle_type: 'vehicle_type',
  down_payment: 'down_payment',
  purchase_timeline: 'purchase_timeline',
  documents: 'documents',
};

function clean(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized || null;
}

function snapshotObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string') return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function dateValue(value: string | Date | null | undefined): number | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function configuredStaleAfterMs(): number {
  const value = Number(process.env.GHL_CONTEXT_STALE_AFTER_MS ?? DEFAULT_STALE_AFTER_MS);
  return Number.isInteger(value) && value >= 60_000 && value <= 24 * 60 * 60 * 1000
    ? value
    : DEFAULT_STALE_AFTER_MS;
}

@Injectable()
export class GhlConversationContextService {
  constructor(private readonly dataSource: DataSource) {}

  private async read<T>(sql: string, parameters: unknown[]): Promise<T> {
    try {
      return await this.dataSource.query(sql, parameters) as T;
    } catch {
      throw new ServiceUnavailableException('Context unavailable');
    }
  }

  async getContext(input: GhlConversationContextRequest, now = new Date()) {
    const dealerIds = await this.read<Array<{ id: string }>>(
      `SELECT DISTINCT d.id::text AS id
       FROM dealers d
       WHERE d.active = true
         AND (d.ghl_location_id = $1 OR EXISTS (
           SELECT 1 FROM dealer_location_aliases a
           WHERE a.dealer_id = d.id AND a.ghl_location_id = $1
         ))`,
      [input.locationId],
    );
    const authorizedDealerIds = dealerIds.map((row) => row.id).filter(Boolean);
    if (authorizedDealerIds.length === 0) throw new NotFoundException('Context not found');

    const leads = await this.read<Array<{ id: string; first_name: string | null; last_name: string | null }>>(
      `SELECT l.id, l.first_name, l.last_name
       FROM leads l
       WHERE l.ghl_location_id = $1 AND l.ghl_contact_id = $2
         AND (
           EXISTS (
             SELECT 1 FROM lead_dealers ld
             WHERE ld.lead_id = l.id
               AND (ld.dealer_id::text = ANY($3::text[]) OR ld.assigned_dealer_id::text = ANY($3::text[]))
           )
           OR EXISTS (
             SELECT 1
             FROM conversations scoped_c
             WHERE scoped_c.lead_id = l.id
               AND scoped_c.ghl_location_id = $1
               AND scoped_c.ghl_contact_id = $2
               AND scoped_c.channel = $4
               AND (
                 scoped_c.qualification_snapshot->>'assigned_dealer_id' = ANY($3::text[])
                 OR (
                   NULLIF(scoped_c.qualification_snapshot->>'assigned_dealer_id', '') IS NULL
                   AND EXISTS (
                     SELECT 1 FROM lead_dealers scoped_ld
                     WHERE scoped_ld.lead_id = l.id
                       AND (scoped_ld.dealer_id::text = ANY($3::text[]) OR scoped_ld.assigned_dealer_id::text = ANY($3::text[]))
                   )
                 )
               )
           )
         )
       LIMIT 2`,
      [input.locationId, input.contactId, authorizedDealerIds, input.channel],
    );
    const lead = leads[0];
    if (!lead || leads.length > 1) throw new NotFoundException('Context not found');

    const [dealerFacts, conversations] = await Promise.all([
      this.read<Array<{
        vehicle_type: string | null;
        down_payment: string | null;
        purchase_timeline: string | null;
        documents: string | null;
      }>>(
        `SELECT ld.vehicle_type, ld.down_payment, ld.purchase_timeline, ld.documents
         FROM lead_dealers ld
         WHERE ld.lead_id = $1::uuid
           AND (ld.dealer_id::text = ANY($2::text[]) OR ld.assigned_dealer_id::text = ANY($2::text[]))
         ORDER BY ld.updated_at DESC, ld.created_at DESC`,
        [lead.id, authorizedDealerIds],
      ),
      this.read<ContextRow[]>(
        `SELECT c.ghl_conversation_id, c.qualification_snapshot, c.last_message_at,
                (c.ghl_conversation_id = $5) AS conversation_match,
                (SELECT MAX(cm.occurred_at)
                 FROM conversation_messages cm
                 WHERE cm.conversation_id = c.id AND cm.direction = 'inbound') AS latest_inbound_at,
                NULL::text AS dealer_vehicle_type,
                NULL::text AS dealer_down_payment,
                NULL::text AS dealer_purchase_timeline,
                NULL::text AS dealer_documents,
                l.first_name, l.last_name, l.id
         FROM conversations c
         INNER JOIN leads l ON l.id = c.lead_id
         WHERE c.lead_id = $1::uuid
           AND c.ghl_location_id = $2
           AND c.ghl_contact_id = $3
           AND c.channel = $4
           AND (
             c.qualification_snapshot->>'assigned_dealer_id' = ANY($6::text[])
             OR (
               NULLIF(c.qualification_snapshot->>'assigned_dealer_id', '') IS NULL
               AND EXISTS (
                 SELECT 1 FROM lead_dealers scope_ld
                 WHERE scope_ld.lead_id = c.lead_id
                   AND (scope_ld.dealer_id::text = ANY($6::text[]) OR scope_ld.assigned_dealer_id::text = ANY($6::text[]))
               )
             )
           )
         ORDER BY (c.ghl_conversation_id = $5) DESC, c.last_message_at DESC, c.created_at DESC`,
        [lead.id, input.locationId, input.contactId, input.channel, input.conversationId ?? '', authorizedDealerIds],
      ),
    ]);

    const rows = conversations;
    const invalidRealNames = input.channel === 'whatsapp'
      ? (await this.read<Array<{ normalized_value: string }>>(
        `SELECT normalized_value FROM invalid_real_names WHERE channel IN ('all', 'whatsapp') ORDER BY normalized_value`,
        [],
      )).map((row) => row.normalized_value)
      : [];

    const candidates = rows
      .map((row) => ({ row, snapshot: snapshotObject(row.qualification_snapshot) }))
      .sort((left, right) => {
        const exact = Number(right.row.conversation_match) - Number(left.row.conversation_match);
        if (exact !== 0) return exact;
        const completeness = CONTEXT_FIELDS.reduce((score, field) => score + (clean(left.snapshot[FIELD_TO_SNAPSHOT_KEY[field]]) ? 1 : 0), 0)
          - CONTEXT_FIELDS.reduce((score, field) => score + (clean(right.snapshot[FIELD_TO_SNAPSHOT_KEY[field]]) ? 1 : 0), 0);
        if (completeness !== 0) return completeness;
        return (dateValue(right.row.last_message_at) ?? 0) - (dateValue(left.row.last_message_at) ?? 0);
      });

    const known: ContextValues = {
      customer_name: null,
      vehicle_type: null,
      vehicle_intent: null,
      down_payment: null,
      purchase_timeline: null,
      documents: null,
    };
    for (const candidate of candidates) {
      const name = clean(candidate.snapshot.real_name);
      if (name && !isInvalidRealName(name, invalidRealNames)) {
        known.customer_name = name;
        break;
      }
    }
    if (!known.customer_name && input.channel === 'whatsapp') {
      known.customer_name = candidates.map((candidate) => clean(candidate.snapshot.profile_name)).find(Boolean) || null;
    }
    if (!known.customer_name) {
      const leadName = clean(`${lead.first_name ?? ''} ${lead.last_name ?? ''}`);
      if (leadName && !isInvalidRealName(leadName, invalidRealNames)) known.customer_name = leadName;
    }

    const fallback = (dealerFacts as Array<{
      vehicle_type: string | null;
      down_payment: string | null;
      purchase_timeline: string | null;
      documents: string | null;
    }>)[0];
    for (const field of CONTEXT_FIELDS) {
      if (known[field]) continue;
      for (const candidate of candidates) {
        const value = clean(candidate.snapshot[FIELD_TO_SNAPSHOT_KEY[field]]);
        if (!value) continue;
        if (field === 'customer_name' && isInvalidRealName(value, invalidRealNames)) continue;
        known[field] = value;
        break;
      }
      if (!known[field] && field !== 'customer_name' && fallback) {
        const dealerValue = field === 'vehicle_type'
          ? fallback.vehicle_type
          : field === 'down_payment'
            ? fallback.down_payment
            : field === 'purchase_timeline'
              ? fallback.purchase_timeline
              : fallback.documents;
        known[field] = clean(dealerValue);
      }
    }
    for (const candidate of candidates) {
      const intent = clean(candidate.snapshot.vehicle_intent)?.toLowerCase();
      if (intent === 'buy' || intent === 'sell') {
        known.vehicle_intent = intent;
        break;
      }
    }

    const missing = CONTEXT_FIELDS.filter((field) => !known[field]);
    const latestInboundAt = rows.reduce<number | null>((latest, row) => {
      const current = dateValue(row.latest_inbound_at);
      return current !== null && (latest === null || current > latest) ? current : latest;
    }, null);
    const contextStatus = rows.length === 0 || latestInboundAt === null
      ? 'unknown'
      : now.getTime() - latestInboundAt <= configuredStaleAfterMs() ? 'fresh' : 'stale';

    return {
      ok: true as const,
      source: 'dealeradmin' as const,
      known,
      missing,
      nextQuestion: missing[0] ?? null,
      contextStatus,
      contextUpdatedAt: latestInboundAt === null ? null : new Date(latestInboundAt).toISOString(),
    };
  }
}
