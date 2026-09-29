import { readFileSync } from 'node:fs';
import { DataSource } from 'typeorm';
import { ConversationWebhookService } from '../apps/api/src/features/webhooks/application/conversation-webhook.service';

const databaseUrl = process.env.MANUEL_REPLAY_DATABASE_URL || 'postgresql://dealeradmin:dealeradmin_local@127.0.0.1:5432/dealeradmin';
const exportPath = process.env.MANUEL_RAW_EXPORT || 'C:\\Users\\Dell\\Downloads\\cool-moon-85100969_production_neondb_2026-09-29_09-48-11.json';
const contactId = 'Rr3ZcwuCtEK2l4yODU9w';
const conversationId = `manuel-stafford-replay-${Date.now()}`;
const rows = JSON.parse(readFileSync(exportPath, 'utf8')) as Array<{
  ghl_message_id: string;
  occurred_at: string;
  raw_payload: string;
}>;

const dataSource = new DataSource({ type: 'postgres', url: databaseUrl, entities: [] });
const eventIds: string[] = [];

async function main(): Promise<void> {
  await dataSource.initialize();
  const service = new ConversationWebhookService(dataSource);
  try {
    for (const [index, row] of rows.entries()) {
      const raw = JSON.parse(row.raw_payload) as Record<string, unknown>;
      const response = await service.acceptCustomerReplied(
        { ...raw, occurred_at: row.occurred_at },
        'stafford',
        { contactId, conversationId, messageId: row.ghl_message_id, testNow: new Date(row.occurred_at) },
        JSON.stringify(raw),
      );
      eventIds.push(response.eventId);
      process.stdout.write(`replayed ${index + 1}/${rows.length}: ${row.ghl_message_id}\n`);
    }

    const result = await dataSource.query(
      `SELECT c.status, c.qualification_snapshot, COUNT(cm.id)::int AS message_count
       FROM conversations c
       JOIN conversation_messages cm ON cm.conversation_id = c.id
       WHERE c.ghl_contact_id = $1 AND c.ghl_conversation_id = $2
       GROUP BY c.id, c.status, c.qualification_snapshot`,
      [contactId, conversationId],
    ) as Array<{ status: string; qualification_snapshot: Record<string, unknown>; message_count: number }>;
    process.stdout.write(`${JSON.stringify({ contactId, conversationId, result }, null, 2)}\n`);
  } finally {
    await dataSource.query('DELETE FROM lead_dealers WHERE lead_id IN (SELECT id FROM leads WHERE ghl_contact_id = $1)', [contactId]);
    await dataSource.query('DELETE FROM conversations WHERE ghl_contact_id = $1 AND ghl_conversation_id = $2', [contactId, conversationId]);
    await dataSource.query('DELETE FROM leads WHERE ghl_contact_id = $1', [contactId]);
    if (eventIds.length > 0) await dataSource.query('DELETE FROM webhook_events WHERE event_id = ANY($1::varchar[])', [eventIds]);
    await dataSource.destroy();
  }
}

void main();
