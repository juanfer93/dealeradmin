import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
  Optional,
} from '@nestjs/common';
import type { Request } from 'express';
import { DataSource } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { UpdateLeadSchema, type UpdateLeadDto } from '@dealeradmin/contracts';
import { AuthService } from '../../auth/application/auth.service';
import { copyTestLead, deleteTestLead, getTestManualLeads, isTestLeadDeleted, testDealers, testLead, smartMergeTestLead, easternsTestLead, updateTestLeadStatus, reassignTestLead, updateTestLead } from '../application/test-lead-store';
import { CopyLeadService } from '../application/copy-lead.service';
import { EASTERN_DEALER_IDS } from '../../routing/domain/services/georouting.service';
import { buildManualLeadMessage } from '../domain/manual-message-builder';
import { normalizeDownPayment } from '../domain/down-payment';
import { normalizePhone } from '../domain/phone-normalizer';
import { findDealerLeadDuplicate } from '../domain/lead-duplicate';

type LeadStatus = 'pending' | 'sent';

type StatusBody = { status?: unknown; dealerId?: unknown };
type ReassignBody = { currentDealerId?: unknown; targetDealerId?: unknown };
type CopyBody = { sourceDealerId?: unknown; targetDealerId?: unknown };
type EditLeadBody = UpdateLeadDto & { dealerId?: unknown };

@Controller('leads')
export class LeadsController {
  constructor(
    @Optional() @InjectDataSource() private readonly dataSource: DataSource | undefined,
    private readonly authService: AuthService,
    private readonly copyLeadService: CopyLeadService,
  ) {}

  @Get()
  async list(
    @Req() request: Request,
    @Query('status') statusQuery?: string,
    @Query('dealerId') dealerId?: string,
    @Query('dealerIds') dealerIdsQuery?: string,
  ) {
    this.requireSession(request);
    const status = this.parseStatus(statusQuery);

    if (process.env.NODE_ENV === 'test') {
      const selectedDealerIds = dealerIdsQuery?.split(',').filter(Boolean) ?? (dealerId ? [dealerId] : undefined);
      const matchesDealer = (leadDealerId: string) => !selectedDealerIds || selectedDealerIds.includes(leadDealerId);
      const manualLeads = getTestManualLeads().filter((lead) =>
        status === lead.status && matchesDealer(lead.dealerId),
      );
      const fixedLeads = [testLead, smartMergeTestLead, easternsTestLead].filter((lead) =>
        !isTestLeadDeleted(lead.id) && status === lead.status && matchesDealer(lead.dealerId),
      );
      const leads = [...fixedLeads, ...manualLeads];
      return { dealers: testDealers, leads };
    }

    if (!this.dataSource) {
      throw new UnauthorizedException('Lead data is unavailable');
    }

    const selectedDealerIds = dealerIdsQuery?.split(',').filter(Boolean) ?? (dealerId ? [dealerId] : undefined);
    const dealerFilter = selectedDealerIds?.length ? 'AND d.id = ANY($2::uuid[])' : '';
    const params = selectedDealerIds?.length ? [status, selectedDealerIds] : [status];
    const leads = await this.dataSource.query(
      `SELECT
         ld.lead_id AS id,
         d.id AS "dealerId",
         d.name AS "dealerName",
         CONCAT_WS(' ', l.first_name, l.last_name) AS name,
         l.canonical_phone AS phone,
         ld.vehicle_type AS "vehicleType",
         ld.down_payment AS "downPayment",
         ld.identification,
         ld.bank_account AS "bankAccount",
         ld.documents,
         ld.purchase_timeline AS "purchaseTimeline",
         ld.status,
         ld.message_text AS "messageText",
         ld.created_at AS "createdAt",
         ld.routing_override AS "routingOverride",
         ld.routing_reason AS "routingReason"
       FROM lead_dealers ld
       INNER JOIN leads l ON l.id = ld.lead_id
       INNER JOIN dealers d ON d.id = COALESCE(ld.assigned_dealer_id, ld.dealer_id)
       WHERE ld.status = $1 ${dealerFilter}
       ORDER BY ld.created_at ASC`,
      params,
    );

    const dealers = await this.dataSource.query(
      `SELECT
         d.id,
         d.code,
         d.name,
         COUNT(ld.lead_id) FILTER (WHERE ld.status = 'pending')::int AS "pendingCount"
       FROM dealers d
       LEFT JOIN lead_dealers ld ON COALESCE(ld.assigned_dealer_id, ld.dealer_id) = d.id
       WHERE d.active = true
       GROUP BY d.id, d.code, d.name
       ORDER BY d.name ASC`,
    );

    return { dealers, leads };
  }

  @Patch(':id/status')
  async updateStatus(
    @Req() request: Request,
    @Param('id') leadId: string,
    @Body() body: StatusBody,
  ) {
    this.requireSession(request);
    if (body.status !== 'sent') {
      throw new BadRequestException('Only the sent status is supported by the operator queue');
    }
    if (typeof body.dealerId !== 'string' || !body.dealerId) {
      throw new BadRequestException('Dealer is required to update the lead relationship');
    }

    if (process.env.NODE_ENV === 'test') {
      updateTestLeadStatus(leadId, 'sent');
      return { success: true };
    }

    if (!this.dataSource) {
      throw new UnauthorizedException('Lead data is unavailable');
    }

    const result = await this.dataSource.query(
      `UPDATE lead_dealers
       SET status = 'sent', sent_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE lead_id = $1 AND COALESCE(assigned_dealer_id, dealer_id) = $2 AND status = 'pending'`,
      [leadId, body.dealerId],
    );
    if (result.length === 0) {
      throw new BadRequestException('Lead not found or already sent');
    }
    return { success: true };
  }

  @Patch(':id')
  async updateLead(
    @Req() request: Request,
    @Param('id') leadId: string,
    @Body() body: unknown,
  ) {
    this.requireSession(request);
    const input = (typeof body === 'object' && body !== null ? body : {}) as Partial<EditLeadBody>;
    if (typeof input.dealerId !== 'string' || !input.dealerId) {
      throw new BadRequestException('Dealer is required to edit the lead');
    }
    const parsed = UpdateLeadSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ message: 'Datos del lead inválidos', issues: parsed.error.issues });
    }

    const name = parsed.data.name.trim();
    let canonicalPhone: string;
    try {
      canonicalPhone = normalizePhone(parsed.data.phone);
    } catch {
      throw new BadRequestException('El teléfono no tiene un formato válido');
    }
    const messageText = buildManualLeadMessage(name, canonicalPhone, parsed.data);

    if (process.env.NODE_ENV === 'test') {
      const result = updateTestLead(leadId, input.dealerId, parsed.data);
      if (!result.ok) {
        if (result.reason === 'duplicate') {
          throw new ConflictException('No se puede guardar: ya existe un lead con el mismo teléfono en este dealer.');
        }
        throw new BadRequestException('Lead no encontrado en el dealer seleccionado');
      }
      return { success: true, lead: result.lead };
    }

    if (!this.dataSource) throw new UnauthorizedException('Lead data is unavailable');
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const duplicate = await findDealerLeadDuplicate(queryRunner, input.dealerId, name, canonicalPhone, leadId);
      if (duplicate) {
        throw new ConflictException('No se puede guardar: ya existe un lead con el mismo teléfono en este dealer.');
      }

      const names = name.split(/\s+/).filter(Boolean);
      const updatedLeads = await queryRunner.query(
        `UPDATE leads
         SET canonical_phone = $1,
             first_name = $2,
             last_name = $3,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $4
           AND EXISTS (
             SELECT 1 FROM lead_dealers
             WHERE lead_id = $4
               AND COALESCE(assigned_dealer_id, dealer_id) = $5
           )
         RETURNING id`,
        [canonicalPhone, names[0] ?? 'Lead', names.slice(1).join(' '), leadId, input.dealerId],
      ) as Array<{ id: string }>;
      if (updatedLeads.length === 0) throw new BadRequestException('Lead no encontrado en el dealer seleccionado');

      const updatedRelationships = await queryRunner.query(
        `UPDATE lead_dealers
         SET vehicle_type = $1,
             down_payment = $2,
             purchase_timeline = $3,
             documents = $4,
             identification = $5,
             bank_account = $6,
             message_text = $7,
             updated_at = CURRENT_TIMESTAMP
         WHERE lead_id = $8
           AND COALESCE(assigned_dealer_id, dealer_id) = $9
         RETURNING lead_id`,
        [
          parsed.data.vehicle_type.trim(),
          normalizeDownPayment(parsed.data.down_payment),
          parsed.data.purchase_timeline.trim(),
          parsed.data.documents.trim(),
          parsed.data.identification.trim(),
          parsed.data.bank_account.trim(),
          messageText,
          leadId,
          input.dealerId,
        ],
      ) as Array<{ lead_id: string }>;
      if (updatedRelationships.length === 0) throw new BadRequestException('Lead no encontrado en el dealer seleccionado');

      const rows = await queryRunner.query(
        `SELECT
           ld.lead_id AS id,
           d.id AS "dealerId",
           d.name AS "dealerName",
           CONCAT_WS(' ', l.first_name, l.last_name) AS name,
           l.canonical_phone AS phone,
           ld.vehicle_type AS "vehicleType",
           ld.down_payment AS "downPayment",
           ld.identification,
           ld.bank_account AS "bankAccount",
           ld.documents,
           ld.purchase_timeline AS "purchaseTimeline",
           ld.status,
           ld.message_text AS "messageText",
           ld.created_at AS "createdAt",
           ld.routing_override AS "routingOverride",
           ld.routing_reason AS "routingReason"
         FROM lead_dealers ld
         INNER JOIN leads l ON l.id = ld.lead_id
         INNER JOIN dealers d ON d.id = COALESCE(ld.assigned_dealer_id, ld.dealer_id)
         WHERE ld.lead_id = $1
           AND COALESCE(ld.assigned_dealer_id, ld.dealer_id) = $2
         LIMIT 1`,
        [leadId, input.dealerId],
      );

      await queryRunner.commitTransaction();
      return { success: true, lead: rows[0] };
    } catch (error) {
      if (queryRunner.isTransactionActive) await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  @Delete(':id')
  async delete(
    @Req() request: Request,
    @Param('id') leadId: string,
    @Query('dealerId') dealerIdQuery?: string,
  ) {
    this.requireSession(request);
    if (!dealerIdQuery) {
      throw new BadRequestException('Dealer is required to delete the lead relationship');
    }

    if (process.env.NODE_ENV === 'test') {
      const result = deleteTestLead(leadId, dealerIdQuery);
      if (!result.ok) {
        throw new BadRequestException('Lead not found or cannot be deleted');
      }
      return { success: true, ...result };
    }

    if (!this.dataSource) {
      throw new UnauthorizedException('Lead data is unavailable');
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const existingLeads = await queryRunner.query(
        `SELECT id
         FROM leads
         WHERE id = $1
         FOR UPDATE`,
        [leadId],
      ) as Array<{ id: string }>;
      if (existingLeads.length === 0) {
        await queryRunner.commitTransaction();
        return { success: true, deletedLead: false, deletedRelationship: false };
      }

      const deletedRelationships = await queryRunner.query(
        `DELETE FROM lead_dealers
         WHERE lead_id = $1
           AND COALESCE(assigned_dealer_id, dealer_id) = $2
         RETURNING lead_id`,
        [leadId, dealerIdQuery],
      ) as Array<{ lead_id: string }>;
      const remainingRelationships = await queryRunner.query(
        `SELECT COUNT(*)::int AS count
         FROM lead_dealers
         WHERE lead_id = $1`,
        [leadId],
      ) as Array<{ count: number }>;
      let deletedLead = false;
      if (Number(remainingRelationships[0]?.count ?? 0) === 0) {
        // Bulk-ingestion rows are audit history and reference the lead without
        // ON DELETE CASCADE. Keep that history and remove only the queue row.
        const ingestionRows = await queryRunner.query(
          `SELECT id
           FROM lead_ingestion_rows
           WHERE lead_id = $1
           LIMIT 1`,
          [leadId],
        ) as Array<{ id: string }>;
        if (ingestionRows.length === 0) {
          const deletedLeads = await queryRunner.query(
            `DELETE FROM leads
             WHERE id = $1
             RETURNING id`,
            [leadId],
          ) as Array<{ id: string }>;
          deletedLead = deletedLeads.length > 0;
        }
      }

      await queryRunner.commitTransaction();
      return { success: true, deletedLead, deletedRelationship: deletedRelationships.length > 0 };
    } catch (error) {
      if (queryRunner.isTransactionActive) await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  @Patch(':id/reassign')
  async reassign(
    @Req() request: Request,
    @Param('id') leadId: string,
    @Body() body: ReassignBody,
  ) {
    this.requireSession(request);
    if (typeof body.currentDealerId !== 'string' || typeof body.targetDealerId !== 'string' || !body.currentDealerId || !body.targetDealerId) {
      throw new BadRequestException('Current and target dealers are required');
    }
    if (body.currentDealerId === body.targetDealerId) {
      throw new BadRequestException('The target dealer must be different');
    }
    const easternDealerIds: string[] = [...Object.values(EASTERN_DEALER_IDS)];
    if (!easternDealerIds.includes(body.currentDealerId) || !easternDealerIds.includes(body.targetDealerId)) {
      throw new BadRequestException('Only Easterns dealers can be reassigned from this queue');
    }

    if (process.env.NODE_ENV === 'test') {
      if (!reassignTestLead(leadId, body.currentDealerId, body.targetDealerId)) {
        throw new BadRequestException('Lead not found or cannot be reassigned');
      }
      return { success: true, message: 'Lead reasignado exitosamente.' };
    }

    if (!this.dataSource) throw new UnauthorizedException('Lead data is unavailable');
    const dealers = await this.dataSource.query(
      `SELECT id, name
       FROM dealers
       WHERE id = ANY($1::uuid[]) AND active = true AND routing_config->>'group' = 'Easterns'`,
      [[body.currentDealerId, body.targetDealerId]],
    ) as Array<{ id: string; name: string }>;
    if (dealers.length !== 2) throw new BadRequestException('Easterns dealers are not available');
    const currentDealer = dealers.find((dealer) => dealer.id === body.currentDealerId)!;
    const targetDealer = dealers.find((dealer) => dealer.id === body.targetDealerId)!;
    const result = await this.dataSource.query(
      `UPDATE lead_dealers
       SET assigned_dealer_id = $1,
           routing_override = true,
           routing_reason = $2,
           routing_status = 'manual_override',
           updated_at = CURRENT_TIMESTAMP
       WHERE lead_id = $3
         AND COALESCE(assigned_dealer_id, dealer_id) = $4
         AND status = 'pending'
       RETURNING lead_id`,
      [body.targetDealerId, `Manual override: ${currentDealer.name} -> ${targetDealer.name}`, leadId, body.currentDealerId],
    );
    if (result.length === 0) throw new BadRequestException('Lead not found or cannot be reassigned');
    return { success: true, message: 'Lead reasignado exitosamente.' };
  }

  @Post(':id/copy')
  async copy(
    @Req() request: Request,
    @Param('id') leadId: string,
    @Body() body: CopyBody,
  ) {
    this.requireSession(request);
    if (typeof body.sourceDealerId !== 'string' || typeof body.targetDealerId !== 'string' || !body.sourceDealerId || !body.targetDealerId) {
      throw new BadRequestException('El dealer origen y el dealer destino son obligatorios');
    }
    if (body.sourceDealerId === body.targetDealerId) {
      throw new BadRequestException('El dealer destino debe ser diferente al dealer origen');
    }

    if (process.env.NODE_ENV === 'test') {
      const result = copyTestLead(leadId, body.sourceDealerId, body.targetDealerId);
      if (!result.ok) {
        if (result.reason === 'duplicate') {
          throw new ConflictException('No se puede copiar: ya existe un lead con el mismo teléfono en el dealer destino.');
        }
        throw new BadRequestException('Lead origen no encontrado o dealer destino inválido');
      }
      return { success: true, leadId, sourceDealerId: body.sourceDealerId, targetDealerId: body.targetDealerId };
    }

    return this.copyLeadService.execute(leadId, {
      sourceDealerId: body.sourceDealerId,
      targetDealerId: body.targetDealerId,
    });
  }

  private parseStatus(status?: string): LeadStatus {
    if (!status || status === 'pending') return 'pending';
    if (status === 'sent') return 'sent';
    throw new BadRequestException('Status must be pending or sent');
  }

  private requireSession(request: Request): void {
    if (!this.authService.verifySession(request.cookies?.dealeradmin_session)) {
      throw new UnauthorizedException('Authentication required');
    }
  }
}
