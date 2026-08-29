import {
  BadRequestException,
  Injectable,
  Optional,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { LeadWebhookDto, LeadWebhookSchema } from '@dealeradmin/contracts';
import { createHash } from 'node:crypto';
import { DataSource } from 'typeorm';
import { buildWhatsAppMessage, normalizePurchaseTimeline } from '../../leads/domain/message-builder';
import { normalizePhone } from '../../leads/domain/phone-normalizer';
import { normalizeDownPayment } from '../../leads/domain/down-payment';
import { applyTestWebhookLead } from '../../leads/application/test-lead-store';
import { GeoroutingService } from '../../routing/domain/services/georouting.service';

type PersistedWebhookResponse = {
  accepted: true;
  eventId: string;
  status: 'processed' | 'duplicate_ignored';
};

type TestWebhookResponse = {
  accepted: true;
  eventId: string;
};

type WebhookResponse = PersistedWebhookResponse | TestWebhookResponse;
type LeadRow = { id: string };
type DealerRow = { id: string };
type EventRow = { event_id: string };
type LeadDealerRow = {
  vehicle_type: string | null;
  down_payment: string | null;
  identification: string | null;
  bank_account: string | null;
  purchase_timeline: string | null;
  documents: string | null;
  easterns_zone: string | null;
  status: string;
  routing_status: string;
  assigned_dealer_id: string | null;
  routing_override: boolean;
  routing_reason: string | null;
};

@Injectable()
export class WebhookService {
  constructor(
    @Optional() private readonly dataSource?: DataSource,
    @Optional() private readonly georoutingService?: GeoroutingService,
  ) {}

  async acceptLead(payload: unknown, rawBody?: string): Promise<WebhookResponse> {
    const lead = LeadWebhookSchema.safeParse(payload);
    if (!lead.success) {
      throw new UnprocessableEntityException({ code: 'INVALID_LEAD_PAYLOAD', issues: lead.error.issues });
    }

    if (!this.dataSource && process.env.NODE_ENV === 'test') {
      applyTestWebhookLead(lead.data);
      return { accepted: true, eventId: lead.data.event_id };
    }

    if (!this.dataSource) {
      throw new ServiceUnavailableException('Database connection is not available');
    }

    return this.processWebhook(lead.data, rawBody ?? JSON.stringify(lead.data));
  }

  private async processWebhook(payload: LeadWebhookDto, rawBody: string): Promise<PersistedWebhookResponse> {
    const queryRunner = this.dataSource!.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const payloadHash = createHash('sha256').update(rawBody).digest('hex');
      const insertedEvents = (await queryRunner.query(
        `INSERT INTO webhook_events
          (event_id, event_type, ghl_location_id, status, payload_hash, received_at)
         VALUES ($1, $2, $3, 'pending', $4, CURRENT_TIMESTAMP)
         ON CONFLICT (event_id) DO NOTHING
         RETURNING event_id`,
        [payload.event_id, payload.event_type, payload.ghl_location_id, payloadHash],
      )) as EventRow[];

      if (insertedEvents.length === 0) {
        await queryRunner.rollbackTransaction();
        return { accepted: true, eventId: payload.event_id, status: 'duplicate_ignored' };
      }

      let dealers = (await queryRunner.query(
        `SELECT id
         FROM dealers
         WHERE ghl_location_id = $1 AND active = true
         LIMIT 1`,
        [payload.ghl_location_id],
      )) as DealerRow[];

      const isEasternsPayload =
        payload.dealer_name.toLowerCase().includes('easterns') || Boolean(payload.lead.easterns_zone?.trim());
      if (dealers.length === 0 && isEasternsPayload) {
        dealers = (await queryRunner.query(
          `SELECT id
           FROM dealers
           WHERE routing_config->>'group' = 'Easterns' AND active = true
           ORDER BY code ASC
           LIMIT 1`,
        )) as DealerRow[];
      }

      if (dealers.length === 0) {
        throw new BadRequestException(`Dealer con Location ID ${payload.ghl_location_id} no encontrado o inactivo`);
      }

      let canonicalPhone: string;
      try {
        canonicalPhone = normalizePhone(payload.lead.phone);
      } catch {
        throw new BadRequestException('El teléfono no tiene un formato válido');
      }

      const leads = (await queryRunner.query(
        `SELECT id
         FROM leads
         WHERE canonical_phone = $1
            OR (ghl_contact_id = $2 AND ghl_location_id = $3)
         ORDER BY CASE WHEN canonical_phone = $1 THEN 0 ELSE 1 END
         LIMIT 1
         FOR UPDATE`,
        [canonicalPhone, payload.ghl_contact_id, payload.ghl_location_id],
      )) as LeadRow[];

      const nameParts = payload.lead.name.trim().split(/\s+/).filter(Boolean);
      const firstName = nameParts[0] ?? 'Lead';
      const lastName = nameParts.slice(1).join(' ');
      let leadId: string;

      if (leads.length === 0) {
        const insertedLeads = (await queryRunner.query(
          `INSERT INTO leads
            (canonical_phone, first_name, last_name, ghl_contact_id, ghl_location_id, source)
           VALUES ($1, $2, $3, $4, $5, 'GHL Webhook')
           RETURNING id`,
          [canonicalPhone, firstName, lastName, payload.ghl_contact_id, payload.ghl_location_id],
        )) as LeadRow[];
        leadId = insertedLeads[0].id;
      } else {
        leadId = leads[0].id;
        await queryRunner.query(
          `UPDATE leads
           SET canonical_phone = $1,
               first_name = $2,
               last_name = $3,
               ghl_contact_id = $4,
               ghl_location_id = $5,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $6`,
          [canonicalPhone, firstName, lastName, payload.ghl_contact_id, payload.ghl_location_id, leadId],
        );
      }

      const currentLeadDealers = (await queryRunner.query(
        `SELECT status, routing_status, assigned_dealer_id, routing_override, routing_reason,
                vehicle_type, down_payment, identification, bank_account, purchase_timeline, documents, easterns_zone
         FROM lead_dealers
         WHERE lead_id = $1
         FOR UPDATE`,
        [leadId],
      )) as LeadDealerRow[];
      const currentLeadDealer = currentLeadDealers[0];
      const identification = payload.lead.identification ?? payload.lead.id_number ?? payload.lead.id ?? '';
      const purchaseTimeline = normalizePurchaseTimeline(payload.lead.purchase_timeline) ?? '';
      const messageText = buildWhatsAppMessage(payload.lead.name, canonicalPhone, {
        ...payload.lead,
        vehicle_type: payload.lead.vehicle_type?.trim() || currentLeadDealer?.vehicle_type || '',
        down_payment: normalizeDownPayment(payload.lead.down_payment) || currentLeadDealer?.down_payment || '',
        identification: identification.trim() || currentLeadDealer?.identification || '',
        bank_account: payload.lead.bank_account?.trim() || currentLeadDealer?.bank_account || '',
        purchase_timeline: payload.lead.purchase_timeline?.trim() || currentLeadDealer?.purchase_timeline || '',
        documents: payload.lead.documents?.trim() || currentLeadDealer?.documents || '',
      });
      const isAlreadySent = currentLeadDealer?.status === 'sent';
      const routing = isEasternsPayload
        ? await this.georoutingService?.resolveDealer(payload.lead, queryRunner)
        : { dealerId: dealers[0].id, reason: 'Source dealer from GHL location' };
      if (!routing) throw new ServiceUnavailableException('Georouting service is not available');
      const hasPersistentAssignment = Boolean(currentLeadDealer?.assigned_dealer_id);
      const preservesAssignment = Boolean(currentLeadDealer?.routing_override || isAlreadySent || hasPersistentAssignment);
      const targetDealerId = preservesAssignment
        ? currentLeadDealer?.assigned_dealer_id || routing.dealerId
        : routing.dealerId;
      const targetStatus = currentLeadDealer?.status || 'pending';
      const targetRoutingStatus = preservesAssignment ? currentLeadDealer?.routing_status || 'resolved' : 'resolved';
      const targetRoutingOverride = currentLeadDealer?.routing_override ?? false;
      const targetRoutingReason = preservesAssignment
        ? currentLeadDealer?.routing_reason || routing.reason
        : routing.reason;

      await queryRunner.query(
        `INSERT INTO lead_dealers
          (lead_id, dealer_id, vehicle_type, down_payment, identification, bank_account, purchase_timeline, documents,
           easterns_zone, assigned_dealer_id, routing_override, routing_reason, routing_status, status, message_text, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, CURRENT_TIMESTAMP)
         ON CONFLICT (lead_id, dealer_id) DO UPDATE SET
           vehicle_type = COALESCE(NULLIF(EXCLUDED.vehicle_type, ''), lead_dealers.vehicle_type),
           down_payment = COALESCE(NULLIF(EXCLUDED.down_payment, ''), lead_dealers.down_payment),
           identification = COALESCE(NULLIF(EXCLUDED.identification, ''), lead_dealers.identification),
           bank_account = COALESCE(NULLIF(EXCLUDED.bank_account, ''), lead_dealers.bank_account),
           purchase_timeline = COALESCE(NULLIF(EXCLUDED.purchase_timeline, ''), lead_dealers.purchase_timeline),
           documents = COALESCE(NULLIF(EXCLUDED.documents, ''), lead_dealers.documents),
           easterns_zone = COALESCE(NULLIF(EXCLUDED.easterns_zone, ''), lead_dealers.easterns_zone),
           assigned_dealer_id = CASE
             WHEN lead_dealers.status = 'sent' OR lead_dealers.routing_override = true
             THEN lead_dealers.assigned_dealer_id ELSE EXCLUDED.assigned_dealer_id END,
           routing_override = CASE WHEN lead_dealers.status = 'sent' THEN lead_dealers.routing_override ELSE EXCLUDED.routing_override END,
           routing_reason = CASE
             WHEN lead_dealers.status = 'sent' OR lead_dealers.routing_override = true
             THEN lead_dealers.routing_reason ELSE EXCLUDED.routing_reason END,
           routing_status = CASE WHEN lead_dealers.status = 'sent' THEN lead_dealers.routing_status ELSE EXCLUDED.routing_status END,
           status = CASE WHEN lead_dealers.status = 'sent' THEN 'sent' ELSE EXCLUDED.status END,
           message_text = EXCLUDED.message_text,
           updated_at = CURRENT_TIMESTAMP`,
        [
          leadId,
          dealers[0].id,
          payload.lead.vehicle_type?.trim() || '',
          normalizeDownPayment(payload.lead.down_payment),
          identification.trim(),
          payload.lead.bank_account?.trim() || '',
          purchaseTimeline,
          payload.lead.documents?.trim() || '',
          payload.lead.easterns_zone?.trim() || '',
          targetDealerId,
          targetRoutingOverride,
          targetRoutingReason,
          targetRoutingStatus,
          targetStatus,
          messageText,
        ],
      );

      await queryRunner.query(
        `UPDATE webhook_events
         SET status = 'processed', processed_at = CURRENT_TIMESTAMP, error_code = NULL
         WHERE event_id = $1`,
        [payload.event_id],
      );

      await queryRunner.commitTransaction();
      return { accepted: true, eventId: payload.event_id, status: 'processed' };
    } catch (error) {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }
      await this.recordFailedEvent(payload, rawBody, error);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  private async recordFailedEvent(payload: LeadWebhookDto, rawBody: string, error: unknown): Promise<void> {
    const errorCode = error instanceof Error ? error.message.slice(0, 250) : 'UNKNOWN_ERROR';
    try {
      await this.dataSource!.query(
        `INSERT INTO webhook_events
          (event_id, event_type, ghl_location_id, status, error_code, payload_hash, received_at)
         VALUES ($1, $2, $3, 'failed', $4, $5, CURRENT_TIMESTAMP)
         ON CONFLICT (event_id) DO UPDATE SET
           status = 'failed', error_code = EXCLUDED.error_code,
           payload_hash = EXCLUDED.payload_hash`,
        [payload.event_id, payload.event_type, payload.ghl_location_id, errorCode, createHash('sha256').update(rawBody).digest('hex')],
      );
    } catch {
      // El registro de la falla no debe reemplazar el error de procesamiento original.
    }
  }
}
