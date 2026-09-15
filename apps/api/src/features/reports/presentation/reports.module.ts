import { Module } from '@nestjs/common';
import { AuthService } from '../../auth/application/auth.service';
import { ExportReportService } from '../application/export-report.service';
import { MonthlyReportService, MONTHLY_REPORT_MAILER } from '../application/monthly-report.service';
import { ReportsController } from './reports.controller';
import { MonthlyReportCronGuard } from './monthly-report-cron.guard';

@Module({
  controllers: [ReportsController],
  providers: [
    AuthService,
    ExportReportService,
    MonthlyReportService,
    MonthlyReportCronGuard,
    { provide: MONTHLY_REPORT_MAILER, useFactory: () => undefined },
  ],
})
export class ReportsModule {}
