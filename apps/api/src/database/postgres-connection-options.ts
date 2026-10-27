/**
 * Bounds for the pg pool used by the API and the Guard.
 *
 * A dropped Neon connection must fail fast so a Guard invocation can persist
 * its retry state and let the next scheduled attempt recover the contact.
 */
export const POSTGRES_EXTRA = {
  connectionTimeoutMillis: 5_000,
  query_timeout: 30_000,
  statement_timeout: 30_000,
  idle_in_transaction_session_timeout: 15_000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
} as const;
