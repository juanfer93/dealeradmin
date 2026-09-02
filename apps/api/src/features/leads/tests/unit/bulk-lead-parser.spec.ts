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

  it('assigns each fact in the natural-language format used by operators', () => {
    const [lead] = parseBulkLeads('Juan Perez 3212343213 sedan, 1500 de down, id y cuenta bancaria, quiere comprar este mes, prueba de ingresos');
    expect(lead).toMatchObject({ name: 'Juan Perez', phone: '+13212343213' });
    expect(lead.dto).toMatchObject({
      vehicle_type: 'sedan',
      down_payment: '1500',
      purchase_timeline: 'this month',
      identification: 'yes',
      bank_account: 'yes',
    });
    expect(lead.dto?.documents).toContain('prueba de ingresos');
  });

  it('removes WhatsApp export metadata before assigning lead fields', () => {
    const [lead] = parseBulkLeads('[8:27 a. m., 2/9/2026] JFPI: Abraham Agosto 540 773 9959 Truck, $2500 de down, id y cuenta bancaria, quiere comprar lo más pronto posible');
    expect(lead).toMatchObject({ name: 'Abraham Agosto', phone: '+15407739959' });
    expect(lead.rawLine).not.toContain('JFPI');
    expect(lead.rawLine).not.toContain('8:27');
    expect(lead.dto).toMatchObject({ vehicle_type: 'Truck', down_payment: '2500', identification: 'yes', bank_account: 'yes', purchase_timeline: 'today' });
  });

  it('reports malformed rows without stopping the batch', () => {
    expect(parseBulkLeads('Sin teléfono | SUV')).toMatchObject([{ rowNumber: 1, error: 'Falta el teléfono.' }]);
  });
});
