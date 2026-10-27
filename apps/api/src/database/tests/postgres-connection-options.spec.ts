import { describe, expect, it } from 'vitest';
import { POSTGRES_EXTRA } from '../postgres-connection-options';

describe('PostgreSQL connection safety', () => {
  it('bounds connection, query, and idle transaction waits', () => {
    expect(POSTGRES_EXTRA).toMatchObject({
      connectionTimeoutMillis: 5_000,
      query_timeout: 30_000,
      statement_timeout: 30_000,
      idle_in_transaction_session_timeout: 15_000,
      keepAlive: true,
    });
  });
});
