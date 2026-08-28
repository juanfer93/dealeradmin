import { DataSource } from 'typeorm';
import * as ExcelJS from 'exceljs';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { ExportReportService } from '../../application/export-report.service';

describe('Día 6 - generación de reportes XLSX', () => {
  let service: ExportReportService;
  let mockQuery: Mock;

  beforeEach(async () => {
    mockQuery = vi.fn().mockResolvedValue([]);
    const mockDataSource = { query: mockQuery } as unknown as DataSource;
    service = new ExportReportService(mockDataSource);
  });

  it('retorna un XLSX binario con Resumen, Detalle y Errores, sin usar cron ni disco', async () => {
    const result = await service.generateXlsx('all', new Date('2026-08-01T00:00:00.000Z'), new Date('2026-08-31T23:59:59.999Z'));

    expect(result).toBeInstanceOf(Buffer);
    expect(result.length).toBeGreaterThan(0);
    expect(mockQuery).toHaveBeenCalledTimes(3);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(result as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(['Resumen', 'Detalle', 'Errores']);
    expect(workbook.getWorksheet('Detalle')?.getRow(1).values).toEqual([undefined, 'Nombre', 'Número', 'Comentarios', 'Fecha de llegada a dealerADMIN']);
    for (const sheet of workbook.worksheets) {
      const fill = sheet.getRow(1).fill;
      expect(fill.type).toBe('pattern');
      if (fill.type === 'pattern') expect(fill.fgColor?.argb).toMatch(/0B817A$/i);
      expect(sheet.views[0]?.state).toBe('frozen');
    }
  });

  it('exporta comentarios con solo las opciones disponibles y la fecha de llegada', async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        received_at: '2026-08-21T12:00:00.000Z',
        name: 'Maria Lopez',
        phone: '+15559876543',
        vehicle_type: 'SUV',
        down_payment: '$1000',
        purchase_timeline: 'este mes',
        documents: 'prueba de ingresos',
        identification: 'ID-77',
        bank_account: null,
        status: 'pending',
        sent_at: null,
      }])
      .mockResolvedValueOnce([]);

    const result = await service.generateXlsx('all', new Date('2026-08-01T00:00:00.000Z'), new Date('2026-08-31T23:59:59.999Z'));
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(result as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const detailRow = workbook.getWorksheet('Detalle')?.getRow(2);

    expect(detailRow?.getCell(1).value).toBe('Maria Lopez');
    expect(detailRow?.getCell(2).value).toBe('+15559876543');
    expect(detailRow?.getCell(3).value).toBe('SUV, $1000 de down, ID y prueba de ingresos, quiere comprar este mes');
    expect(detailRow?.getCell(3).value).not.toContain('ID-77');
    expect(detailRow?.getCell(4).value).toEqual(new Date('2026-08-21T12:00:00.000Z'));
    expect([1, 2, 3, 4].every((column) => detailRow?.getCell(column).value !== null && detailRow?.getCell(column).value !== undefined)).toBe(true);
  });

  it('resume ID y cuenta bancaria sin exponer el identificador de la persona', async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        received_at: '2026-08-22T12:00:00.000Z',
        name: 'Jose Ramirez',
        phone: '+15550002222',
        vehicle_type: 'Sedan',
        down_payment: null,
        purchase_timeline: 'este mes',
        documents: null,
        identification: 'PASSPORT-44',
        bank_account: 'si',
        status: 'pending',
        sent_at: null,
      }])
      .mockResolvedValueOnce([]);

    const result = await service.generateXlsx('all', new Date('2026-08-01T00:00:00.000Z'), new Date('2026-08-31T23:59:59.999Z'));
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(result as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const detailRow = workbook.getWorksheet('Detalle')?.getRow(2);

    expect(detailRow?.getCell(3).value).toBe('Sedan, ID y cuenta bancaria, quiere comprar este mes');
    expect(detailRow?.getCell(3).value).not.toContain('PASSPORT-44');
  });

  it('cuenta únicamente la relación lead-dealer del rango y dealer solicitado', async () => {
    mockQuery.mockResolvedValueOnce([{ count: '7' }]);

    await expect(service.countLeads('dealer-1', {
      from: new Date('2026-08-01T00:00:00.000Z'),
      to: new Date('2026-08-31T23:59:59.999Z'),
    })).resolves.toBe(7);
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('COALESCE(ld.assigned_dealer_id, ld.dealer_id)'), expect.any(Array));
  });
});
