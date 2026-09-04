import { describe, expect, it } from 'vitest';
import { selectInitialQueueLeads } from './queue-selection';

const dealers = [{ id: 'fredericksburg' }, { id: 'laurel' }];
const leads = [
  { id: 'fred-lead', dealerId: 'fredericksburg' },
  { id: 'laurel-lead', dealerId: 'laurel' },
];

describe('selectInitialQueueLeads', () => {
  it('does not mix dealers during the first unfiltered queue load', () => {
    expect(selectInitialQueueLeads(leads, dealers)).toEqual([leads[0]]);
  });

  it('keeps an explicitly selected dealer response untouched', () => {
    expect(selectInitialQueueLeads(leads, dealers, 'laurel')).toEqual(leads);
    expect(selectInitialQueueLeads(leads, dealers, undefined, ['fredericksburg', 'laurel'])).toEqual(leads);
  });

  it('returns no leads when the first dealer has no matching relationship', () => {
    expect(selectInitialQueueLeads([leads[1]], dealers)).toEqual([]);
  });
});
