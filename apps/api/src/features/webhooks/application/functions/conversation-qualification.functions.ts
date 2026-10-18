import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import type { QueryRunner } from 'typeorm';
import { buildWhatsAppMessage } from '../../../leads/domain/message-builder';
import { hasMinimumRoutingQualification, type CollectorLanguage } from '../../../leads/domain/collector-normalizer';
import { normalizeDownPayment } from '../../../leads/domain/down-payment';
import { extractConversationLocation, extractLocationCandidates } from '../conversation-location';
import type { GeoroutingService } from '../../../routing/domain/services/georouting.service';
import {
  CONVERSATION_STABILIZATION_MS,
  GHL_SOURCE_CONFIG,
  INCOMPLETE_QUALIFICATION_WINDOW_HOURS,
  OUT_OF_WINDOW_QUALIFICATION_WINDOW_HOURS,
  QUALIFICATION_RULE_TIMEZONE,
  STALE_PHONE_REENTRY_DAYS,
} from './conversation-webhook.config';
import { plusHours, safePhone, withinDispatchWindow } from './conversation-webhook.helpers';
import { UnresolvedLocationException } from './conversation-webhook.errors';
import type {
  ConversationRow,
  ConversationSnapshot,
  DealerRow,
  ExistingDealerLead,
  LeadRow,
  LocationSnapshot,
  SourceConfigMap,
  SourceKey,
} from './conversation-webhook.types';

function sameDealerLocationSql(conversationAlias: string): string {
  return `(
           ${conversationAlias}.ghl_location_id = $5
           OR EXISTS (
             SELECT 1
             FROM dealer_location_aliases current_location_alias
             INNER JOIN dealer_location_aliases historical_location_alias
               ON historical_location_alias.dealer_id = current_location_alias.dealer_id
             WHERE current_location_alias.ghl_location_id = $5
               AND current_location_alias.dealer_id = $2
               AND historical_location_alias.ghl_location_id = ${conversationAlias}.ghl_location_id
               AND historical_location_alias.dealer_id = $2
           )
         )`;
}

export class ConversationQualificationFunctions {
  constructor(
    private readonly georoutingService?: GeoroutingService,
    private readonly sourceConfig: SourceConfigMap = GHL_SOURCE_CONFIG,
  ) {}

  async findStalePhoneReentry(runner: QueryRunner, phone: string, dealerId: string, now: Date): Promise<{ sent_at: string } | null> {
    const cutoff = new Date(now.getTime() - STALE_PHONE_REENTRY_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const rows = await runner.query(
      `SELECT ld.sent_at
       FROM leads l
       INNER JOIN lead_dealers ld ON ld.lead_id = l.id
       WHERE l.canonical_phone = $1
         AND COALESCE(ld.assigned_dealer_id, ld.dealer_id) = $3
         AND ld.status = 'sent'
         AND ld.sent_at IS NOT NULL
         AND ld.sent_at <= $2::timestamptz
       ORDER BY ld.sent_at DESC
       LIMIT 1`,
      [phone, cutoff, dealerId],
    ) as Array<{ sent_at: string }>;
    return rows[0] ?? null;
  }

  async findExistingLeadReengagement(
    runner: QueryRunner,
    phone: string,
    dealerId: string,
    currentConversationId: string,
    currentConversationCreatedAt: string | Date,
    currentMessageOccurredAt: string | Date,
    locationId: string,
  ): Promise<LeadRow | null> {
    if (!phone) return null;
    const rows = await runner.query(
      `SELECT l.id, l.canonical_phone, l.first_name, l.last_name
       FROM leads l
       INNER JOIN lead_dealers ld ON ld.lead_id = l.id
       WHERE (
           l.canonical_phone = $1
           OR EXISTS (
             SELECT 1
             FROM conversations phone_evidence_conversation
             WHERE phone_evidence_conversation.lead_id = l.id
               AND phone_evidence_conversation.qualification_snapshot->>'phone' = $1
               AND ${sameDealerLocationSql('phone_evidence_conversation')}
           )
         )
         AND (ld.dealer_id = $2 OR COALESCE(ld.assigned_dealer_id, ld.dealer_id) = $2)
         AND ld.status IN ('pending', 'queued', 'sent')
         AND (ld.status <> 'sent' OR ld.sent_at IS NOT NULL)
         AND (
           ld.created_at < $3::timestamptz
           OR NOT EXISTS (
             SELECT 1
             FROM conversations current_lead_conversation
             WHERE current_lead_conversation.lead_id = l.id
           )
           OR EXISTS (
             SELECT 1
             FROM conversations current_lead_conversation
             WHERE current_lead_conversation.id = $4
               AND current_lead_conversation.lead_id = l.id
               AND ${sameDealerLocationSql('current_lead_conversation')}
               AND current_lead_conversation.status IN ('queued', 'sent')
               AND current_lead_conversation.last_message_at <= $6::timestamptz - INTERVAL '24 hours'
               AND EXISTS (
                 SELECT 1
                 FROM conversation_messages current_lead_message
                 WHERE current_lead_message.conversation_id = current_lead_conversation.id
                   AND current_lead_message.occurred_at <= $6::timestamptz - INTERVAL '24 hours'
               )
           )
         )
         AND (
           NOT EXISTS (
             SELECT 1
             FROM conversations any_lead_conversation
             WHERE any_lead_conversation.lead_id = l.id
           )
           OR EXISTS (
             SELECT 1
             FROM conversations old_lead_conversation
             WHERE old_lead_conversation.lead_id = l.id
               AND old_lead_conversation.id <> $4
               AND ${sameDealerLocationSql('old_lead_conversation')}
               AND old_lead_conversation.status IN ('queued', 'sent')
               AND old_lead_conversation.last_message_at <= $3::timestamptz - INTERVAL '24 hours'
               AND EXISTS (
                 SELECT 1
                 FROM conversation_messages old_lead_message
                 WHERE old_lead_message.conversation_id = old_lead_conversation.id
               )
           )
           OR EXISTS (
             SELECT 1
             FROM conversations current_lead_conversation
             WHERE current_lead_conversation.id = $4
               AND current_lead_conversation.lead_id = l.id
               AND ${sameDealerLocationSql('current_lead_conversation')}
               AND current_lead_conversation.status IN ('queued', 'sent')
               AND current_lead_conversation.last_message_at <= $6::timestamptz - INTERVAL '24 hours'
               AND EXISTS (
                 SELECT 1
                 FROM conversation_messages current_lead_message
                 WHERE current_lead_message.conversation_id = current_lead_conversation.id
                   AND current_lead_message.occurred_at <= $6::timestamptz - INTERVAL '24 hours'
               )
           )
         )
       ORDER BY ld.sent_at DESC NULLS LAST, l.updated_at DESC, l.created_at DESC
       LIMIT 1
       FOR UPDATE OF l`,
      [phone, dealerId, currentConversationCreatedAt, currentConversationId, locationId, currentMessageOccurredAt],
    ) as LeadRow[];
    return rows[0] ?? null;
  }

  async reassignConversationToLead(
    runner: QueryRunner,
    conversationId: string,
    duplicateLeadId: string,
    existingLeadId: string,
  ): Promise<void> {
    const duplicateRows = await runner.query(
      `SELECT ghl_contact_id, ghl_location_id FROM leads WHERE id = $1 FOR UPDATE`,
      [duplicateLeadId],
    ) as Array<{ ghl_contact_id: string; ghl_location_id: string }>;
    const duplicate = duplicateRows[0];
    if (!duplicate) return;
    await runner.query(
      `UPDATE conversations
       SET lead_id = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $3 AND lead_id = $1`,
      [duplicateLeadId, existingLeadId, conversationId],
    );
    await runner.query(
      `UPDATE leads SET ghl_contact_id = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [duplicateLeadId, `merged-${duplicateLeadId}`],
    );
    await runner.query(
      `UPDATE leads
       SET ghl_contact_id = $2, ghl_location_id = $3, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [existingLeadId, duplicate.ghl_contact_id, duplicate.ghl_location_id],
    );
    await runner.query(
      `DELETE FROM leads
       WHERE id = $1
         AND NOT EXISTS (SELECT 1 FROM conversations WHERE lead_id = $1)
         AND NOT EXISTS (SELECT 1 FROM lead_dealers WHERE lead_id = $1)`,
      [duplicateLeadId],
    );
  }

  async findSourceDealer(runner: QueryRunner, locationId: string, source?: SourceKey, language?: CollectorLanguage, assignedDealerId?: string): Promise<DealerRow> {
    const rows = await runner.query(
      `SELECT d.id, d.code, d.name, d.timezone, d.routing_config
       FROM dealers d
       WHERE d.active = true AND (d.ghl_location_id = $1 OR EXISTS (SELECT 1 FROM dealer_location_aliases a WHERE a.ghl_location_id = $1 AND a.dealer_id = d.id))
       ORDER BY d.created_at, d.id`,
      [locationId],
    ) as DealerRow[];
    if (rows.length === 0) throw new UnresolvedLocationException(locationId);
    if (source === 'action-cars') {
      const selectedLanguage = language ?? 'es';
      const dealer = rows.find((row) => row.routing_config?.language === selectedLanguage);
      if (!dealer) throw new BadRequestException(`No existe dealer Action Pre Owned Cars configurado para el idioma ${selectedLanguage}`);
      return dealer;
    }
    const alternatingGroup = source ? this.sourceConfig[source].alternatingGroup : undefined;
    if (alternatingGroup) {
      const candidates = rows
        .filter((row) => row.routing_config?.allocation_key === alternatingGroup)
        .sort((left, right) => (left.routing_config?.allocation_order ?? 0) - (right.routing_config?.allocation_order ?? 0));
      if (assignedDealerId) {
        const assigned = candidates.find((row) => row.id === assignedDealerId);
        if (assigned) return assigned;
      }
      if (candidates.length < 2) throw new BadRequestException(`El grupo alternado ${alternatingGroup} requiere al menos dos dealers activos`);
      await runner.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [alternatingGroup]);
      const lastAssignments = await runner.query(
        `SELECT COALESCE(ld.assigned_dealer_id, ld.dealer_id) AS dealer_id
         FROM lead_dealers ld
         INNER JOIN leads l ON l.id = ld.lead_id
         WHERE COALESCE(ld.assigned_dealer_id, ld.dealer_id) = ANY($1::uuid[])
         ORDER BY ld.created_at DESC, ld.updated_at DESC, l.created_at DESC, ld.lead_id DESC
         LIMIT 1`,
        [candidates.map((candidate) => candidate.id)],
      ) as Array<{ dealer_id: string }>;
      const lastDealerId = lastAssignments[0]?.dealer_id;
      const lastIndex = candidates.findIndex((candidate) => candidate.id === lastDealerId);
      const nextIndex = lastIndex < 0 ? 0 : (lastIndex + 1) % candidates.length;
      return candidates[nextIndex];
    }
    if (rows.length > 1) throw new BadRequestException(`El Location ID ${locationId} está vinculado a más de un dealer activo`);
    return rows[0];
  }

  async upsertLead(runner: QueryRunner, input: { locationId: string; contactId: string; phone: string | null; firstName: string; lastName: string }): Promise<LeadRow> {
    const canonicalPhone = safePhone(input.phone);
    const existing = await runner.query(
      `SELECT id, canonical_phone, first_name, last_name FROM leads WHERE ghl_location_id = $1 AND ghl_contact_id = $2 FOR UPDATE`,
      [input.locationId, input.contactId],
    ) as LeadRow[];
    if (existing[0]) {
      const lead = existing[0];
      await runner.query(
        `UPDATE leads
         SET canonical_phone = COALESCE($1, canonical_phone),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [canonicalPhone, lead.id],
      );
      return {
        ...lead,
        canonical_phone: canonicalPhone || lead.canonical_phone,
      };
    }
    const inserted = await runner.query(
      `INSERT INTO leads (canonical_phone, first_name, last_name, ghl_contact_id, ghl_location_id, source)
       VALUES ($1, $2, $3, $4, $5, 'GHL Customer Replied') RETURNING id, canonical_phone, first_name, last_name`,
      [canonicalPhone, input.firstName, input.lastName, input.contactId, input.locationId],
    ) as LeadRow[];
    return inserted[0];
  }

  async upsertConversation(runner: QueryRunner, input: { leadId: string; locationId: string; contactId: string; conversationId: string; channel: string; occurredAt: string }): Promise<ConversationRow> {
    const existing = await runner.query(
      `SELECT id, status, qualification_snapshot, location_snapshot, ready_at,
              created_at, first_message_at,
              EXISTS (
                SELECT 1
                FROM conversation_messages cm
                WHERE cm.conversation_id = conversations.id
              ) AS has_previous_message
       FROM conversations
       WHERE ghl_location_id = $1 AND ghl_contact_id = $2 AND ghl_conversation_id = $3 FOR UPDATE`,
      [input.locationId, input.contactId, input.conversationId],
    ) as ConversationRow[];
    if (existing[0]) return { ...existing[0], isExisting: true };
    const inserted = await runner.query(
      `INSERT INTO conversations (lead_id, ghl_location_id, ghl_contact_id, ghl_conversation_id, channel, first_message_at, last_message_at)
       VALUES ($1, $2, $3, $4, $5, $6, $6)
       ON CONFLICT (ghl_location_id, ghl_contact_id, ghl_conversation_id) DO NOTHING
       RETURNING id, status, qualification_snapshot, location_snapshot, ready_at, created_at, first_message_at`,
      [input.leadId, input.locationId, input.contactId, input.conversationId, input.channel, input.occurredAt],
    ) as ConversationRow[];
    if (inserted[0]) return { ...inserted[0], isExisting: false };

    // Another webhook won the same identity race. Read its committed row and
    // continue through the existing-conversation path without duplicating it.
    const concurrent = await runner.query(
      `SELECT id, status, qualification_snapshot, location_snapshot, ready_at,
              created_at, first_message_at,
              EXISTS (
                SELECT 1
                FROM conversation_messages cm
                WHERE cm.conversation_id = conversations.id
              ) AS has_previous_message
       FROM conversations
       WHERE ghl_location_id = $1 AND ghl_contact_id = $2 AND ghl_conversation_id = $3 FOR UPDATE`,
      [input.locationId, input.contactId, input.conversationId],
    ) as ConversationRow[];
    if (concurrent[0]) return { ...concurrent[0], isExisting: true };
    throw new Error('Conversation insert conflict did not resolve to an existing row');
  }

  statusForConversation(
    snapshot: ConversationSnapshot,
    location: LocationSnapshot,
    dealer: DealerRow,
    source: SourceKey,
    now: Date,
    phase: 'capture' | 'due',
    readyAt?: string | null,
  ): { status: 'partial' | 'ready' | 'waiting_window'; nextAttemptAt: string | null } {
    const isEasterns = source === 'easterns' && dealer.routing_config?.group === 'Easterns';
    const hasLocation = Boolean(location.city || location.state || location.easterns_zone || location.zip_code);
    const routingReady = Boolean(
      hasMinimumRoutingQualification({ real_name: snapshot.real_name, phone: snapshot.phone, vehicle_type: snapshot.vehicle_type })
    );
    if (!routingReady) return { status: 'partial', nextAttemptAt: null };
    if (phase === 'capture') {
      return { status: 'waiting_window', nextAttemptAt: new Date(now.getTime() + CONVERSATION_STABILIZATION_MS).toISOString() };
    }
    if (isEasterns && !hasLocation) return { status: 'partial', nextAttemptAt: null };
    if (snapshot.qualification_complete) return { status: 'ready', nextAttemptAt: null };
    const delayHours = withinDispatchWindow(QUALIFICATION_RULE_TIMEZONE, now)
      ? INCOMPLETE_QUALIFICATION_WINDOW_HOURS
      : OUT_OF_WINDOW_QUALIFICATION_WINDOW_HOURS;
    const windowStart = readyAt ? new Date(readyAt) : now;
    const windowDueAt = Number.isNaN(windowStart.getTime()) ? plusHours(now, delayHours) : plusHours(windowStart, delayHours);
    if (windowDueAt <= now) return { status: 'ready', nextAttemptAt: null };
    return { status: 'waiting_window', nextAttemptAt: windowDueAt.toISOString() };
  }

  async resolveLocation(runner: QueryRunner, transcript: string): Promise<LocationSnapshot> {
    const hints = extractConversationLocation(transcript);
    let city = hints.city;
    let state = hints.state;
    const candidates = [...new Set([
      ...(city ? [city.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()] : []),
      ...extractLocationCandidates(transcript),
    ])];
    if (candidates.length === 0) return { city: city || null, state: state || null, zip_code: hints.zip_code, easterns_zone: hints.easterns_zone };
    const rows = await runner.query(
      `SELECT name, state_code
       FROM locations
       WHERE normalized_name = ANY($1::text[])
       ORDER BY CASE
         WHEN $2::varchar IS NOT NULL AND state_code = $2 THEN 0
         WHEN state_code = 'MD' THEN 1
         WHEN state_code = 'VA' THEN 2
         ELSE 3
       END, array_position($1::text[], normalized_name)
       LIMIT 1`,
      [candidates, state],
    ) as Array<{ name: string; state_code: string }>;
    if (rows[0]) {
      city = rows[0].name;
      state = state || rows[0].state_code;
    }
    return { city: city || null, state: state || null, zip_code: hints.zip_code, easterns_zone: hints.easterns_zone };
  }

  async syncLeadDealer(runner: QueryRunner, sourceDealer: DealerRow, leadId: string, snapshot: ConversationSnapshot, location: LocationSnapshot, source: SourceKey, reengagement = false): Promise<void> {
    const existing = await runner.query(
      `SELECT status, routing_status, assigned_dealer_id, routing_override, routing_reason, vehicle_type, down_payment,
              identification, bank_account, purchase_timeline, documents, has_unhandled_reengagement, reengagement_count
       FROM lead_dealers WHERE lead_id = $1 AND dealer_id = $2 FOR UPDATE`,
      [leadId, sourceDealer.id],
    ) as ExistingDealerLead[];
    const current = existing[0];
    const usesEasternsGeorouting = source === 'easterns' && sourceDealer.routing_config?.group === 'Easterns';
    const georoutingService = this.georoutingService;
    if (usesEasternsGeorouting && !georoutingService) throw new ServiceUnavailableException('Georouting service is not available');
    const routing = usesEasternsGeorouting
      ? await georoutingService!.resolveDealer(
        { ...location, qualification_memory: snapshot.qualification_memory },
        runner,
        sourceDealer.id,
        this.sourceConfig[source].locationId,
      )
      : { dealerId: sourceDealer.id, reason: `GHL ${source} source dealer` };
    const alreadySent = current?.status === 'sent';
    const preservesAssignment = Boolean(current?.routing_override || alreadySent);
    const assignedDealerId = preservesAssignment ? current?.assigned_dealer_id || routing.dealerId : routing.dealerId;
    const routingReason = preservesAssignment ? current?.routing_reason || routing.reason : routing.reason;
    const messageText = buildWhatsAppMessage(snapshot.real_name || 'Lead', snapshot.phone, snapshot);
    const hasUnhandledReengagement = reengagement || Boolean(current?.has_unhandled_reengagement);
    await runner.query(
      `INSERT INTO lead_dealers
        (lead_id, dealer_id, vehicle_type, down_payment, identification, bank_account, purchase_timeline, documents,
        easterns_zone, assigned_dealer_id, routing_override, routing_reason, routing_status, status, message_text, has_unhandled_reengagement, reengagement_count, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'resolved', $13, $14, $15, $17::int, CURRENT_TIMESTAMP)
       ON CONFLICT (lead_id, dealer_id) DO UPDATE SET
         vehicle_type = COALESCE(NULLIF(EXCLUDED.vehicle_type, ''), lead_dealers.vehicle_type),
         down_payment = COALESCE(NULLIF(EXCLUDED.down_payment, ''), lead_dealers.down_payment),
         identification = COALESCE(NULLIF(EXCLUDED.identification, ''), lead_dealers.identification),
         bank_account = COALESCE(NULLIF(EXCLUDED.bank_account, ''), lead_dealers.bank_account),
         purchase_timeline = COALESCE(NULLIF(EXCLUDED.purchase_timeline, ''), lead_dealers.purchase_timeline),
         documents = COALESCE(NULLIF(EXCLUDED.documents, ''), lead_dealers.documents),
         easterns_zone = COALESCE(NULLIF(EXCLUDED.easterns_zone, ''), lead_dealers.easterns_zone),
         assigned_dealer_id = CASE WHEN lead_dealers.status = 'sent' OR lead_dealers.routing_override THEN lead_dealers.assigned_dealer_id ELSE EXCLUDED.assigned_dealer_id END,
         routing_status = CASE WHEN lead_dealers.status = 'sent' OR lead_dealers.routing_override THEN lead_dealers.routing_status ELSE EXCLUDED.routing_status END,
         routing_reason = CASE WHEN lead_dealers.status = 'sent' OR lead_dealers.routing_override THEN lead_dealers.routing_reason ELSE EXCLUDED.routing_reason END,
         status = CASE WHEN $16::boolean THEN 'pending' WHEN lead_dealers.status = 'sent' THEN 'sent' ELSE 'pending' END,
         message_text = EXCLUDED.message_text,
         has_unhandled_reengagement = CASE WHEN EXCLUDED.has_unhandled_reengagement THEN true ELSE lead_dealers.has_unhandled_reengagement END,
         reengagement_count = lead_dealers.reengagement_count + EXCLUDED.reengagement_count,
         updated_at = CURRENT_TIMESTAMP`,
      [
        leadId, sourceDealer.id, snapshot.vehicle_type, normalizeDownPayment(snapshot.down_payment), snapshot.identification,
        snapshot.bank_account, snapshot.purchase_timeline, snapshot.documents, location.easterns_zone || '', assignedDealerId,
        current?.routing_override ?? false, routingReason, reengagement || current?.status !== 'sent' ? 'pending' : 'sent', messageText, hasUnhandledReengagement, reengagement, reengagement ? 1 : 0,
      ],
    );
  }
}
