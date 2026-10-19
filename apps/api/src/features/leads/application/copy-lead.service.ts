import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { normalizeLeadName } from '../domain/lead-duplicate';
import { buildWhatsAppMessage } from '../domain/message-builder';
import { visibleDownPayment } from '../domain/down-payment';

type LeadCopyInput = { sourceDealerId: string; targetDealerId: string };
type LeadCopyResult = { success: true; leadId: string; sourceDealerId: string; targetDealerId: string };
type SourceRow = {
  lead_id: string;
  source_dealer_id: string;
  source_dealer_name: string;
  first_name: string | null;
  last_name: string | null;
  canonical_phone: string | null;
  vehicle_type: string | null;
  down_payment: string | null;
  purchase_timeline: string | null;
  documents: string | null;
  identification: string | null;
  bank_account: string | null;
  easterns_zone: string | null;
  message_text: string | null;
};

@Injectable()
export class CopyLeadService {
  constructor(@Optional() @InjectDataSource() private readonly dataSource?: DataSource) {}

  async execute(leadId: string, input: LeadCopyInput): Promise<LeadCopyResult> {
    if (!input.sourceDealerId || !input.targetDealerId) {
      throw new BadRequestException('El dealer origen y el dealer destino son obligatorios');
    }
    if (input.sourceDealerId === input.targetDealerId) {
      throw new BadRequestException('El dealer destino debe ser diferente al dealer origen');
    }
    if (!this.dataSource) throw new ServiceUnavailableException('Database connection is not available');

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const sourceRows = (await queryRunner.query(
        `SELECT
           ld.lead_id,
           d.id AS source_dealer_id,
           d.name AS source_dealer_name,
           l.first_name,
           l.last_name,
           COALESCE(NULLIF(l.canonical_phone, ''), (
             SELECT NULLIF(c_phone.qualification_snapshot->>'phone', '')
             FROM conversations c_phone
             WHERE c_phone.lead_id = l.id
               AND NULLIF(c_phone.qualification_snapshot->>'phone', '') IS NOT NULL
             ORDER BY c_phone.last_message_at DESC NULLS LAST, c_phone.created_at DESC
             LIMIT 1
           )) AS canonical_phone,
           ld.vehicle_type,
           ld.down_payment,
           ld.purchase_timeline,
           ld.documents,
           ld.identification,
           ld.bank_account,
           ld.easterns_zone,
           ld.message_text
         FROM lead_dealers ld
         INNER JOIN leads l ON l.id = ld.lead_id
         INNER JOIN dealers d ON d.id = COALESCE(ld.assigned_dealer_id, ld.dealer_id)
         WHERE ld.lead_id = $1
           AND COALESCE(ld.assigned_dealer_id, ld.dealer_id) = $2
           AND d.active = true
         FOR UPDATE OF ld, l`,
        [leadId, input.sourceDealerId],
      )) as SourceRow[];
      if (sourceRows.length === 0) throw new NotFoundException('Lead origen no encontrado en el dealer seleccionado');

      const source = sourceRows[0];
      const sourceName = [source.first_name, source.last_name].filter(Boolean).join(' ').trim();
      const targetRows = (await queryRunner.query(
        `SELECT id, name
         FROM dealers
         WHERE id = $1 AND active = true
         LIMIT 1`,
        [input.targetDealerId],
      )) as Array<{ id: string; name: string }>;
      if (targetRows.length === 0) throw new NotFoundException('Dealer destino no encontrado o inactivo');

      await queryRunner.query(
        `SELECT pg_advisory_xact_lock(hashtext($1))`,
        [`dealer-lead:${input.targetDealerId}:${source.canonical_phone ?? ''}`],
      );
      const duplicateRows = (await queryRunner.query(
        `SELECT l.id
         FROM leads l
         INNER JOIN lead_dealers ld ON ld.lead_id = l.id
         WHERE l.id <> $1
           AND COALESCE(ld.assigned_dealer_id, ld.dealer_id) = $3
           AND l.canonical_phone IS NOT NULL
           AND l.canonical_phone = $2
           AND LOWER(REGEXP_REPLACE(TRIM(CONCAT_WS(' ', l.first_name, l.last_name)), '\\s+', ' ', 'g')) = $4
           LIMIT 1`,
        [leadId, source.canonical_phone, input.targetDealerId, normalizeLeadName(sourceName)],
      )) as Array<{ id: string }>;
      if (duplicateRows.length > 0) {
        throw new ConflictException('No se puede copiar: ya existe un lead con el mismo nombre y teléfono en el dealer destino.');
      }

      const targetRelationship = (await queryRunner.query(
        `SELECT 1 AS exists
         FROM lead_dealers
         WHERE lead_id = $1
           AND COALESCE(assigned_dealer_id, dealer_id) = $2
         LIMIT 1`,
        [leadId, input.targetDealerId],
      )) as Array<{ exists: number }>;
      if (targetRelationship.length > 0) {
        throw new ConflictException('No se puede copiar: este lead ya está registrado en el dealer destino.');
      }

      const sourceDownPayment = visibleDownPayment(source.down_payment, source.source_dealer_name);
      const copiedDownPayment = visibleDownPayment(sourceDownPayment, targetRows[0].name);
      const copiedMessage = copiedDownPayment
        ? source.message_text
        : buildWhatsAppMessage(sourceName || 'Lead', source.canonical_phone ?? '', {
          vehicle_type: source.vehicle_type,
          down_payment: copiedDownPayment,
          purchase_timeline: source.purchase_timeline,
          documents: source.documents,
          identification: source.identification,
          bank_account: source.bank_account,
          dealer_name: targetRows[0].name,
        });

      await queryRunner.query(
        `INSERT INTO lead_dealers (
           lead_id, dealer_id, vehicle_type, down_payment, purchase_timeline, documents,
           identification, bank_account, easterns_zone, routing_status, assigned_dealer_id,
           routing_override, routing_reason, status, message_text, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'manual', $2, true, $10, 'pending', $11, CURRENT_TIMESTAMP)`,
        [
          leadId,
          input.targetDealerId,
          source.vehicle_type,
          copiedDownPayment,
          source.purchase_timeline,
          source.documents,
          source.identification,
          source.bank_account,
          source.easterns_zone,
          `Copied from ${source.source_dealer_name}`,
          copiedMessage,
        ],
      );

      await queryRunner.commitTransaction();
      return { success: true, leadId, sourceDealerId: source.source_dealer_id, targetDealerId: targetRows[0].id };
    } catch (error) {
      if (queryRunner.isTransactionActive) await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}
