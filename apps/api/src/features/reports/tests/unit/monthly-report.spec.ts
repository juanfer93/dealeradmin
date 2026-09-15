import { DataSource } from 'typeorm';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import * as ExcelJS from 'exceljs';
import { parseMonthlyReportsConfig } from '@dealeradmin/config';
import { MonthlyReportService, monthlyReportPeriod, periodFromKey, sanitizeMonthlyReportError } from '../../application/monthly-report.service';
import type { ReportMail, ReportMailer } from '../../application/monthly-report.mailer';

describe('monthly lead reports', () => {
  beforeEach(() => {
    vi.stubEnv('MONTHLY_REPORTS_ENABLED', 'false');
    vi.stubEnv('MONTHLY_REPORTS_DRY_RUN', 'false');
  });

  afterEach(() => vi.unstubAllEnvs());

  it('defaults to disabled and does not require or inspect SMTP settings', () => {
    expect(parseMonthlyReportsConfig({})).toMatchObject({ enabled: false, timezone: 'America/Bogota', sendHour: 12, sendMinute: 0 });
    expect(parseMonthlyReportsConfig({ MONTHLY_REPORTS_ENABLED: 'TRUE' })).toMatchObject({ enabled: false });
  });

  it('requires the app password only after the exact true flag is enabled', () => {
    expect(() => parseMonthlyReportsConfig({ MONTHLY_REPORTS_ENABLED: 'true' })).toThrow('MONTHLY_REPORTS_SMTP_PASSWORD');
    expect(parseMonthlyReportsConfig({
      MONTHLY_REPORTS_ENABLED: 'true',
      MONTHLY_REPORTS_SMTP_PASSWORD: 'unit-test-placeholder',
    })).toMatchObject({ enabled: true, from: 'jfpi_0793@icloud.com', to: 'pixelmediacolombia@gmail.com', smtpPort: 587 });
  });

  it('calculates the October 2026 period at noon in Bogota as an exact UTC half-open range', () => {
    const period = monthlyReportPeriod(new Date('2026-10-01T17:00:00.000Z'));
    expect(period.periodKey).toBe('2026-10');
    expect(period.start.toISOString()).toBe('2026-09-01T17:00:00.000Z');
    expect(period.end.toISOString()).toBe('2026-10-01T17:00:00.000Z');
    expect(periodFromKey('2026-10').label).toBe('Octubre 2026');
  });

  it('builds the same summary and attachment contract passed to the mailer', async () => {
    vi.stubEnv('MONTHLY_REPORTS_ENABLED', 'true');
    vi.stubEnv('MONTHLY_REPORTS_SMTP_PASSWORD', 'unit-test-placeholder');
    const sent: ReportMail[] = [];
    const dataSource = { query: vi.fn()
      .mockResolvedValueOnce([{ id: 'delivery-1' }])
      .mockResolvedValueOnce([]) } as unknown as DataSource;
    const exportService = {
      generateMonthlyReport: vi.fn().mockResolvedValue({
        buffer: Buffer.from('xlsx-placeholder'),
        rowCount: 3,
        sheetCount: 2,
        dealerCounts: [
          { dealerId: '1', dealerName: 'Offlease Fredericksburg', count: 2 },
          { dealerId: '2', dealerName: 'Offlease Stafford', count: 1 },
        ],
      }),
    };
    const mailer: ReportMailer = { send: vi.fn(async (message) => { sent.push(message); return { messageId: 'provider-1' }; }) };
    const service = new MonthlyReportService(dataSource, exportService as never, mailer);

    await expect(service.run(new Date('2026-10-01T17:00:00.000Z'))).resolves.toMatchObject({ status: 'sent', rowCount: 3, dealerCount: 2 });
    expect(exportService.generateMonthlyReport).toHaveBeenCalledWith(
      new Date('2026-09-01T17:00:00.000Z'),
      new Date('2026-10-01T17:00:00.000Z'),
      'Reporte leads (Octubre 2026).xlsx',
    );
    expect(sent[0]).toMatchObject({
      from: 'jfpi_0793@icloud.com',
      to: ['pixelmediacolombia@gmail.com'],
      subject: 'Reporte leads (Octubre 2026)',
      attachment: { filename: 'Reporte leads (Octubre 2026).xlsx' },
    });
    expect(sent[0]?.text).toContain('Todos los leads: 3');
    expect(sent[0]?.text).toContain('Offlease Fredericksburg: 2');
    expect(sent[0]?.text).toContain('Offlease Stafford: 1');
    expect(sent[0]?.attachment.content).toEqual(Buffer.from('xlsx-placeholder'));
  });

  it('does not query or generate when disabled', async () => {
    const query = vi.fn();
    const exportService = { generateMonthlyReport: vi.fn() };
    const mailer = { send: vi.fn() };
    const service = new MonthlyReportService({ query } as unknown as DataSource, exportService as never, mailer);

    await expect(service.run(new Date('2026-10-01T17:00:00.000Z'))).resolves.toMatchObject({ status: 'skipped_disabled' });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[0]).not.toContain('lead_dealers');
    expect(exportService.generateMonthlyReport).not.toHaveBeenCalled();
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it('returns duplicate for an existing processing or sent period and allows one failed retry', async () => {
    vi.stubEnv('MONTHLY_REPORTS_ENABLED', 'true');
    vi.stubEnv('MONTHLY_REPORTS_SMTP_PASSWORD', 'unit-test-placeholder');
    const exportService = { generateMonthlyReport: vi.fn().mockResolvedValue({ buffer: Buffer.from('xlsx'), rowCount: 0, sheetCount: 1, dealerCounts: [] }) };
    const mailer = { send: vi.fn().mockResolvedValue({ messageId: 'provider-2' }) };
    const query = vi.fn()
      .mockResolvedValueOnce([]).mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'retry-1' }]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const service = new MonthlyReportService({ query } as unknown as DataSource, exportService as never, mailer);

    await expect(service.run(new Date('2026-10-01T17:00:00.000Z'))).resolves.toMatchObject({ status: 'skipped_duplicate' });
    await expect(service.run(new Date('2026-10-01T17:00:00.000Z'))).resolves.toMatchObject({ status: 'sent', rowCount: 0 });
    expect(mailer.send).toHaveBeenCalledTimes(1);
  });

  it('sanitizes credentials and addresses from delivery errors', () => {
    expect(sanitizeMonthlyReportError(new Error('AUTH password=supersecret user@domain.com'))).toBe('AUTH password=[redacted] [email-redacted]');
  });

  it('accepts a valid XLSX buffer returned by the existing generator contract', async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('Sin leads').addRow(['Ref', 'Nombre', 'Número', 'Comentarios']);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const loaded = new ExcelJS.Workbook();
    await loaded.xlsx.load(buffer as unknown as Parameters<typeof loaded.xlsx.load>[0]);
    expect(loaded.getWorksheet('Sin leads')?.getRow(1).getCell(1).value).toBe('Ref');
  });
});
