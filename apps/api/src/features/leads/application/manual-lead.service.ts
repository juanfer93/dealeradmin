import { CreateManualLeadDto } from '@dealeradmin/contracts';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { DataSource } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { buildManualLeadMessage } from '../domain/manual-message-builder';
import { normalizePhone } from '../domain/phone-normalizer';
import { addTestManualLead, getTestDealer } from './test-lead-store';

type DealerRow = { id: string; ghl_location_id: string };
type LeadRow = { id: string };

function clean(value: string): string {
  return value.trim();
}

@Injectable()
export class ManualLeadService {
  constructor(@Optional() @InjectDataSource() private readonly dataSource?: DataSource) {}

  async execute(dealerId: string, dto: CreateManualLeadDto): Promise<{ success: true; leadId: string; message: string }> {
    const name = clean(dto.name);
    if (!name) throw new BadRequestException('El nombre es obligatorio');

    let canonicalPhone: string;
    try {
      canonicalPhone = normalizePhone(dto.phone);
    } catch {
      throw new BadRequestException('El teléfono no tiene un formato válido');
    }

    const messageText = buildManualLeadMessage(name, canonicalPhone, dto);

    if (!this.dataSource && process.env.NODE_ENV === 'test') {
      const dealer = getTestDealer(dealerId);
      if (!dealer) throw new NotFoundException('Dealer no encontrado o inactivo');
      const lead = addTestManualLead(dealerId, dto, canonicalPhone, messageText);
      return { success: true, leadId: lead.id, message: 'Lead manual agregado correctamente.' };
    }

    if (!this.dataSource) {
      throw new ServiceUnavailableException('Database connection is not available');
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const dealers = (await queryRunner.query(
        `SELECT id, ghl_location_id
         FROM dealers
         WHERE id = $1 AND active = true
         LIMIT 1`,
        [dealerId],
      )) as DealerRow[];
      if (dealers.length === 0) throw new NotFoundException('Dealer no encontrado o inactivo');

      const dealer = dealers[0];
      const names = name.split(/\s+/).filter(Boolean);
      const firstName = names[0] ?? 'Lead';
      const lastName = names.slice(1).join(' ');
      const existingLeads = (await queryRunner.query(
        `SELECT id
         FROM leads
         WHERE canonical_phone = $1
         LIMIT 1
         FOR UPDATE`,
        [canonicalPhone],
      )) as LeadRow[];

      let leadId: string;
      if (existingLeads.length === 0) {
        const insertedLeads = (await queryRunner.query(
          `INSERT INTO leads
            (canonical_phone, first_name, last_name, ghl_contact_id, ghl_location_id, source)
           VALUES ($1, $2, $3, $4, $5, 'Manual Console')
           RETURNING id`,
          [
            canonicalPhone,
            firstName,
            lastName,
            `manual_${randomBytes(4).toString('hex')}`,
            dealer.ghl_location_id,
          ],
        )) as LeadRow[];
        leadId = insertedLeads[0].id;
      } else {
        leadId = existingLeads[0].id;
        await queryRunner.query(
          `UPDATE leads
           SET first_name = $1, last_name = $2, updated_at = CURRENT_TIMESTAMP
           WHERE id = $3`,
          [firstName, lastName, leadId],
        );
      }

      await queryRunner.query(
        `INSERT INTO lead_dealers
          (lead_id, dealer_id, vehicle_type, down_payment, purchase_timeline, documents,
           identification, bank_account, routing_status, status, message_text, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'manual', 'pending', $9, CURRENT_TIMESTAMP)
         ON CONFLICT (lead_id, dealer_id) DO UPDATE SET
           vehicle_type = EXCLUDED.vehicle_type,
           down_payment = EXCLUDED.down_payment,
           purchase_timeline = EXCLUDED.purchase_timeline,
           documents = EXCLUDED.documents,
           identification = EXCLUDED.identification,
           bank_account = EXCLUDED.bank_account,
           routing_status = CASE WHEN lead_dealers.status = 'sent' THEN lead_dealers.routing_status ELSE EXCLUDED.routing_status END,
           status = CASE WHEN lead_dealers.status = 'sent' THEN 'sent' ELSE EXCLUDED.status END,
           message_text = EXCLUDED.message_text,
           updated_at = CURRENT_TIMESTAMP`,
        [
          leadId,
          dealer.id,
          dto.vehicle_type.trim(),
          dto.down_payment.trim(),
          dto.purchase_timeline.trim(),
          dto.documents.trim(),
          dto.identification.trim(),
          dto.bank_account.trim(),
          messageText,
        ],
      );

      await queryRunner.commitTransaction();
      return { success: true, leadId, message: 'Lead manual agregado correctamente.' };
    } catch (error) {
      if (queryRunner.isTransactionActive) await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}
