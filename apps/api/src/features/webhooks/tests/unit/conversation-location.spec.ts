import { describe, expect, it } from 'vitest';
import { extractConversationLocation, extractLocationCandidates } from '../../application/conversation-location';

describe('extractConversationLocation', () => {
  it('captures an Easterns zone and postal code from the conversation', () => {
    expect(extractConversationLocation('I live in Baltimore, MD 21201 and want my car with Easterns.')).toEqual({
      city: 'baltimore',
      state: 'MD',
      zip_code: '21201',
      easterns_zone: 'baltimore',
    });
  });

  it('does not mistake a timeline phrase for a city', () => {
    expect(extractConversationLocation('I want to buy this month.')).toEqual({
      city: null,
      state: null,
      zip_code: null,
      easterns_zone: null,
    });
  });

  it('keeps a city-only reply available for database resolution', () => {
    expect(extractLocationCandidates('What city are you in? Odenton')).toContain('odenton');
  });

  it('does not turn a vehicle model into a location candidate', () => {
    expect(extractLocationCandidates('I want a Tacoma')).not.toContain('tacoma');
  });

  it('keeps the explicitly stated city and state after a vehicle reply', () => {
    const candidates = extractLocationCandidates('Troca, que queria una troca\nElkton MD');
    expect(candidates).toContain('elkton');
    expect(candidates).not.toContain('troca');
  });
});
