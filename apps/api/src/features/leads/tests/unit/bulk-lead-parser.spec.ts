import { describe, expect, it } from 'vitest';
import { parseBulkLeads } from '../../domain/bulk-lead-parser';

describe('parseBulkLeads', () => {
  it('parses the pipe format and normalizes the standalone down payment', () => {
    const [lead] = parseBulkLeads('Ana Torres | 301-987-6543 | SUV | 2,000 | prueba de ingresos | esta semana');
    expect(lead).toMatchObject({ name: 'Ana Torres', phone: '+13019876543', dto: { vehicle_type: 'SUV', down_payment: '2000', documents: 'prueba de ingresos', purchase_timeline: 'this week' } });
  });

  it('parses labeled fields and urgent Spanish timing', () => {
    const [lead] = parseBulkLeads('nombre: Luis Perez; telefono: 3019876548; vehiculo: Toyota RAV4; down: dos mil; documentos: licencia; tiempo de compra: Para ya');
    expect(lead.dto).toMatchObject({ name: 'Luis Perez', phone: '+13019876548', vehicle_type: 'Toyota RAV4', down_payment: '2000', purchase_timeline: 'today' });
  });

  it('reports malformed rows without stopping the batch', () => {
    expect(parseBulkLeads('Sin teléfono | SUV')).toMatchObject([{ rowNumber: 1, error: 'Falta el teléfono.' }]);
  });
});
