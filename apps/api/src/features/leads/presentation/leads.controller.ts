import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  Req,
  UnauthorizedException,
  Optional,
} from '@nestjs/common';
import type { Request } from 'express';
import { DataSource } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { AuthService } from '../../auth/application/auth.service';
import { getTestManualLeads, testDealers, testLead, smartMergeTestLead, easternsTestLead, updateTestLeadStatus, reassignTestLead } from '../application/test-lead-store';
import { EASTERN_DEALER_IDS } from '../../routing/domain/services/georouting.service';

type LeadStatus = 'pending' | 'sent';

type StatusBody = { status?: unknown; dealerId?: unknown };
type ReassignBody = { currentDealerId?: unknown; targetDealerId?: unknown };

@Controller('leads')
export class LeadsController {
  constructor(
    @Optional() @InjectDataSource() private readonly dataSource: DataSource | undefined,
    private readonly authService: AuthService,
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
        status === lead.status && matchesDealer(lead.dealerId),
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
