import { AppDataSource } from '../src/database/data-source';
import { ExportReportService } from '../src/features/reports/application/export-report.service';
import { MonthlyReportService, sanitizeMonthlyReportError } from '../src/features/reports/application/monthly-report.service';

async function main(): Promise<void> {
  await AppDataSource.initialize();
  try {
    const exportService = new ExportReportService(AppDataSource);
    const reportService = new MonthlyReportService(AppDataSource, exportService);
    const result = await reportService.run();
    if (result.status !== 'sent' && result.status !== 'skipped_duplicate') {
      throw new Error(`Monthly report did not complete successfully: ${result.status}.`);
    }
    console.log(JSON.stringify(result));
  } finally {
    await AppDataSource.destroy();
  }
}

void main().catch((error: unknown) => {
  console.error(sanitizeMonthlyReportError(error));
  process.exitCode = 1;
});
