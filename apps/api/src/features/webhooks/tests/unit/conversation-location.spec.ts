import { describe, expect, it } from 'vitest';
import { extractConversationLocation } from '../../application/conversation-location';

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
});
