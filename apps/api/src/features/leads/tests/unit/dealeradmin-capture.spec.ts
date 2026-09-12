import { describe, expect, it } from 'vitest';
import { DealeradminCaptureContractSchema } from '@dealeradmin/contracts';
import { buildDealeradminCaptureContract } from '../../domain/dealeradmin-capture';
import { normalizeCollectorInput } from '../../domain/collector-normalizer';

describe('dealerADMIN capture contract', () => {
  it('keeps raw chat evidence append-only and marks phone-only intake as partial', () => {
    const input = {
      message: 'Mi número es 804-309-2531',
      chat_history_log: 'Quiero una SUV',
      contact_id: 'contact-1',
      occurred_at: '2026-09-10T12:00:00.000Z',
    };
    const normalized = normalizeCollectorInput(input);
    const contract = buildDealeradminCaptureContract(input, normalized, '+18043092531');

    expect(() => DealeradminCaptureContractSchema.parse(contract)).not.toThrow();
    expect(contract.raw_evidence.append_only).toBe(true);
    expect(contract.raw_evidence.transcript).toContain('Quiero una SUV');
    expect(contract.raw_evidence.transcript).toContain('Mi número es 804-309-2531');
    expect(contract.extraction.fields.phone.source).toBe('message');
    expect(contract.extraction.completeness.status).toBe('partial');
    expect(contract.extraction.completeness.missing).toContain('down_payment');
    expect(contract.extraction.progress).toMatchObject({
      step: 'real_name',
      predicted_bot_question: '¿Cuál es tu nombre completo?',
      language: 'es',
    });
  });

  it('does not claim a phone from contaminated qualification memory', () => {
    const input = { qualification_memory: 'vehicle: SUV20202020202020; timeline: today' };
    const contract = buildDealeradminCaptureContract(input, normalizeCollectorInput(input), null);

    expect(contract.extraction.fields.phone.value).toBeNull();
    expect(contract.extraction.fields.phone.source).toBe('contact.phone');
    expect(contract.extraction.completeness.status).toBe('blocked');
  });
});
