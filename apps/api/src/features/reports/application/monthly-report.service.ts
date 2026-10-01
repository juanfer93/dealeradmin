import { Inject, Injectable, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
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

export class MonthlyReportDeliveryError extends Error {
  readonly code = 'SMTP_DELIVERY_FAILED';

  constructor() {
    super('SMTP delivery failed.');
    this.name = 'MonthlyReportDeliveryError';
  }
}

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

  async run(now = new Date(), requestedPeriodKey?: string, force = false): Promise<MonthlyReportRunResult> {
    const config = parseMonthlyReportsConfig();
    const period = requestedPeriodKey ? periodFromKey(requestedPeriodKey, config.timezone) : monthlyReportPeriod(now, config.timezone);
    if (!config.enabled) {
      await this.recordDisabled(period);
      return { periodKey: period.periodKey, status: 'skipped_disabled' };
    }
    if (!this.dataSource || !this.exportReportService) throw new Error('Monthly report dependencies are not available.');

    const subject = `Reporte leads (${period.label})`;
    const fileName = `Reporte leads (${period.label}).xlsx`;
    let result: MonthlyReportRunResult;
    try {
      result = await this.sendAndRecord(period, config, subject, fileName, force);
    } catch (error) {
      console.error('[Monthly Report Error]:', sanitizeMonthlyReportError(error));
      throw new MonthlyReportDeliveryError();
    }
    if (result.status === 'skipped_duplicate' || result.status === 'skipped_dry_run') return result;
    try {
      await this.archiveReportedSentLeads(period);
    } catch (error) {
      console.error('[Monthly Report Archive Error]:', sanitizeMonthlyReportError(error));
      throw error;
    }
    return result;
  }

  private async sendAndRecord(
    period: MonthlyReportPeriod,
    config: MonthlyReportsConfig,
    subject: string,
    fileName: string,
    force: boolean,
  ): Promise<MonthlyReportRunResult> {
    const execute = async (manager: EntityManager): Promise<MonthlyReportRunResult> => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`monthly-report:${period.periodKey}`]);
      const existing = await manager.query(
        `SELECT status FROM monthly_report_deliveries WHERE period_key = $1 LIMIT 1`,
        [period.periodKey],
      ) as Array<{ status: string }>;
      const existingStatus = existing[0]?.status;
      const retryableStatuses = new Set(['failed', 'skipped_disabled', 'skipped_dry_run']);
      if (!force && existingStatus && !retryableStatuses.has(existingStatus)) {
        return { periodKey: period.periodKey, status: 'skipped_duplicate' };
      }

      const report = await this.exportReportService!.generateMonthlyReport(period.start, period.end, fileName);
      if (config.dryRun) {
        return { periodKey: period.periodKey, status: 'skipped_dry_run', rowCount: report.rowCount, dealerCount: report.dealerCounts.length };
      }

      const body = [
        'Buenas tardes,',
        '',
        `Adjunto el reporte de leads del mes de ${period.label}.`,
        `Todos los leads: ${report.rowCount}`,
        ...report.dealerCounts.map((dealer) => `${dealer.dealerName}: ${dealer.count}`),
        'Saludos,',
      ].join('\n');
      const attachmentSha256 = createHash('sha256').update(report.buffer).digest('hex');
      const message: ReportMail = {
        from: config.from,
        to: config.to.split(',').map((value) => value.trim()).filter(Boolean),
        subject,
        text: body,
        attachment: { filename: fileName, content: report.buffer },
      };
      const sent = await (this.mailer ?? new SmtpReportMailer(config)).send(message);

      await manager.query(
        `INSERT INTO monthly_report_deliveries
         (period_key, period_start, period_end, timezone, from_address, to_address, subject,
          row_count, dealer_count, attachment_filename, attachment_sha256, status, attempt_count,
          provider_message_id, sent_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'sent', 1, $12, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT (period_key) DO UPDATE SET
           period_start = EXCLUDED.period_start, period_end = EXCLUDED.period_end,
           timezone = EXCLUDED.timezone, from_address = EXCLUDED.from_address,
           to_address = EXCLUDED.to_address, subject = EXCLUDED.subject,
           row_count = EXCLUDED.row_count, dealer_count = EXCLUDED.dealer_count,
           attachment_filename = EXCLUDED.attachment_filename, attachment_sha256 = EXCLUDED.attachment_sha256,
           status = 'sent', attempt_count = monthly_report_deliveries.attempt_count + 1,
           last_error = NULL, next_retry_at = NULL, provider_message_id = EXCLUDED.provider_message_id,
           sent_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP`,
        [
          period.periodKey, period.start, period.end, period.timezone, config.from, config.to, subject,
          report.rowCount, report.dealerCounts.length, fileName, attachmentSha256, sent.messageId ?? null,
        ],
      );
      return { periodKey: period.periodKey, status: 'sent', rowCount: report.rowCount, dealerCount: report.dealerCounts.length };
    };

    if (typeof this.dataSource!.transaction === 'function') return this.dataSource!.transaction(execute);
    return execute(this.dataSource as unknown as EntityManager);
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
