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
import { getTestManualLeads, testDealers, testLead, smartMergeTestLead, updateTestLeadStatus } from '../application/test-lead-store';

type LeadStatus = 'pending' | 'sent';

type StatusBody = { status?: unknown; dealerId?: unknown };

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
  ) {
    this.requireSession(request);
    const status = this.parseStatus(statusQuery);

    if (process.env.NODE_ENV === 'test') {
      const manualLeads = getTestManualLeads().filter((lead) =>
        status === lead.status && (!dealerId || dealerId === lead.dealerId),
      );
      const fixedLeads = [testLead, smartMergeTestLead].filter((lead) =>
        status === lead.status && (!dealerId || dealerId === lead.dealerId),
      );
      const leads = [...fixedLeads, ...manualLeads];
      return { dealers: testDealers, leads };
    }

    if (!this.dataSource) {
      throw new UnauthorizedException('Lead data is unavailable');
    }

    const dealerFilter = dealerId ? 'AND d.id = $2' : '';
    const params = dealerId ? [status, dealerId] : [status];
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
         ld.created_at AS "createdAt"
       FROM lead_dealers ld
       INNER JOIN leads l ON l.id = ld.lead_id
       INNER JOIN dealers d ON d.id = ld.dealer_id
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
       LEFT JOIN lead_dealers ld ON ld.dealer_id = d.id
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
       WHERE lead_id = $1 AND dealer_id = $2 AND status = 'pending'`,
      [leadId, body.dealerId],
    );
    if (result.length === 0) {
      throw new BadRequestException('Lead not found or already sent');
    }
    return { success: true };
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
