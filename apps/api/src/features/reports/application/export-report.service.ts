import { Injectable, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import * as ExcelJS from 'exceljs';
import { randomUUID } from 'node:crypto';
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
  name?: string;
  phone?: string;
  vehicleType?: string;
  downPayment?: string;
  purchaseTimeline?: string;
};
type DetailRow = {
  dealer_id: string;
  dealer_name: string;
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

  async generateXlsx(dealerId: string, from: Date, to: Date, _fileName?: string): Promise<Buffer> {
    const exportId = this.dataSource ? randomUUID() : undefined;
    if (this.dataSource) await this.recordExportStarted(exportId!, dealerId, from, to, _fileName);

    try {
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'dealerADMIN Engine';
      workbook.created = new Date();
      workbook.modified = new Date();

      let detailGroups: Array<{ dealerName: string; rows: Array<Record<string, string | Date>> }> = [];
      if (this.dataSource) {
        const detailsData = await this.dataSource.query(
          `SELECT
             d.id AS dealer_id,
             d.name AS dealer_name,
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
           ORDER BY d.name ASC, ld.created_at DESC`,
          [from, to, dealerId],
        );
        detailGroups = this.groupDetailRows(detailsData as DetailRow[]);
      } else {
        const testLeads = this.getTestLeads({ from, to }, dealerId);
        detailGroups = this.groupTestDetails(testLeads);
      }

      for (const group of detailGroups) {
        const sheet = workbook.addWorksheet(this.uniqueDealerSheetName(group.dealerName, workbook));
        sheet.columns = [
          { header: 'Ref', key: 'ref', width: 4 },
          { header: 'Nombre', key: 'name', width: 20.21875 },
          { header: 'Número', key: 'phone', width: 11 },
          { header: 'Comentarios', key: 'comments', width: 145.44140625 },
        ];
        sheet.addRows(group.rows.map((row, index) => ({ ref: index + 1, ...row })));
        sheet.getColumn('phone').numFmt = '@';
        sheet.views = [{ state: 'normal', showGridLines: true, zoomScale: 100 }];
      }

      if (workbook.worksheets.length === 0) {
        const sheetName = dealerId === 'all' ? 'Sin leads' : dealerId;
        const sheet = workbook.addWorksheet(this.uniqueDealerSheetName(sheetName, workbook));
        sheet.columns = [
          { header: 'Ref', key: 'ref', width: 4 },
          { header: 'Nombre', key: 'name', width: 20.21875 },
          { header: 'Número', key: 'phone', width: 11 },
          { header: 'Comentarios', key: 'comments', width: 145.44140625 },
        ];
        sheet.getColumn('phone').numFmt = '@';
        sheet.views = [{ state: 'normal', showGridLines: true, zoomScale: 100 }];
      }

      const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
      if (exportId) {
        await this.recordExportCompleted(exportId, detailGroups.reduce((count, group) => count + group.rows.length, 0), workbook.worksheets.length);
      }
      return buffer;
    } catch (error) {
      if (exportId) await this.recordExportFailed(exportId, error);
      throw error;
    }
  }

  private async recordExportStarted(id: string, dealerId: string, from: Date, to: Date, fileName?: string): Promise<void> {
    await this.dataSource!.query(
      `INSERT INTO report_export_history (id, dealer_id, dealer_filter, from_date, to_date, file_name, status)
       VALUES ($1, NULLIF($2, 'all')::uuid, $2, $3::date, $4::date, $5, 'processing')`,
      [id, dealerId, from, to, fileName ?? null],
    );
  }

  private async recordExportCompleted(id: string, rowCount: number, sheetCount: number): Promise<void> {
    await this.dataSource!.query(
      `UPDATE report_export_history
       SET status = 'completed', row_count = $2, sheet_count = $3, completed_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [id, rowCount, sheetCount],
    );
  }

  private async recordExportFailed(id: string, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : 'Unknown export error';
    await this.dataSource!.query(
      `UPDATE report_export_history
       SET status = 'failed', error_message = $2, completed_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [id, message.slice(0, 1000)],
    );
  }

  private groupDetailRows(rows: DetailRow[]): Array<{ dealerName: string; rows: Array<Record<string, string | Date>> }> {
    const groups = new Map<string, Array<Record<string, string | Date>>>();
    const names = new Map<string, string>();
    for (const row of rows) {
      const list = groups.get(row.dealer_id) ?? [];
      list.push(this.toDetailRow(row));
      groups.set(row.dealer_id, list);
      names.set(row.dealer_id, row.dealer_name);
    }
    return [...groups.entries()].map(([dealerId, detailRows]) => ({ dealerName: names.get(dealerId) ?? 'Sin dealer', rows: detailRows }));
  }

  private groupTestDetails(leads: ReportLead[]): Array<{ dealerName: string; rows: Array<Record<string, string | Date>> }> {
    return testDealers
      .map((dealer) => ({ dealerName: dealer.name, rows: this.buildTestDetails(leads.filter((lead) => lead.dealerId === dealer.id)) }))
      .filter((group) => group.rows.length > 0);
  }

  private uniqueDealerSheetName(dealerName: string, workbook: ExcelJS.Workbook): string {
    const base = (dealerName.trim() || 'Sin dealer').replace(/[\\/*?:\[\]]/g, '-').replace(/\s+/g, ' ').slice(0, 31).trim() || 'Sin dealer';
    const existing = new Set(workbook.worksheets.map((sheet) => sheet.name.toLowerCase()));
    let candidate = base;
    let suffix = 2;
    while (existing.has(candidate.toLowerCase())) {
      const suffixText = `-${suffix}`;
      candidate = `${base.slice(0, 31 - suffixText.length)}${suffixText}`;
      suffix += 1;
    }
    return candidate;
  }

  private getTestLeads(range: DateRange, dealerId: string): ReportLead[] {
    const leads = [testLead, smartMergeTestLead, easternsTestLead, ...getTestManualLeads()];
    return leads.filter((lead) => {
      const createdAt = new Date(lead.createdAt);
      return createdAt >= range.from && createdAt <= range.to && (dealerId === 'all' || lead.dealerId === dealerId);
    });
  }

  private buildTestDetails(leads: ReportLead[]): Array<Record<string, string | Date>> {
    return leads.map((lead) => ({
      name: lead.name ?? '',
      phone: lead.phone ?? '',
      comments: [lead.vehicleType, lead.downPayment, lead.purchaseTimeline].filter(Boolean).join(', '),
    }));
  }

  private toDetailRow(row: DetailRow): Record<string, string | Date> {
    return {
      name: this.clean(row.name),
      phone: this.clean(row.phone),
      comments: this.buildComments(row),
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

}
