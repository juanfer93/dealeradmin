import { Module } from '@nestjs/common';
import { AuthService } from '../../auth/application/auth.service';
import { ExportReportService } from '../application/export-report.service';
import { ReportsController } from './reports.controller';

@Module({
  controllers: [ReportsController],
  providers: [AuthService, ExportReportService],
})
export class ReportsModule {}
