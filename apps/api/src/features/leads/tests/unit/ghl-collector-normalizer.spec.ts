import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const body = readFileSync(resolve(__dirname, '../../domain/ghl-collector-normalizer.js'), 'utf8');
const execute = (inputData: Record<string, unknown>) => new Function('inputData', body)(inputData) as Record<string, any>;

describe('HighLevel collector custom-code normalizer', () => {
  it('promotes a complete qualification memory without custom fields', () => {
    const result = execute({
      qualification_memory: 'vehicle_type = SUV\ndown_payment: 2000\ndocuments: driver license, proof of income\npurchase_timeline: this week',
    });
    expect(result).toMatchObject({
      vehicle_type: 'SUV',
      down_payment: '2000',
      purchase_timeline: 'this week',
      identification: 'yes',
      has_income_proof: 'yes',
      qualification_complete: true,
      qualification_source: 'qualification_memory',
      missing_qualification: [],
    });
  });

  it('uses memory to repair stale custom fields and reports both sources', () => {
    const result = execute({
      vehicle_type: 'Truck',
      down_payment: '10',
      documents: 'not specified',
      qualification_memory: 'vehicle: SUV; down payment: 2K; documents: ID and proof of income; timeline: today',
    });
    expect(result).toMatchObject({
      vehicle_type: 'SUV',
      down_payment: '2000',
      purchase_timeline: 'today',
      identification: 'yes',
      has_income_proof: 'yes',
      qualification_complete: true,
      qualification_source: 'both',
    });
  });

  it('does not promote a campaign-button suffix into a down payment', () => {
    const result = execute({ message: 'Quiero mi Auto con Eastern!10', down_payment: '10' });
    expect(result.down_payment).toBe('');
    expect(result.qualification_complete).toBe(false);
  });

  it.each(['Quiero cambiar mi vehículo', 'Cambio de auto', 'I want to change my vehicle'])('maps vehicle-change language to trade-in: %s', (message) => {
    const result = execute({ message });
    expect(result.down_payment).toBe('trade-in');
  });

  it('keeps an incomplete memory on the collector branch and names what is missing', () => {
    const result = execute({ qualification_memory: 'vehicle: SUV; down payment: 2K; documents: identification: yes' });
    expect(result.qualification_complete).toBe(false);
    expect(result.missing_qualification).toEqual(['purchase_timeline', 'proof_of_income']);
  });

  it('normalizes an explicit phone from the inbound message for the GHL contact phone output', () => {
    const result = execute({
      message: 'Sedan, mi numero de telefono es (804) 309-2531',
      qualification_memory: 'documents: identification: yes; proof of income: yes',
    });
    expect(result).toMatchObject({ vehicle_type: 'Sedan', phone: '+18043092531' });
    expect(result.qualification_memory).toContain('vehicle: Sedan');
  });

  it('prefers the phone written in the message and ignores a stale contact phone', () => {
    const result = execute({
      phone: '+14970120410',
      message: 'Mi número es 8049701204',
    });

    expect(result.phone).toBe('+18049701204');
  });

  it('does not copy contact.phone when the conversation has no phone', () => {
    const result = execute({
      phone: '+14970120410',
      message: 'Estoy buscando una SUV',
    });

    expect(result.phone).toBe('');
  });

  it('captures a standalone full-name answer without treating a vehicle request as a name', () => {
    expect(execute({ message: 'María José López' }).real_name).toBe('María José López');
    expect(execute({ message: 'Quiero una camioneta' }).real_name).toBe('');
  });

  it('does not convert vehicle digits in qualification memory into a phone', () => {
    const result = execute({
      qualification_memory: 'real_name: Stefanni.veliz; vehicle: SUV20202020202020; timeline: today',
    });

    expect(result.phone).toBe('');
    expect(result.vehicle_type).toBe('SUV');
  });
});
