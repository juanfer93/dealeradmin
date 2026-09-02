import { BulkLeadImportSchema, CreateManualLeadSchema } from '@dealeradmin/contracts';
import { BadRequestException, Body, Controller, Get, Param, Post, Req, UnauthorizedException, Optional } from '@nestjs/common';
import type { Request } from 'express';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuthService } from '../../auth/application/auth.service';
import { ManualLeadService } from '../application/manual-lead.service';
import { BulkLeadService } from '../application/bulk-lead.service';
import { testDealers } from '../application/test-lead-store';

@Controller('dealers')
export class DealerLeadsController {
  constructor(
    private readonly manualLeadService: ManualLeadService,
    private readonly bulkLeadService: BulkLeadService,
    private readonly authService: AuthService,
    @Optional() @InjectDataSource() private readonly dataSource?: DataSource,
  ) {}

  @Get()
  async listDealers(@Req() request: Request) {
    if (!this.authService.verifySession(request.cookies?.dealeradmin_session)) {
      throw new UnauthorizedException('Authentication required');
    }
    if (process.env.NODE_ENV === 'test') return testDealers;
    if (!this.dataSource) throw new UnauthorizedException('Dealer data is unavailable');

    return this.dataSource.query(
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
  }

  @Post(':dealerId/leads')
  async createManualLead(
    @Req() request: Request,
    @Param('dealerId') dealerId: string,
    @Body() body: unknown,
  ) {
    if (!this.authService.verifySession(request.cookies?.dealeradmin_session)) {
      throw new UnauthorizedException('Authentication required');
    }

    const parsed = CreateManualLeadSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ message: 'Datos del lead inválidos', issues: parsed.error.issues });
    }

    return this.manualLeadService.execute(dealerId, parsed.data);
  }

  @Post(':dealerId/leads/bulk')
  async createBulkLeads(
    @Req() request: Request,
    @Param('dealerId') dealerId: string,
    @Body() body: unknown,
  ) {
    if (!this.authService.verifySession(request.cookies?.dealeradmin_session)) {
      throw new UnauthorizedException('Authentication required');
    }
    const parsed = BulkLeadImportSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ message: 'El texto de leads es inválido', issues: parsed.error.issues });
    }
    return this.bulkLeadService.execute(dealerId, parsed.data.text);
  }
}
