import { Inject, Injectable, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { createHash } from 'node:crypto';
import { parseMonthlyReportsConfig, type MonthlyReportsConfig } from '@dealeradmin/config';
import { ExportReportService } from './export-report.service';
import { SmtpReportMailer, type ReportMail, type ReportMailer } from './monthly-report.mailer';

export const MONTHLY_REPORT_MAILER = Symbol('MONTHLY_REPORT_MAILER');
export type MonthlyReportStatus = 'processing' | 'sent' | 'failed' | 'skipped_disabled' | 'skipped_duplicate' | 'skipped_dry_run';

export type MonthlyReportPeriod = {
  periodKey: string;
  start: Date;
  end: Date;
  timezone: string;
  label: string;
};

export type MonthlyReportRunResult = {
  periodKey: string;
  status: MonthlyReportStatus;
  rowCount?: number;
  dealerCount?: number;
};

const MONTHS_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function localParts(date: Date, timezone: string): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
  return { year: values.year, month: values.month, day: values.day, hour: values.hour, minute: values.minute, second: values.second };
}

export function localDateTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, timezone: string): Date {
  const localTimestamp = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const guess = new Date(localTimestamp);
  const observed = localParts(guess, timezone);
  const observedAsUtc = Date.UTC(observed.year, observed.month - 1, observed.day, observed.hour, observed.minute, observed.second);
  return new Date(localTimestamp - (observedAsUtc - localTimestamp));
}

export function monthlyReportPeriod(now: Date, timezone = 'America/Bogota'): MonthlyReportPeriod {
  const current = localParts(now, timezone);
  const startYear = current.month === 1 ? current.year - 1 : current.year;
  const startMonth = current.month === 1 ? 12 : current.month - 1;
  const start = localDateTimeToUtc(startYear, startMonth, 1, 12, 0, timezone);
  const end = localDateTimeToUtc(current.year, current.month, 1, 12, 0, timezone);
  const periodKey = `${current.year}-${pad(current.month)}`;
  const label = `${MONTHS_ES[current.month - 1][0].toUpperCase()}${MONTHS_ES[current.month - 1].slice(1)} ${current.year}`;
  return { periodKey, start, end, timezone, label };
}

export function periodFromKey(periodKey: string, timezone = 'America/Bogota'): MonthlyReportPeriod {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodKey)) throw new Error('Invalid monthly report period key.');
  const [yearText, monthText] = periodKey.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const startYear = month === 1 ? year - 1 : year;
  const startMonth = month === 1 ? 12 : month - 1;
  const start = localDateTimeToUtc(startYear, startMonth, 1, 12, 0, timezone);
  const end = localDateTimeToUtc(year, month, 1, 12, 0, timezone);
  const label = `${MONTHS_ES[month - 1][0].toUpperCase()}${MONTHS_ES[month - 1].slice(1)} ${year}`;
  return { periodKey, start, end, timezone, label };
}

export function sanitizeMonthlyReportError(error: unknown): string {
  const raw = error instanceof Error ? error.message : 'Unknown monthly report error.';
  return raw
    .replace(/(password|pass|secret|authorization|bearer|smtp_user|smtp_password)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[email-redacted]')
    .slice(0, 500);
}

@Injectable()
export class MonthlyReportService {
  constructor(
    @Optional() @InjectDataSource() private readonly dataSource?: DataSource,
    private readonly exportReportService?: ExportReportService,
    @Optional() @Inject(MONTHLY_REPORT_MAILER) private readonly mailer?: ReportMailer,
  ) {}

  async run(now = new Date(), requestedPeriodKey?: string): Promise<MonthlyReportRunResult> {
    const config = parseMonthlyReportsConfig();
    const period = requestedPeriodKey ? periodFromKey(requestedPeriodKey, config.timezone) : monthlyReportPeriod(now, config.timezone);
    if (!config.enabled) {
      await this.recordDisabled(period);
      return { periodKey: period.periodKey, status: 'skipped_disabled' };
    }
    if (!this.dataSource || !this.exportReportService) throw new Error('Monthly report dependencies are not available.');

    const subject = `Reporte leads (${period.label})`;
    const fileName = `Reporte leads (${period.label}).xlsx`;
    const owner = await this.acquire(period, config, subject, fileName);
    if (!owner) return { periodKey: period.periodKey, status: 'skipped_duplicate' };

    try {
      const report = await this.exportReportService.generateMonthlyReport(period.start, period.end, fileName);
      const body = [
        'Buenas tardes,',
        '',
        `Adjunto el reporte de leads del mes de ${period.label}.`,
        `Todos los leads: ${report.rowCount}`,
        ...report.dealerCounts.map((dealer) => `${dealer.dealerName}: ${dealer.count}`),
        'Saludos,',
      ].join('\n');
      const attachmentSha256 = createHash('sha256').update(report.buffer).digest('hex');
      if (config.dryRun) {
        await this.markDryRun(period.periodKey, report.rowCount, report.dealerCounts.length, fileName, attachmentSha256);
        return { periodKey: period.periodKey, status: 'skipped_dry_run', rowCount: report.rowCount, dealerCount: report.dealerCounts.length };
      }
      const message: ReportMail = {
        from: config.from,
        to: config.to.split(',').map((value) => value.trim()).filter(Boolean),
        subject,
        text: body,
        attachment: { filename: fileName, content: report.buffer },
      };
      const sent = await (this.mailer ?? new SmtpReportMailer(config)).send(message);
      await this.markSent(period.periodKey, report.rowCount, report.dealerCounts.length, fileName, attachmentSha256, sent.messageId);
      await this.archiveReportedSentLeads(period);
      return { periodKey: period.periodKey, status: 'sent', rowCount: report.rowCount, dealerCount: report.dealerCounts.length };
    } catch (error) {
      await this.markFailed(period.periodKey, sanitizeMonthlyReportError(error));
      throw error;
    }
  }

  private async recordDisabled(period: MonthlyReportPeriod): Promise<void> {
    if (!this.dataSource) return;
    await this.dataSource.query(
      `INSERT INTO monthly_report_deliveries
       (period_key, period_start, period_end, timezone, from_address, to_address, subject, attachment_filename, status)
       VALUES ($1, $2, $3, $4, 'disabled', 'disabled', 'disabled', $5, 'skipped_disabled')
       ON CONFLICT (period_key) DO NOTHING`,
      [period.periodKey, period.start, period.end, period.timezone, `Reporte leads (${period.label}).xlsx`],
    );
  }

  private async acquire(period: MonthlyReportPeriod, config: MonthlyReportsConfig, subject: string, fileName: string): Promise<boolean> {
    const inserted = await this.dataSource!.query(
      `INSERT INTO monthly_report_deliveries
       (period_key, period_start, period_end, timezone, from_address, to_address, subject, attachment_filename, status, attempt_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'processing', 1)
       ON CONFLICT (period_key) DO NOTHING
       RETURNING id`,
      [period.periodKey, period.start, period.end, period.timezone, config.from, config.to, subject, fileName],
    );
    if ((inserted as Array<{ id: string }>).length > 0) return true;

    const reclaimed = await this.dataSource!.query(
      `UPDATE monthly_report_deliveries
       SET period_start = $2, period_end = $3, timezone = $4, from_address = $5, to_address = $6,
           subject = $7, attachment_filename = $8, status = 'processing', attempt_count = attempt_count + 1,
           last_error = NULL, next_retry_at = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE period_key = $1 AND status IN ('failed', 'skipped_disabled', 'skipped_dry_run')
         AND (next_retry_at IS NULL OR next_retry_at <= CURRENT_TIMESTAMP)
       RETURNING id`,
      [period.periodKey, period.start, period.end, period.timezone, config.from, config.to, subject, fileName],
    );
    if ((reclaimed as Array<{ id: string }>).length > 0) return true;
    return false;
  }

  private async markDryRun(periodKey: string, rowCount: number, dealerCount: number, fileName: string, sha256: string): Promise<void> {
    await this.dataSource!.query(
      `UPDATE monthly_report_deliveries
       SET status = 'skipped_dry_run', row_count = $2, dealer_count = $3, attachment_filename = $4,
           attachment_sha256 = $5, updated_at = CURRENT_TIMESTAMP
       WHERE period_key = $1 AND status = 'processing'`,
      [periodKey, rowCount, dealerCount, fileName, sha256],
    );
  }

  private async markSent(periodKey: string, rowCount: number, dealerCount: number, fileName: string, sha256: string, messageId?: string): Promise<void> {
    await this.dataSource!.query(
      `UPDATE monthly_report_deliveries
       SET status = 'sent', row_count = $2, dealer_count = $3, attachment_filename = $4,
           attachment_sha256 = $5, provider_message_id = $6, sent_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE period_key = $1 AND status = 'processing'`,
      [periodKey, rowCount, dealerCount, fileName, sha256, messageId ?? null],
    );
  }

  private async markFailed(periodKey: string, error: string): Promise<void> {
    await this.dataSource!.query(
      `UPDATE monthly_report_deliveries
       SET status = 'failed', last_error = $2, next_retry_at = CURRENT_TIMESTAMP + INTERVAL '15 minutes',
           updated_at = CURRENT_TIMESTAMP
       WHERE period_key = $1 AND status = 'processing'`,
      [periodKey, error],
    );
  }

  private async archiveReportedSentLeads(period: MonthlyReportPeriod): Promise<void> {
    await this.dataSource!.query(
      `UPDATE lead_dealers
       SET queue_archived_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE status = 'sent'
         AND queue_archived_at IS NULL
         AND created_at >= $1
         AND created_at < $2`,
      [period.start, period.end],
    );
  }
}
