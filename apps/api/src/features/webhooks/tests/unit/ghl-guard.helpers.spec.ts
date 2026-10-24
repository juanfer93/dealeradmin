import { describe, expect, it } from 'vitest';
import { isRetryableGuardFailure } from '../../application/functions/ghl-guard/ghl-guard.helpers';

describe('GHL guard retry classification', () => {
  it('retries a released query runner instead of stranding the conversation', () => {
    expect(isRetryableGuardFailure(
      'QueryRunnerAlreadyReleasedError',
      'Query runner already released. Cannot run queries anymore.',
    )).toBe(true);
  });
  it('retries known transient Neon connection failures without retrying arbitrary SQL errors', () => {
    expect(isRetryableGuardFailure('QueryFailedError', 'server conn crashed?')).toBe(true);
    expect(isRetryableGuardFailure('Error', 'Connection terminated unexpectedly')).toBe(true);
    expect(isRetryableGuardFailure('error', 'Authentication timed out')).toBe(true);
    expect(isRetryableGuardFailure('QueryFailedError', 'duplicate key value violates unique constraint')).toBe(false);
  });
});
