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
      `INSERT INTO conversations (lead_id, ghl_location_id, ghl_contact_id, ghl_conversation_id, channel, status, first_message_at, last_message_at)
       SELECT $1::uuid, d.ghl_location_id, $2, $3, 'whatsapp', 'queued', '2026-11-01T10:00:00Z', '2026-11-01T10:02:00Z'
       FROM dealers d WHERE d.id = $4::uuid RETURNING id::text AS id`,
      [leadId, contactId, `${contactId}-conversation`, dealerId],
    ) as Array<{ id: string }>;
    const secondConversation = await dataSource.query(
      `INSERT INTO conversations (lead_id, ghl_location_id, ghl_contact_id, ghl_conversation_id, channel, status, first_message_at, last_message_at)
       SELECT $1::uuid, d.ghl_location_id, $2, $3, 'whatsapp', 'queued', '2026-11-01T10:05:00Z', '2026-11-01T10:05:00Z'
       FROM dealers d WHERE d.id = $4::uuid RETURNING id::text AS id`,
      [leadId, contactId, `${contactId}-conversation-2`, dealerId],
    ) as Array<{ id: string }>;
    await dataSource.query(
      `INSERT INTO conversation_messages (conversation_id, dedupe_key, ghl_message_id, direction, body, occurred_at, raw_payload)
       VALUES ($1::uuid, $2, $3, 'inbound', 'WhatsApp inbound test', '2026-11-01T10:00:00Z', '{"dealeradmin_guard":{"fetched_at":"2026-11-01T10:10:00Z"}}'::jsonb),
              ($1::uuid, $4, $5, 'inbound', 'WhatsApp inbound test', '2026-11-01T10:00:20Z', '{}'::jsonb),
              ($1::uuid, $6, $7, 'outbound', 'WhatsApp bot response', '2026-11-01T10:02:00Z', '{"dealeradmin_guard":{}}'::jsonb),
              ($8::uuid, $9, $10, 'inbound', 'Second WhatsApp conversation', '2026-11-01T10:05:00Z', '{"dealeradmin_guard":{}}'::jsonb)`,
      [conversations[0].id, `${contactId}-in-guard`, `${contactId}-message-1`, `${contactId}-in-event`, `${contactId}-event-1`, `${contactId}-out`, `${contactId}-message-2`, secondConversation[0].id, `${contactId}-second-in`, `${contactId}-message-3`],
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

  it('merges same-channel conversations, removes webhook/history mirrors, and loads bot replies for sent contacts', async () => {
    const result = await controller.conversation({ cookies: { dealeradmin_session: 'local-test' } } as never, leadId, dealerId);
    expect(result.conversations).toHaveLength(1);
    expect(result.conversations[0]).toMatchObject({
      channel: 'whatsapp', status: 'queued',
      messages: [
        { direction: 'inbound', body: 'WhatsApp inbound test' },
        { direction: 'outbound', body: 'WhatsApp bot response' },
        { direction: 'inbound', body: 'Second WhatsApp conversation' },
      ],
    });
    expect(result.conversations[0]?.messages).toHaveLength(3);
  }, 20_000);
});
