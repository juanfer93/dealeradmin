import {
  BadRequestException,
  Controller,
  Get,
  Query,
  Post,
  Param,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from '../../auth/application/auth.service';
import { ExportReportService } from '../application/export-report.service';
import { MonthlyReportService } from '../application/monthly-report.service';
import { monthlyReportPeriod } from '../application/monthly-report.service';
import { MonthlyReportCronGuard } from './monthly-report-cron.guard';
import { parseMonthlyReportsConfig } from '@dealeradmin/config';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

@Controller('reports')
export class ReportsController {
  constructor(
    private readonly exportReportService: ExportReportService,
    private readonly authService: AuthService,
    private readonly monthlyReportService: MonthlyReportService,
  ) {}

  @Get('preview')
  async preview(
    @Req() request: Request,
    @Query('dealerId') dealerId = 'all',
    @Query('from') fromStr?: string,
    @Query('to') toStr?: string,
  ): Promise<{ count: number }> {
    this.requireSession(request);
    const range = this.parseRange(fromStr, toStr);
    return { count: await this.exportReportService.countLeads(dealerId, range) };
  }

  @Get('monthly/run')
  @UseGuards(MonthlyReportCronGuard)
  runMonthlyReport(): Promise<unknown> {
    return this.monthlyReportService.run();
  }

  @Get('monthly/status')
  monthlyStatus(@Req() request: Request): {
    enabled: boolean;
    dayOfMonth: 1;
    sendHour: number;
    sendMinute: number;
    timezone: string;
    nextRunAt: string | null;
  } {
    this.requireSession(request);
    const config = parseMonthlyReportsConfig();
    const nextRunAt = monthlyReportPeriod(new Date(), config.timezone).end.toISOString();
    return {
      enabled: config.enabled,
      dayOfMonth: 1,
      sendHour: config.enabled ? config.sendHour : 12,
      sendMinute: config.enabled ? config.sendMinute : 0,
      timezone: config.enabled ? config.timezone : 'America/Bogota',
      nextRunAt,
    };
  }

  @Post('monthly/reprocess/:periodKey')
  async reprocessMonthlyReport(
    @Req() request: Request,
    @Param('periodKey') periodKey: string,
  ): Promise<unknown> {
    this.requireSession(request);
    return this.monthlyReportService.run(new Date(), periodKey);
  }

  @Get('export')
  async export(
    @Req() request: Request,
    @Res() response: Response,
    @Query('dealerId') dealerId = 'all',
    @Query('from') fromStr?: string,
    @Query('to') toStr?: string,
  ): Promise<void> {
    this.requireSession(request);
    const range = this.parseRange(fromStr, toStr);
    const safeDealerId = dealerId.replace(/[^a-zA-Z0-9_-]/g, '-');
    const fileName = `dealerADMIN-leads-${safeDealerId}-${fromStr}-to-${toStr}.xlsx`;
    const buffer = await this.exportReportService.generateXlsx(dealerId, range.from, range.to, fileName);

    response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${fileName}"`,
    );
    response.send(buffer);
  }

  private parseRange(fromStr?: string, toStr?: string): { from: Date; to: Date } {
    if (!fromStr || !toStr) {
      throw new BadRequestException('Las fechas Desde y Hasta son obligatorias.');
    }
    if (!DATE_ONLY.test(fromStr) || !DATE_ONLY.test(toStr)) {
      throw new BadRequestException('Las fechas deben usar el formato YYYY-MM-DD.');
    }

    const from = new Date(`${fromStr}T00:00:00.000Z`);
    const endExclusive = new Date(`${toStr}T00:00:00.000Z`);
    endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
    const to = new Date(endExclusive.getTime() - 1);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException('Las fechas seleccionadas no son válidas.');
    }
    if (from > to) {
      throw new BadRequestException('La fecha inicial no puede ser posterior a la fecha final.');
    }
    return { from, to };
  }

  private requireSession(request: Request): void {
    if (!this.authService.verifySession(request.cookies?.dealeradmin_session)) {
      throw new UnauthorizedException('Authentication required');
    }
  }
}
