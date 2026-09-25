import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConversationWebhookService } from '../../application/conversation-webhook.service';

const databaseUrl = process.env.KOONS_REAL_REPLAY_DATABASE_URL || process.env.DATABASE_URL;
const describeDatabase = databaseUrl && /(localhost|127\.0\.0\.1)/i.test(databaseUrl) ? describe : describe.skip;

describeDatabase('Koons real GHL transcript replay', () => {
  let dataSource: DataSource;
  const suffix = `koons-real-replay-${Date.now()}`;

  const cases = [
    {
      label: 'Culpeper / Jaimen Cruz',
      source: 'koons-culpeper',
      contactName: 'Jaimen Cruz',
      phone: '+18046532943',
      phoneMessageIndex: 1,
      messages: [
        'Holaa ando buscando una for runer 4x4 2010 ho 2015',
        '8046532943',
        'No se como trabajan ustedes',
      ],
      expectedVehicle: '4Runner',
    },
    {
      label: 'Fredericksburg / Luis A Sandoval',
      source: 'koons-fred',
      contactName: 'Dónde Queda Moon',
      phone: '+19198797239',
      phoneMessageIndex: 8,
      messages: [
        'Dónde queda moon?',
        'Dónde queda koon',
        'Fluke',
        'Truk',
        'Tecoma',
        'Economico',
        'No entra la llamada',
        'Llamarme por Messenger',
        'Este es mi numero 919 8797239',
        'Mil',
        'Puedes enseñarlos',
        'Vivo en carolina',
        'Estoy buscando pociones',
        'Si',
        'Tengo todos mis papeles?',
        'Ya le llamé y no entra la llamada',
      ],
      expectedVehicle: 'Tacoma',
    },
  ] as const;

  const ids = cases.map((_, index) => ({
    contactId: `${suffix}-${index}-contact`,
    conversationId: `${suffix}-${index}-conversation`,
  }));

  beforeAll(async () => {
    if (!databaseUrl) throw new Error('KOONS_REAL_REPLAY_DATABASE_URL or DATABASE_URL is required');
    dataSource = new DataSource({ type: 'postgres', url: databaseUrl, entities: [] });
    await dataSource.initialize();
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    for (const { contactId } of ids) {
      await dataSource.query('DELETE FROM conversation_bot_pause_events WHERE ghl_contact_id = $1', [contactId]);
      await dataSource.query('DELETE FROM lead_dealers WHERE lead_id IN (SELECT id FROM leads WHERE ghl_contact_id = $1)', [contactId]);
      await dataSource.query(
        `DELETE FROM conversations
         WHERE ghl_contact_id = $1
            OR lead_id IN (SELECT id FROM leads WHERE ghl_contact_id = $1)`,
        [contactId],
      );
      await dataSource.query('DELETE FROM leads WHERE ghl_contact_id = $1', [contactId]);
    }
    await dataSource.query('DELETE FROM webhook_events WHERE event_id LIKE $1', [`${suffix}-%`]);
    await dataSource.destroy();
  });

  it.each(cases.map((testCase, index) => ({ ...testCase, index })))('$label is routable after replay', async ({ source, contactName, phone, phoneMessageIndex, messages, expectedVehicle, index }) => {
    const { contactId, conversationId } = ids[index];
    const replayNow = new Date('2026-09-25T14:30:00.000Z');
    const service = new ConversationWebhookService(dataSource);

    for (const [messageIndex, message] of messages.entries()) {
      const eventId = `${suffix}-${index}-${messageIndex}`;
      const occurredAt = new Date(replayNow.getTime() - (messages.length - messageIndex) * 60_000).toISOString();
      await service.acceptCustomerReplied({
        event_id: eventId,
        ghl_message_id: `${eventId}-message`,
        ghl_contact_id: contactId,
        ghl_conversation_id: conversationId,
        channel: 'messenger',
        contact_name: contactName,
        contact_phone: messageIndex >= phoneMessageIndex ? phone : '',
        message_body: message,
        occurred_at: occurredAt,
      }, source, { contactId, conversationId, messageId: `${eventId}-message`, testNow: new Date(occurredAt) });
    }

    const conversationRows = await dataSource.query(
      'SELECT id FROM conversations WHERE ghl_contact_id = $1 AND ghl_conversation_id = $2',
      [contactId, conversationId],
    ) as Array<{ id: string }>;
    expect(conversationRows).toHaveLength(1);
    // The local Docker database contains unrelated historical waiting rows.
    // Invoke the same release path for this isolated replay instead of letting
    // an unrelated Easterns row fail the batch poll before reaching Koons.
    const releaseDueConversation = (service as unknown as {
      releaseDueConversation: (id: string, now: Date) => Promise<boolean>;
    }).releaseDueConversation.bind(service);
    expect(await releaseDueConversation(conversationRows[0].id, new Date(replayNow.getTime() + 60_000))).toBe(true);

    const rows = await dataSource.query(
      `SELECT c.status, c.qualification_snapshot, l.canonical_phone,
              (SELECT count(*) FROM lead_dealers ld WHERE ld.lead_id = l.id) AS dealer_relations
       FROM conversations c
       JOIN leads l ON l.id = c.lead_id
       WHERE c.ghl_contact_id = $1 AND c.ghl_conversation_id = $2`,
      [contactId, conversationId],
    ) as Array<{ status: string; qualification_snapshot: Record<string, unknown>; canonical_phone: string; dealer_relations: string }>;

    expect(rows).toHaveLength(1);
    expect(rows[0].qualification_snapshot).toMatchObject({
      phone,
      vehicle_type: expectedVehicle,
      qualification_complete: true,
    });
    expect(rows[0].canonical_phone).toBe(phone);
    expect(Number(rows[0].dealer_relations)).toBe(1);
    expect(['queued', 'sent']).toContain(rows[0].status);
  }, 30_000);
});
