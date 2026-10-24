import type { QueryRunner } from 'typeorm';

export const WEBHOOK_TRANSACTION_SAFETY_SQL =
  `SET LOCAL lock_timeout = '2s'; SET LOCAL statement_timeout = '30s'; SET LOCAL idle_in_transaction_session_timeout = '15s'`;

export async function configureWebhookTransactionSafety(runner: Pick<QueryRunner, 'query'>): Promise<void> {
  await runner.query(WEBHOOK_TRANSACTION_SAFETY_SQL);
}
