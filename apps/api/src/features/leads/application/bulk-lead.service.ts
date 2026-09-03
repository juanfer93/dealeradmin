import { BadRequestException, Injectable, NotFoundException, Optional, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { buildManualLeadMessage } from '../domain/manual-message-builder';
import { normalizeDownPayment } from '../domain/down-payment';
import { parseBulkLeads, ParsedBulkLead } from '../domain/bulk-lead-parser';
import { findDealerLeadDuplicate } from '../domain/lead-duplicate';
import { addTestManualLead, getTestDealer, hasTestDealerLeadDuplicate } from './test-lead-store';

type DealerRow = { id: string; ghl_location_id: string };
type LeadRow = { id: string; first_name?: string | null; last_name?: string | null; canonical_phone?: string | null };
type BulkRowResult = { rowNumber: number; name: string; phone: string; status: 'inserted' | 'duplicate' | 'invalid'; reason?: string; leadId?: string };

function duplicateReason(name: string, phone: string, existing?: LeadRow): string {
  const existingName = [existing?.first_name, existing?.last_name].filter(Boolean).join(' ').trim();
  const existingLead = existingName ? ` Lead existente: ${existingName} · ${existing?.canonical_phone ?? phone}.` : '';
  return `No se puede subir ${name} con ${phone} porque el teléfono ya pertenece a un lead repetido.${existingLead}`;
}

function lineHash(line: string): string {
  return createHash('sha256').update(line).digest('hex');
}

function emptySummary(received: number) {
  return { received, inserted: 0, duplicates: 0, invalid: 0 };
}

@Injectable()
export class BulkLeadService {
  constructor(@Optional() @InjectDataSource() private readonly dataSource?: DataSource) {}

  async execute(dealerId: string, text: string) {
    const parsed = parseBulkLeads(text);
    if (parsed.length === 0) throw new BadRequestException('Pega al menos un lead, uno por línea.');
    if (parsed.length > 500) throw new BadRequestException('El máximo por carga es de 500 leads.');

    if (!this.dataSource && process.env.NODE_ENV === 'test') return this.executeTest(dealerId, parsed);
    if (!this.dataSource) throw new ServiceUnavailableException('Database connection is not available');

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    const batchId = randomUUID();
    const summary = emptySummary(parsed.length);
    const rows: BulkRowResult[] = [];

    try {
      const dealers = await queryRunner.query(
        `SELECT id, ghl_location_id FROM dealers WHERE id = $1 AND active = true LIMIT 1`,
        [dealerId],
      ) as DealerRow[];
      if (!dealers.length) throw new NotFoundException('Dealer no encontrado o inactivo');
      const dealer = dealers[0];

      await queryRunner.query(
        `INSERT INTO lead_ingestion_batches (id, dealer_id, source, input_hash, total_rows, status)
         VALUES ($1, $2, 'operator_bulk_textarea', $3, $4, 'processing')`,
        [batchId, dealer.id, createHash('sha256').update(text).digest('hex'), parsed.length],
      );

      for (const item of parsed) {
        const result = await this.persistProductionRow(queryRunner, dealer, item, batchId);
        rows.push(result);
        summary[result.status === 'inserted' ? 'inserted' : result.status === 'duplicate' ? 'duplicates' : 'invalid'] += 1;
      }

      await queryRunner.query(
        `UPDATE lead_ingestion_batches
         SET inserted_rows = $2, duplicate_rows = $3, invalid_rows = $4,
             status = 'completed', completed_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [batchId, summary.inserted, summary.duplicates, summary.invalid],
      );
      await queryRunner.commitTransaction();
      return { success: true, batchId, summary, rows };
    } catch (error) {
      if (queryRunner.isTransactionActive) await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  private executeTest(dealerId: string, parsed: ParsedBulkLead[]) {
    const dealer = getTestDealer(dealerId);
    if (!dealer) throw new NotFoundException('Dealer no encontrado o inactivo');
    const batchId = `batch-test-${randomUUID()}`;
    const summary = emptySummary(parsed.length);
    const rows: BulkRowResult[] = [];
    for (const item of parsed) {
      if (item.error || !item.dto) {
        summary.invalid += 1;
        rows.push({ rowNumber: item.rowNumber, name: item.name, phone: item.phone, status: 'invalid', reason: item.error ?? 'Datos inválidos.' });
        continue;
      }
      if (hasTestDealerLeadDuplicate(dealer.id, item.dto.name, item.dto.phone)) {
        summary.duplicates += 1;
        rows.push({ rowNumber: item.rowNumber, name: item.dto.name, phone: item.dto.phone, status: 'duplicate', reason: duplicateReason(item.dto.name, item.dto.phone) });
        continue;
      }
      const lead = addTestManualLead(dealer.id, item.dto, item.dto.phone, buildManualLeadMessage(item.dto.name, item.dto.phone, item.dto));
      summary.inserted += 1;
      rows.push({ rowNumber: item.rowNumber, name: lead.name, phone: lead.phone, status: 'inserted', leadId: lead.id });
    }
    return { success: true, batchId, summary, rows };
  }

  private async persistProductionRow(queryRunner: any, dealer: DealerRow, item: ParsedBulkLead, _batchId: string): Promise<BulkRowResult> {
    if (item.error || !item.dto) {
      await this.recordRow(queryRunner, _batchId, item, 'invalid', item.error ?? 'Datos inválidos.');
      return { rowNumber: item.rowNumber, name: item.name, phone: item.phone, status: 'invalid', reason: item.error ?? 'Datos inválidos.' };
    }

    const duplicate = await findDealerLeadDuplicate(queryRunner, dealer.id, item.dto.name, item.dto.phone);
    if (duplicate) {
      const reason = duplicateReason(item.dto.name, item.dto.phone, duplicate);
      await this.recordRow(queryRunner, _batchId, item, 'duplicate', reason, duplicate.id);
      return { rowNumber: item.rowNumber, name: item.dto.name, phone: item.dto.phone, status: 'duplicate', reason, leadId: duplicate.id };
    }

    const names = item.dto.name.trim().split(/\s+/).filter(Boolean);
    const existing = await queryRunner.query(
      `SELECT id, first_name, last_name, canonical_phone
       FROM leads
       WHERE canonical_phone = $1
       LIMIT 1
       FOR UPDATE`,
      [item.dto.phone],
    ) as LeadRow[];
    if (existing.length) {
      const reason = duplicateReason(item.dto.name, item.dto.phone, existing[0]);
      await this.recordRow(queryRunner, _batchId, item, 'duplicate', reason, existing[0].id);
      return { rowNumber: item.rowNumber, name: item.dto.name, phone: item.dto.phone, status: 'duplicate', reason, leadId: existing[0].id };
    }
    let leadId: string;
    const inserted = await queryRunner.query(
      `INSERT INTO leads (canonical_phone, first_name, last_name, ghl_contact_id, ghl_location_id, source)
       VALUES ($1, $2, $3, $4, $5, 'Manual Bulk Console') RETURNING id`,
      [item.dto.phone, names[0], names.slice(1).join(' '), `bulk_${randomBytes(4).toString('hex')}`, dealer.ghl_location_id],
    ) as LeadRow[];
    leadId = inserted[0].id;
    const message = buildManualLeadMessage(item.dto.name, item.dto.phone, item.dto);
    await queryRunner.query(
      `INSERT INTO lead_dealers
        (lead_id, dealer_id, vehicle_type, down_payment, purchase_timeline, documents, identification,
         bank_account, assigned_dealer_id, routing_override, routing_reason, routing_status, status, message_text, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $2, true, 'Manual bulk console assignment', 'manual', 'pending', $9, CURRENT_TIMESTAMP)
       ON CONFLICT (lead_id, dealer_id) DO UPDATE SET
         vehicle_type = EXCLUDED.vehicle_type, down_payment = EXCLUDED.down_payment,
         purchase_timeline = EXCLUDED.purchase_timeline, documents = EXCLUDED.documents,
         identification = EXCLUDED.identification, bank_account = EXCLUDED.bank_account,
         status = CASE WHEN lead_dealers.status = 'sent' THEN 'sent' ELSE 'pending' END,
         message_text = EXCLUDED.message_text, updated_at = CURRENT_TIMESTAMP`,
      [leadId, dealer.id, item.dto.vehicle_type, normalizeDownPayment(item.dto.down_payment), item.dto.purchase_timeline, item.dto.documents, item.dto.identification, item.dto.bank_account, message],
    );
    await this.recordRow(queryRunner, _batchId, item, 'inserted', undefined, leadId);
    return { rowNumber: item.rowNumber, name: item.dto.name, phone: item.dto.phone, status: 'inserted', leadId };
  }

  private async recordRow(queryRunner: any, batchId: string, item: ParsedBulkLead, status: string, reason?: string, leadId?: string) {
    await queryRunner.query(
      `INSERT INTO lead_ingestion_rows (batch_id, row_number, source_line_hash, parsed_name, parsed_phone, status, reason, lead_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [batchId, item.rowNumber, lineHash(item.rawLine), item.name || null, item.phone || null, status, reason ?? null, leadId ?? null],
    );
  }
}
