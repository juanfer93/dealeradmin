import { Injectable, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import * as ExcelJS from 'exceljs';
import { isCashDownPayment, normalizeDownPayment } from '../../leads/domain/down-payment';
import { normalizePurchaseTimeline, LOOKING_OPTIONS_LABEL } from '../../leads/domain/message-builder';
import {
  easternsTestLead,
  getTestManualLeads,
  smartMergeTestLead,
  testDealers,
  testLead,
} from '../../leads/application/test-lead-store';

type DateRange = { from: Date; to: Date };
type ReportLead = {
  createdAt: string;
  dealerId: string;
  status: 'pending' | 'sent';
};
type DetailRow = {
  received_at: string | Date;
  name: string | null;
  phone: string | null;
  vehicle_type: string | null;
  down_payment: string | null;
  purchase_timeline: string | null;
  documents: string | null;
  identification: string | null;
  bank_account: string | null;
  status: string;
  sent_at: string | Date | null;
};

const REPORT_SHEETS = ['Resumen', 'Detalle', 'Errores'] as const;
const TEAL = '0B817A';

@Injectable()
export class ExportReportService {
  constructor(@Optional() @InjectDataSource() private readonly dataSource?: DataSource) {}

  async countLeads(dealerId: string, range: DateRange): Promise<number> {
    if (!this.dataSource && process.env.NODE_ENV === 'test') {
      return this.getTestLeads(range, dealerId).length;
    }

    if (!this.dataSource) throw new Error('Database connection is not available');

    const rows = (await this.dataSource.query(
      `SELECT COUNT(*)::int AS count
       FROM lead_dealers ld
       WHERE ld.created_at BETWEEN $1 AND $2
         AND ($3 = 'all' OR COALESCE(ld.assigned_dealer_id, ld.dealer_id) = NULLIF($3, 'all')::uuid)`,
      [range.from, range.to, dealerId],
    )) as Array<{ count: number | string }>;
    return Number(rows[0]?.count ?? 0);
  }

  async generateXlsx(dealerId: string, from: Date, to: Date): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'dealerADMIN Engine';
    workbook.created = new Date();
    workbook.modified = new Date();

    const summarySheet = workbook.addWorksheet(REPORT_SHEETS[0]);
    summarySheet.columns = [
      { header: 'Dealer', key: 'dealer', width: 30 },
      { header: 'Leads recibidos', key: 'received', width: 16 },
      { header: 'Leads con teléfono', key: 'withPhone', width: 18 },
      { header: 'Leads enviados', key: 'sent', width: 16 },
      { header: 'Leads sin teléfono', key: 'noPhone', width: 18 },
      { header: 'Routing override manual', key: 'overrides', width: 24 },
    ];

    if (this.dataSource) {
      const summaryData = await this.dataSource.query(
        `SELECT
           d.name AS dealer,
           COUNT(ld.lead_id)::int AS received,
           COUNT(*) FILTER (WHERE l.canonical_phone IS NOT NULL)::int AS "withPhone",
           COUNT(*) FILTER (WHERE ld.status = 'sent')::int AS sent,
           COUNT(*) FILTER (WHERE ld.status = 'blocked_no_phone')::int AS "noPhone",
           COUNT(*) FILTER (WHERE ld.routing_override = true)::int AS overrides
         FROM lead_dealers ld
         JOIN dealers d ON d.id = COALESCE(ld.assigned_dealer_id, ld.dealer_id)
         JOIN leads l ON l.id = ld.lead_id
         WHERE ld.created_at BETWEEN $1 AND $2
           AND ($3 = 'all' OR COALESCE(ld.assigned_dealer_id, ld.dealer_id) = NULLIF($3, 'all')::uuid)
         GROUP BY d.id, d.name
         ORDER BY d.name ASC`,
        [from, to, dealerId],
      );
      summarySheet.addRows(summaryData);
    } else {
      summarySheet.addRows(this.buildTestSummary(this.getTestLeads({ from, to }, dealerId)));
    }
    this.styleSheet(summarySheet);

    const detailSheet = workbook.addWorksheet(REPORT_SHEETS[1]);
    detailSheet.columns = [
      { header: 'Nombre', key: 'name', width: 25 },
      { header: 'Número', key: 'phone', width: 18 },
      { header: 'Comentarios', key: 'comments', width: 72 },
      { header: 'Fecha de llegada a dealerADMIN', key: 'received_at', width: 28 },
    ];

    if (this.dataSource) {
      const detailsData = await this.dataSource.query(
        `SELECT
           ld.created_at AS received_at,
           CONCAT_WS(' ', l.first_name, l.last_name) AS name,
           l.canonical_phone AS phone,
           ld.vehicle_type,
           ld.down_payment,
           ld.purchase_timeline,
           ld.documents,
           ld.identification,
           ld.bank_account,
           ld.status,
           ld.sent_at
         FROM lead_dealers ld
         JOIN dealers d ON d.id = COALESCE(ld.assigned_dealer_id, ld.dealer_id)
         JOIN leads l ON l.id = ld.lead_id
         WHERE ld.created_at BETWEEN $1 AND $2
           AND ($3 = 'all' OR COALESCE(ld.assigned_dealer_id, ld.dealer_id) = NULLIF($3, 'all')::uuid)
         ORDER BY ld.created_at DESC`,
        [from, to, dealerId],
      );
      detailSheet.addRows((detailsData as DetailRow[]).map((row) => this.toDetailRow(row)));
    } else {
      detailSheet.addRows(this.buildTestDetails(this.getTestLeads({ from, to }, dealerId)));
    }
    detailSheet.getColumn('received_at').numFmt = 'yyyy-mm-dd hh:mm';
    this.styleSheet(detailSheet);

    const errorSheet = workbook.addWorksheet(REPORT_SHEETS[2]);
    errorSheet.columns = [
      { header: 'ID evento', key: 'event_id', width: 30 },
      { header: 'Tipo de error', key: 'error_code', width: 32 },
      { header: 'Fecha de recepción', key: 'received_at', width: 22 },
      { header: 'GHL Location ID', key: 'ghl_location_id', width: 25 },
      { header: 'Estado', key: 'status', width: 15 },
    ];

    if (this.dataSource) {
      const errorData = await this.dataSource.query(
        `SELECT we.event_id, we.error_code, we.received_at, we.ghl_location_id, we.status
         FROM webhook_events we
         LEFT JOIN dealers d ON d.ghl_location_id = we.ghl_location_id
         WHERE we.received_at BETWEEN $1 AND $2
           AND we.status = 'failed'
           AND ($3 = 'all' OR d.id = NULLIF($3, 'all')::uuid)
         ORDER BY we.received_at DESC`,
        [from, to, dealerId],
      );
      errorSheet.addRows(errorData);
    }
    errorSheet.getColumn('received_at').numFmt = 'yyyy-mm-dd hh:mm';
    this.styleSheet(errorSheet);

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  private styleSheet(sheet: ExcelJS.Worksheet): void {
    const headerRow = sheet.getRow(1);
    headerRow.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TEAL } };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    headerRow.height = 24;
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.autoFilter = { from: 'A1', to: `${this.columnLetter(sheet.columnCount)}1` };
  }

  private columnLetter(columnNumber: number): string {
    let value = columnNumber;
    let result = '';
    while (value > 0) {
      const remainder = (value - 1) % 26;
      result = String.fromCharCode(65 + remainder) + result;
      value = Math.floor((value - 1) / 26);
    }
    return result;
  }

  private getTestLeads(range: DateRange, dealerId: string): ReportLead[] {
    const leads = [testLead, smartMergeTestLead, easternsTestLead, ...getTestManualLeads()];
    return leads.filter((lead) => {
      const createdAt = new Date(lead.createdAt);
      return createdAt >= range.from && createdAt <= range.to && (dealerId === 'all' || lead.dealerId === dealerId);
    });
  }

  private buildTestSummary(leads: ReportLead[]): Array<Record<string, string | number>> {
    const rows = testDealers
      .map((dealer) => {
        const dealerLeads = leads.filter((lead) => lead.dealerId === dealer.id);
        if (dealerLeads.length === 0) return null;
        return {
          dealer: dealer.name,
          received: dealerLeads.length,
          withPhone: dealerLeads.length,
          sent: dealerLeads.filter((lead) => lead.status === 'sent').length,
          noPhone: 0,
          overrides: 0,
        };
      })
    return rows.filter((row): row is NonNullable<typeof row> => row !== null);
  }

  private buildTestDetails(leads: ReportLead[]): Array<Record<string, string | Date>> {
    return leads.map((lead) => ({
      name: '',
      phone: '',
      comments: '',
      received_at: new Date(lead.createdAt),
    }));
  }

  private toDetailRow(row: DetailRow): Record<string, string | Date> {
    return {
      name: this.clean(row.name),
      phone: this.clean(row.phone),
      comments: this.buildComments(row),
      received_at: this.toDate(row.received_at),
    };
  }

  private buildComments(row: Pick<DetailRow, 'vehicle_type' | 'down_payment' | 'purchase_timeline' | 'documents' | 'identification' | 'bank_account'>): string {
    const comments: string[] = [];
    const vehicle = this.clean(row.vehicle_type);
    if (vehicle) comments.push(vehicle);
    const downPayment = normalizeDownPayment(row.down_payment);
    if (downPayment) comments.push(isCashDownPayment(downPayment) ? 'paga en cash' : /\bdown\b/i.test(downPayment) ? downPayment : `${downPayment} de down`);
    const documents = this.clean(row.documents);
    const bankAccount = this.clean(row.bank_account);
    const hasIdentification = Boolean(this.clean(row.identification));
    const hasBankAccount = Boolean(bankAccount);
    const hasIncomeProof = /prueba\s+de\s+ingresos|proof\s+of\s+income|income\s+proof/i.test(documents);
    if (hasIdentification && hasBankAccount) comments.push('ID y cuenta bancaria');
    else if (hasIdentification && hasIncomeProof) comments.push('ID y prueba de ingresos');
    else if (hasIdentification) comments.push('ID');
    else if (hasBankAccount) comments.push('cuenta bancaria');
    if (documents && !(hasIdentification && hasIncomeProof)) comments.push(documents);
    const timeline = normalizePurchaseTimeline(row.purchase_timeline);
    if (timeline) comments.push(timeline === LOOKING_OPTIONS_LABEL ? timeline : `quiere comprar ${timeline.toLowerCase()}`);
    return comments.filter(Boolean).join(', ');
  }

  private clean(value: string | null | undefined): string {
    return value?.trim() ?? '';
  }

  private toDate(value: string | Date): Date {
    return value instanceof Date ? value : new Date(value);
  }
}
