import { describe, expect, it } from 'vitest';
import { visibleDownPayment } from './down-payment-visibility';

describe('visibleDownPayment', () => {
  it('shows general down payments from $1,000', () => {
    expect(visibleDownPayment('1000', 'Offlease Motors Stafford')).toBe('1000');
    expect(visibleDownPayment('999', 'Offlease Motors Stafford')).toBe('1000');
  });

  it('applies Fredericksburg’s $1,500 minimum', () => {
    expect(visibleDownPayment('1499', 'Offlease Fredericksburg')).toBe('');
    expect(visibleDownPayment('1500', 'Offlease Fredericksburg')).toBe('1500');
    expect(visibleDownPayment('999', 'Offlease Fredericksburg')).toBe('');
  });

  it('uses the upper endpoint when a range reaches the minimum', () => {
    expect(visibleDownPayment('$1,000–$1,500', 'Offlease Fredericksburg')).toBe('$1,000–$1,500');
    expect(visibleDownPayment('$1,000–$1,499', 'Offlease Fredericksburg')).toBe('');
  });

  it('parses amounts expressed with a k suffix', () => {
    expect(visibleDownPayment('1.5k', 'Offlease Fredericksburg')).toBe('1.5k');
    expect(visibleDownPayment('1k', 'Offlease Motors Stafford')).toBe('1k');
  });
});
