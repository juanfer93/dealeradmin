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
           l.canonical_phone,
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
      const targetRows = (await queryRunner.query(
        `SELECT id, name
         FROM dealers
         WHERE id = $1 AND active = true
         LIMIT 1`,
        [input.targetDealerId],
      )) as Array<{ id: string; name: string }>;
      if (targetRows.length === 0) throw new NotFoundException('Dealer destino no encontrado o inactivo');

      const duplicateRows = (await queryRunner.query(
        `SELECT l.id
         FROM leads l
         WHERE l.id <> $1
           AND l.canonical_phone IS NOT NULL
           AND l.canonical_phone = $2
           AND LOWER(TRIM(CONCAT_WS(' ', l.first_name, l.last_name))) = LOWER(TRIM($3))
         LIMIT 1`,
        [leadId, source.canonical_phone, [source.first_name, source.last_name].filter(Boolean).join(' ')],
      )) as Array<{ id: string }>;
      if (duplicateRows.length > 0) {
        throw new ConflictException('No se puede copiar: ya existe un lead con el mismo nombre y teléfono en la base de datos.');
      }

      const targetRelationship = (await queryRunner.query(
        `SELECT 1 AS exists
         FROM lead_dealers
         WHERE lead_id = $1
           AND (dealer_id = $2 OR assigned_dealer_id = $2)
         LIMIT 1`,
        [leadId, input.targetDealerId],
      )) as Array<{ exists: number }>;
      if (targetRelationship.length > 0) {
        throw new ConflictException('No se puede copiar: este lead ya está registrado en el dealer destino.');
      }

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
          source.down_payment,
          source.purchase_timeline,
          source.documents,
          source.identification,
          source.bank_account,
          source.easterns_zone,
          `Copied from ${source.source_dealer_name}`,
          source.message_text,
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
