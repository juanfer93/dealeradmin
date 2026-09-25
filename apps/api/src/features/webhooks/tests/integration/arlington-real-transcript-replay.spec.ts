import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConversationWebhookService } from '../../application/conversation-webhook.service';

const databaseUrl = process.env.ARLINGTON_REAL_REPLAY_DATABASE_URL || process.env.DATABASE_URL;
const describeDatabase = databaseUrl && /(localhost|127\.0\.0\.1)/i.test(databaseUrl) ? describe : describe.skip;

describeDatabase('Arlington real GHL transcript replay', () => {
  let dataSource: DataSource;
  const suffix = `arlington-real-replay-${Date.now()}`;
  const cases = [
    {
      label: 'Paolitha Garcia / persisted GHL turns',
      contactName: 'Paolitha Garcia',
      phone: '+15716161220',
      messages: [
        'Quiero financiar un auto',
        'Una troca',
        'Y si no tengo para el enganche',
      ],
      phoneMessageIndex: null,
      phoneMetadataIndex: 2,
      expectedVehicle: 'truck',
      expectedPhone: '',
      shouldQueue: false,
    },
    {
      label: 'Steve de la Cruz / persisted GHL turns stay blocked without vehicle',
      contactName: 'Steve de la Cruz',
      phone: '+15406766165',
      messages: [
        '¿Hay algún descuento o promoción actualmente disponible?',
        'Si dependiendo lo que me ofrezcan',
        'Tengo licencia de conducir, pasaporte, colillas de pago',
        'Sería para el mes de octubre si es buena la oferta y tasa de interés que trabajen',
        'Si',
      ],
      phoneMessageIndex: null,
      phoneMetadataIndex: 0,
      expectedVehicle: '',
      expectedPhone: '',
      shouldQueue: false,
    },
    {
      label: 'Steve de la Cruz / complete GHL transcript',
      contactName: 'Steve de la Cruz',
      phone: '+15406766165',
      messages: [
        'Page: Ventas de Autos de Arlington Motors. ¿Hay algún descuento o promoción actualmente disponible?',
        'Estoy buscando honda pilot del 2023 o 2024',
        'Pueden enviarme por correo: steve.delacruzn@gmail.com',
        'Por texto de preferencia, porque tengo bloqueo de números que no sean de mis contactos guardados: (540)676-6165',
        'Si dependiendo lo que me ofrezcan',
        'Tengo licencia de conducir, pasaporte, colillas de pago',
        'Sería para el mes de octubre si es buena la oferta y tasa de interés que trabajen',
        'Si',
      ],
      phoneMessageIndex: 3,
      phoneMetadataIndex: 0,
      expectedVehicle: 'Honda Pilot',
      expectedPhone: '+15406766165',
      shouldQueue: true,
    },
    {
      label: 'Paolitha Garcia / complete GHL transcript',
      contactName: 'Paolitha Garcia',
      phone: '+15716161220',
      messages: [
        'Quiero financiar un auto',
        'Una troca',
        '(571) 616-1220',
        'Y si no tengo para el enganche',
      ],
      phoneMessageIndex: 2,
      phoneMetadataIndex: 2,
      expectedVehicle: 'truck',
      expectedPhone: '+15716161220',
      shouldQueue: true,
    },
  ] as const;

  const ids = cases.map((_, index) => ({
    contactId: `${suffix}-${index}-contact`,
    conversationId: `${suffix}-${index}-conversation`,
  }));

  beforeAll(async () => {
    if (!databaseUrl) throw new Error('ARLINGTON_REAL_REPLAY_DATABASE_URL or DATABASE_URL is required');
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

  it.each(cases.map((testCase, index) => ({ ...testCase, index })))('$label', async ({ contactName, phone, messages, phoneMessageIndex, phoneMetadataIndex, expectedVehicle, expectedPhone, shouldQueue, index }) => {
    const { contactId, conversationId } = ids[index];
    const replayNow = new Date('2026-09-25T14:50:00.000Z');
    const service = new ConversationWebhookService(dataSource);

    for (const [messageIndex, message] of messages.entries()) {
      const eventId = `${suffix}-${index}-${messageIndex}`;
      const occurredAt = new Date(replayNow.getTime() - (messages.length - messageIndex) * 60_000).toISOString();
      const typedPhone = phoneMessageIndex !== null && messageIndex >= phoneMessageIndex ? phone : '';
      const normalizedGhlPhone = messageIndex >= phoneMetadataIndex ? phone : '';
      await service.acceptCustomerReplied({
        event_id: eventId,
        ghl_message_id: `${eventId}-message`,
        ghl_contact_id: contactId,
        ghl_conversation_id: conversationId,
        channel: 'messenger',
        contact_name: contactName,
        contact_phone: typedPhone || normalizedGhlPhone,
        message_body: message,
        occurred_at: occurredAt,
      }, 'arlington', { contactId, conversationId, messageId: `${eventId}-message`, testNow: new Date(occurredAt) });
    }

    const conversationRows = await dataSource.query(
      'SELECT id FROM conversations WHERE ghl_contact_id = $1 AND ghl_conversation_id = $2',
      [contactId, conversationId],
    ) as Array<{ id: string }>;
    expect(conversationRows).toHaveLength(1);
    const rowsBeforeRelease = await dataSource.query(
      `SELECT c.status, c.qualification_snapshot, l.canonical_phone,
              (SELECT count(*) FROM lead_dealers ld WHERE ld.lead_id = l.id) AS dealer_relations
       FROM conversations c
       JOIN leads l ON l.id = c.lead_id
       WHERE c.ghl_contact_id = $1 AND c.ghl_conversation_id = $2`,
      [contactId, conversationId],
    ) as Array<{ status: string; qualification_snapshot: Record<string, unknown>; canonical_phone: string | null; dealer_relations: string }>;

    expect(rowsBeforeRelease[0].qualification_snapshot).toMatchObject({
      phone: expectedPhone,
      vehicle_type: expectedVehicle,
      qualification_complete: shouldQueue,
    });
    if (!shouldQueue) {
      expect(rowsBeforeRelease[0].status).toBe('partial');
      expect(Number(rowsBeforeRelease[0].dealer_relations)).toBe(0);
      return;
    }

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

    expect(rows[0].canonical_phone).toBe(phone);
    expect(Number(rows[0].dealer_relations)).toBe(1);
    expect(['queued', 'sent']).toContain(rows[0].status);
  }, 30_000);
});
