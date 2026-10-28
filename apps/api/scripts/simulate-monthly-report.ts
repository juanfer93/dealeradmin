import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import * as ExcelJS from 'exceljs';
import { AppDataSource } from '../src/database/data-source';
import { ExportReportService } from '../src/features/reports/application/export-report.service';
import { MonthlyReportService, periodFromKey } from '../src/features/reports/application/monthly-report.service';
import { sanitizeMonthlyReportError } from '../src/features/reports/application/monthly-report.service';
import type { ReportMail, ReportMailer } from '../src/features/reports/application/monthly-report.mailer';

class SimulationMailer implements ReportMailer {
  message?: ReportMail;

  async send(message: ReportMail): Promise<{ messageId: string }> {
    this.message = message;
    return { messageId: 'simulated-provider-message' };
  }
}

function argument(name: string, fallback: string): string {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL must point to the local QA database.');
  const periodKey = argument('period', '2026-10');
  const period = periodFromKey(periodKey);
  const tag = randomUUID();
  const fileName = `Reporte leads (Simulacion ${period.label}).xlsx`;
  const leadIds: string[] = [];
  const mailer = new SimulationMailer();

  // These process-local values deliberately prevent any SMTP connection. The fake mailer
  // receives the complete message and the real environment is not changed.
  process.env.MONTHLY_REPORTS_ENABLED = 'true';
  process.env.MONTHLY_REPORTS_DRY_RUN = 'false';
  process.env.MONTHLY_REPORTS_FROM = 'simulation@example.invalid';
  process.env.MONTHLY_REPORTS_TO = 'simulation-recipient@example.invalid';
  process.env.MONTHLY_REPORTS_SMTP_USER = 'simulation@example.invalid';
  process.env.MONTHLY_REPORTS_SMTP_PASSWORD = 'simulation-placeholder';

  await AppDataSource.initialize();
  try {
    const dealers = await AppDataSource.query(`SELECT id, name FROM dealers WHERE active = true ORDER BY name ASC LIMIT 2`) as Array<{ id: string; name: string }>;
    if (dealers.length < 2) throw new Error('At least two active dealers are required for the simulation.');

    const cases = [
      { suffix: 'Antes del inicio', createdAt: new Date(period.start.getTime() - 1), status: 'sent' as const, expected: false },
      { suffix: 'Inicio incluido', createdAt: period.start, status: 'sent' as const, expected: true },
      { suffix: 'Interior', createdAt: new Date(period.start.getTime() + 60 * 60 * 1000), status: 'sent' as const, expected: true },
      { suffix: 'Final incluido', createdAt: new Date(period.end.getTime() - 1), status: 'sent' as const, expected: true },
      { suffix: 'Final excluido', createdAt: period.end, status: 'sent' as const, expected: false },
      { suffix: 'Despues del final', createdAt: new Date(period.end.getTime() + 1), status: 'sent' as const, expected: false },
      { suffix: 'Pendiente dentro', createdAt: new Date(period.start.getTime() + 2 * 60 * 60 * 1000), status: 'pending' as const, expected: false },
    ];
    const expectedNames: string[] = [];
    const excludedNames: string[] = [];
    for (const [index, testCase] of cases.entries()) {
      const { createdAt, status } = testCase;
      const name = `Reporte Frontera ${testCase.suffix}`;
      if (testCase.expected) expectedNames.push(name);
      else excludedNames.push(name);
      const inserted = await AppDataSource.query(
        `INSERT INTO leads (canonical_phone, first_name, last_name, ghl_contact_id, ghl_location_id, source, created_at, updated_at)
         VALUES ($1, $2, '', $3, $4, $5, $6, $6) RETURNING id`,
        [`+1999${String(index).padStart(7, '0')}`, name, `monthly-simulation-${tag}-${index}`, 'monthly-simulation', `monthly report simulation ${tag}`, createdAt],
      ) as Array<{ id: string }>;
      const leadId = inserted[0].id;
      leadIds.push(leadId);
      await AppDataSource.query(
        `INSERT INTO lead_dealers (lead_id, dealer_id, routing_status, status, message_text, created_at, updated_at)
         VALUES ($1, $2, 'simulation', $3, 'Lead de simulacion', $4, $4)`,
        [leadId, dealers[index % 2].id, status, createdAt],
      );
      if (status === 'sent') {
        await AppDataSource.query(
          `UPDATE lead_dealers SET sent_at = $2 WHERE lead_id = $1`,
          [leadId, new Date(createdAt.getTime() + 30 * 60 * 1000)],
        );
      }
    }

    const exportService = new ExportReportService(AppDataSource);
    const reportService = new MonthlyReportService(AppDataSource, exportService, mailer);
    const result = await reportService.run(new Date(`${periodKey}-01T17:00:00.000Z`), periodKey);
    if (!mailer.message) throw new Error('The fake mailer did not capture a message.');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load((mailer.message.attachment.content) as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const workbookNames = workbook.worksheets
      .flatMap((sheet) => sheet.getRows(2, sheet.rowCount - 1) ?? [])
      .map((row) => String(row.getCell(2).value ?? ''))
      .filter((name) => name.startsWith('Reporte Frontera '));
    const missingNames = expectedNames.filter((name) => !workbookNames.includes(name));
    const unexpectedNames = excludedNames.filter((name) => workbookNames.includes(name));
    if (missingNames.length > 0 || unexpectedNames.length > 0 || workbookNames.length !== expectedNames.length) {
      throw new Error(`Monthly report boundary mismatch. Missing: ${missingNames.join(', ') || 'none'}. Unexpected: ${unexpectedNames.join(', ') || 'none'}. Included: ${workbookNames.length}. Expected: ${expectedNames.length}.`);
    }
    const archiveState = await AppDataSource.query(
      `SELECT
         COUNT(*)::int AS preserved_count,
         COUNT(*) FILTER (WHERE status = 'sent' AND queue_archived_at IS NOT NULL)::int AS archived_sent_count,
         COUNT(*) FILTER (WHERE status = 'sent' AND queue_archived_at IS NULL)::int AS visible_sent_count,
         COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_count
       FROM lead_dealers
       WHERE lead_id = ANY($1::uuid[])`,
      [leadIds],
    ) as Array<{ preserved_count: number; archived_sent_count: number; visible_sent_count: number; pending_count: number }>;

    const outputDirectory = resolve(process.cwd(), 'output', 'qa');
    await mkdir(outputDirectory, { recursive: true });
    const xlsxPath = resolve(outputDirectory, `monthly-report-simulation-${periodKey}.xlsx`);
    const mailPath = resolve(outputDirectory, `monthly-report-simulation-${periodKey}.email.json`);
    await writeFile(xlsxPath, mailer.message.attachment.content);
    await writeFile(mailPath, JSON.stringify({
      result,
      from: mailer.message.from,
      to: mailer.message.to,
      subject: mailer.message.subject,
      text: mailer.message.text,
      attachment: { filename: mailer.message.attachment.filename, bytes: mailer.message.attachment.content.length },
    }, null, 2), 'utf8');
    console.log(JSON.stringify({
      result,
      includedLeadCount: result.rowCount,
      simulatedIncludedLeadCount: workbookNames.length,
      expectedSimulatedIncludedLeadCount: expectedNames.length,
      missingNames,
      unexpectedNames,
      preservedLeadCount: Number(archiveState[0]?.preserved_count ?? 0),
      archivedSentCount: Number(archiveState[0]?.archived_sent_count ?? 0),
      visibleSentCount: Number(archiveState[0]?.visible_sent_count ?? 0),
      pendingCount: Number(archiveState[0]?.pending_count ?? 0),
      expectedPreservedLeadCount: cases.length,
      expectedArchivedSentCount: expectedNames.length,
      expectedVisibleSentCount: cases.filter((testCase) => testCase.status === 'sent' && !testCase.expected).length,
      expectedPendingCount: cases.filter((testCase) => testCase.status === 'pending').length,
      existingLocalLeadCount: (result.rowCount ?? 0) - workbookNames.length,
      xlsxPath,
      mailPath,
      smtpContacted: false,
    }, null, 2));
  } finally {
    if (leadIds.length > 0) {
      await AppDataSource.query(`DELETE FROM lead_dealers WHERE lead_id = ANY($1::uuid[])`, [leadIds]);
      await AppDataSource.query(`DELETE FROM leads WHERE id = ANY($1::uuid[])`, [leadIds]);
    }
    await AppDataSource.query(`DELETE FROM monthly_report_deliveries WHERE period_key = $1 AND from_address = 'simulation@example.invalid'`, [periodKey]);
    await AppDataSource.query(`DELETE FROM report_export_history WHERE file_name = $1`, [fileName]);
    await AppDataSource.destroy();
  }
}

void main().catch((error: unknown) => {
  console.error(sanitizeMonthlyReportError(error));
  process.exitCode = 1;
});
