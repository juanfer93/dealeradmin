import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LeadsController } from '../../presentation/leads.controller';

const databaseUrl = process.env.GHL_CONTEXT_E2E_DATABASE_URL || process.env.DATABASE_URL;
const describeDockerDatabase = databaseUrl && /(localhost|127\.0\.0\.1)/i.test(databaseUrl) ? describe : describe.skip;

describeDockerDatabase('Lead conversation viewer against Docker PostgreSQL', () => {
  let dataSource: DataSource;
  let controller: LeadsController;
  let leadId = '';
  let dealerId = '';
  const contactId = `codex-viewer-${Date.now()}`;

  beforeAll(async () => {
    dataSource = new DataSource({ type: 'postgres', url: databaseUrl, entities: [] });
    await dataSource.initialize();
    const dealers = await dataSource.query('SELECT id::text AS id FROM dealers WHERE active = true ORDER BY created_at LIMIT 1') as Array<{ id: string }>;
    if (!dealers[0]) throw new Error('The Docker database has no active dealer fixture');
    dealerId = dealers[0].id;
    const leads = await dataSource.query(
      `INSERT INTO leads (first_name, last_name, ghl_contact_id, ghl_location_id, source)
       SELECT 'Conversation', 'Viewer Test', $1, ghl_location_id, 'stafford'
       FROM dealers WHERE id = $2::uuid RETURNING id::text AS id`,
      [contactId, dealerId],
    ) as Array<{ id: string }>;
    leadId = leads[0].id;
    await dataSource.query(
      `INSERT INTO lead_dealers (lead_id, dealer_id, assigned_dealer_id, routing_status, status)
       VALUES ($1::uuid, $2::uuid, $2::uuid, 'resolved', 'sent')`, [leadId, dealerId],
    );
    const conversations = await dataSource.query(
      `INSERT INTO conversations (lead_id, ghl_location_id, ghl_contact_id, ghl_conversation_id, channel, status)
       SELECT $1::uuid, d.ghl_location_id, $2, $3, 'whatsapp', 'queued'
       FROM dealers d WHERE d.id = $4::uuid RETURNING id::text AS id`,
      [leadId, contactId, `${contactId}-conversation`, dealerId],
    ) as Array<{ id: string }>;
    await dataSource.query(
      `INSERT INTO conversation_messages (conversation_id, dedupe_key, direction, body, occurred_at)
       VALUES ($1::uuid, $2, 'inbound', 'WhatsApp inbound test', '2026-11-01T10:00:00Z'),
              ($1::uuid, $3, 'outbound', 'WhatsApp bot response', '2026-11-01T10:02:00Z')`,
      [conversations[0].id, `${contactId}-in`, `${contactId}-out`],
    );
    controller = new LeadsController(
      dataSource as never,
      { verifySession: () => true } as never,
      { execute: async () => undefined } as never,
      { queueLeadForBotSilence: async () => undefined } as never,
    );
  }, 20_000);

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    if (leadId) {
      await dataSource.query('DELETE FROM conversations WHERE lead_id = $1::uuid', [leadId]);
      await dataSource.query('DELETE FROM lead_dealers WHERE lead_id = $1::uuid', [leadId]);
      await dataSource.query('DELETE FROM leads WHERE id = $1::uuid', [leadId]);
    }
    await dataSource.destroy();
  });

  it('loads both sides of a sent contact conversation and retains queued state', async () => {
    await expect(controller.conversation({ cookies: { dealeradmin_session: 'local-test' } } as never, leadId, dealerId))
      .resolves.toMatchObject({ conversations: [{
        channel: 'whatsapp', status: 'queued',
        messages: [
          { direction: 'inbound', body: 'WhatsApp inbound test' },
          { direction: 'outbound', body: 'WhatsApp bot response' },
        ],
      }] });
  }, 20_000);
});
