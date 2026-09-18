import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConversationWebhookService } from '../../application/conversation-webhook.service';

const databaseUrl = process.env.MEDIA_PHONE_DATABASE_URL || process.env.DATABASE_URL;
const describeDatabase = databaseUrl && /(localhost|127\.0\.0\.1)/i.test(databaseUrl) ? describe : describe.skip;

describeDatabase('OCR phone evidence against local PostgreSQL', () => {
  let dataSource: DataSource;
  const suffix = `media-phone-qa-${Date.now()}`;
  const contactId = `${suffix}-contact`;
  const conversationId = `${suffix}-conversation`;
  const afterHoursContactId = `${suffix}-after-hours-contact`;
  const afterHoursConversationId = `${suffix}-after-hours-conversation`;
  const normalContactId = `${suffix}-normal-contact`;
  const normalConversationId = `${suffix}-normal-conversation`;
  const imageContactId = `${suffix}-image-contact`;
  const imageConversationId = `${suffix}-image-conversation`;
  const audioContactId = `${suffix}-audio-contact`;
  const audioConversationId = `${suffix}-audio-conversation`;
  const now = '2026-09-17T17:19:00.000Z';

  beforeAll(async () => {
    if (!databaseUrl) throw new Error('MEDIA_PHONE_DATABASE_URL is required');
    dataSource = new DataSource({ type: 'postgres', url: databaseUrl, entities: [] });
    await dataSource.initialize();
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    for (const qaContactId of [contactId, afterHoursContactId, normalContactId, imageContactId, audioContactId]) {
      await dataSource.query('DELETE FROM conversation_bot_pause_events WHERE ghl_contact_id = $1', [qaContactId]);
      await dataSource.query('DELETE FROM conversations WHERE ghl_contact_id = $1', [qaContactId]);
      await dataSource.query('DELETE FROM leads WHERE ghl_contact_id = $1', [qaContactId]);
    }
    await dataSource.query('DELETE FROM webhook_events WHERE event_id LIKE $1', [`${suffix}-%`]);
    await dataSource.destroy();
  });

  it('uses processed attachment OCR when GHL native Contact Phone is empty', async () => {
    const service = new ConversationWebhookService(dataSource);
    const common = {
      event_type: 'CustomerReplied',
      ghl_contact_id: contactId,
      ghl_conversation_id: conversationId,
      channel: 'messenger',
      contact_name: 'Job Castillo Castillo',
      contact_phone: '',
      occurred_at: now,
    };

    await service.acceptCustomerReplied({
      ...common,
      event_id: `${suffix}-vehicle`,
      ghl_message_id: `${suffix}-vehicle-message`,
      message_body: 'Estoy buscando una Tacoma',
    }, 'fredericksburg', { contactId, conversationId, messageId: `${suffix}-vehicle-message` });
    await service.acceptCustomerReplied({
      ...common,
      event_id: `${suffix}-down`,
      ghl_message_id: `${suffix}-down-message`,
      message_body: 'Tengo 3000 para el enganche',
    }, 'fredericksburg', { contactId, conversationId, messageId: `${suffix}-down-message` });
    await service.acceptCustomerReplied({
      ...common,
      event_id: `${suffix}-image`,
      ghl_message_id: `${suffix}-image-message`,
      message_body: '',
      message_attachments: [{
        url: 'https://links.example.test/job-castillo-phone.jpg',
        content_type: 'image/jpeg',
        filename: 'phone.jpg',
      }],
    }, 'fredericksburg', { contactId, conversationId, messageId: `${suffix}-image-message` });

    const attachment = await dataSource.query(
      `SELECT id FROM conversation_attachments WHERE ghl_conversation_id = $1`,
      [conversationId],
    ) as Array<{ id: string }>;
    expect(attachment).toHaveLength(1);

    // This is the media-worker's committed result, before its reconciliation
    // callback. No derived conversation_messages row is added on purpose: the
    // backend must not depend on GHL Contact Phone or on that extra row.
    await dataSource.query(
      `UPDATE conversation_attachments
       SET processing_status = 'done', extracted_text = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [attachment[0].id, 'Versión de hardware\nNúmero de teléfono\n+1-240-841-4199'],
    );

    const conversation = await dataSource.query(
      `SELECT id, status FROM conversations WHERE ghl_contact_id = $1`,
      [contactId],
    ) as Array<{ id: string; status: string }>;
    expect(conversation).toHaveLength(1);
    expect(conversation[0].status).toBe('partial');

    const result = await service.reconcileMediaConversation(conversation[0].id, new Date(now));
    expect(result.qualificationSnapshot).toMatchObject({
      phone: '+12408414199',
      vehicle_type: 'Tacoma',
      down_payment: '3000',
      required_down_payment: 3000,
      down_payment_sufficient: true,
    });
    expect(result.qualificationSnapshot?.missing_qualification).not.toContain('phone');
    expect(result.status).toBe('waiting_window');

    const persisted = await dataSource.query(
      `SELECT l.canonical_phone, c.status, c.ready_at, c.next_attempt_at, c.qualification_snapshot
       FROM conversations c JOIN leads l ON l.id = c.lead_id
       WHERE c.ghl_contact_id = $1`,
      [contactId],
    ) as Array<{ canonical_phone: string; status: string; ready_at: string; next_attempt_at: string; qualification_snapshot: Record<string, unknown> }>;
    expect(persisted[0]).toMatchObject({ canonical_phone: '+12408414199', status: 'waiting_window' });
    expect(new Date(persisted[0].ready_at).toISOString()).toBe(now);
    const firstNextAttempt = persisted[0].next_attempt_at;
    expect((persisted[0].qualification_snapshot as { phone: string }).phone).toBe('+12408414199');

    // A later reconciliation must reuse the original window instead of
    // pushing another 30-minute window from the current time.
    await service.reconcileMediaConversation(conversation[0].id, new Date('2026-09-17T17:29:00.000Z'));
    const afterSecondReconcile = await dataSource.query(
      `SELECT ready_at, next_attempt_at FROM conversations WHERE ghl_contact_id = $1`,
      [contactId],
    ) as Array<{ ready_at: string; next_attempt_at: string }>;
    expect(new Date(afterSecondReconcile[0].ready_at).toISOString()).toBe(now);
    expect(new Date(afterSecondReconcile[0].next_attempt_at).toISOString()).toBe(new Date(firstNextAttempt).toISOString());

    // A regular inbound webhook after the image must keep the OCR phone and
    // persist the new message normally.
    await service.acceptCustomerReplied({
      event_id: `${suffix}-after-image-text`,
      ghl_message_id: `${suffix}-after-image-text-message`,
      ghl_contact_id: contactId,
      ghl_conversation_id: conversationId,
      channel: 'messenger',
      contact_name: 'Job Castillo Castillo',
      contact_phone: '',
      message_body: 'Hoy mismo',
      occurred_at: '2026-09-17T17:30:00.000Z',
    }, 'fredericksburg', { contactId, conversationId });
    const afterNormalWebhook = await dataSource.query(
      `SELECT l.canonical_phone, c.qualification_snapshot,
              (SELECT COUNT(*) FROM conversation_messages m WHERE m.conversation_id = c.id) AS message_count
       FROM conversations c JOIN leads l ON l.id = c.lead_id
       WHERE c.ghl_contact_id = $1`,
      [contactId],
    ) as Array<{ canonical_phone: string; qualification_snapshot: { phone: string }; message_count: string }>;
    expect(afterNormalWebhook[0].canonical_phone).toBe('+12408414199');
    expect(afterNormalWebhook[0].qualification_snapshot.phone).toBe('+12408414199');
    expect(Number(afterNormalWebhook[0].message_count)).toBe(4);
  });

  it('uses the three-hour window after 3:00 p.m. without extending it on each cycle', async () => {
    const service = new ConversationWebhookService(dataSource);
    const afterHoursNow = '2026-09-17T20:01:00.000Z'; // 3:01 p.m. in America/Bogota.
    const common = {
      event_type: 'CustomerReplied',
      ghl_contact_id: afterHoursContactId,
      ghl_conversation_id: afterHoursConversationId,
      channel: 'messenger',
      contact_name: 'OCR After Hours',
      contact_phone: '',
      occurred_at: afterHoursNow,
    };
    await service.acceptCustomerReplied({
      ...common,
      event_id: `${suffix}-after-hours-vehicle`,
      ghl_message_id: `${suffix}-after-hours-vehicle-message`,
      message_body: 'Estoy buscando una Tacoma',
    }, 'fredericksburg', { contactId: afterHoursContactId, conversationId: afterHoursConversationId });
    await service.acceptCustomerReplied({
      ...common,
      event_id: `${suffix}-after-hours-down`,
      ghl_message_id: `${suffix}-after-hours-down-message`,
      message_body: 'Tengo 3000 para el enganche',
    }, 'fredericksburg', { contactId: afterHoursContactId, conversationId: afterHoursConversationId });
    await service.acceptCustomerReplied({
      ...common,
      event_id: `${suffix}-after-hours-image`,
      ghl_message_id: `${suffix}-after-hours-image-message`,
      message_body: '',
      message_attachments: [{ url: 'https://links.example.test/after-hours-phone.jpg', content_type: 'image/jpeg' }],
    }, 'fredericksburg', { contactId: afterHoursContactId, conversationId: afterHoursConversationId });
    const attachment = await dataSource.query(
      `SELECT id FROM conversation_attachments WHERE ghl_conversation_id = $1`,
      [afterHoursConversationId],
    ) as Array<{ id: string }>;
    await dataSource.query(
      `UPDATE conversation_attachments
       SET processing_status = 'done', extracted_text = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [attachment[0].id, 'Número de teléfono\n+1-240-841-4200'],
    );
    const conversation = await dataSource.query(
      `SELECT id FROM conversations WHERE ghl_contact_id = $1`,
      [afterHoursContactId],
    ) as Array<{ id: string }>;
    await service.reconcileMediaConversation(conversation[0].id, new Date(afterHoursNow));
    const first = await dataSource.query(
      `SELECT ready_at, next_attempt_at FROM conversations WHERE ghl_contact_id = $1`,
      [afterHoursContactId],
    ) as Array<{ ready_at: string; next_attempt_at: string }>;
    expect(new Date(first[0].ready_at).toISOString()).toBe(afterHoursNow);
    expect(new Date(first[0].next_attempt_at).toISOString()).toBe('2026-09-17T23:01:00.000Z');

    await service.reconcileMediaConversation(conversation[0].id, new Date('2026-09-17T20:31:00.000Z'));
    const second = await dataSource.query(
      `SELECT ready_at, next_attempt_at FROM conversations WHERE ghl_contact_id = $1`,
      [afterHoursContactId],
    ) as Array<{ ready_at: string; next_attempt_at: string }>;
    expect(new Date(second[0].ready_at).toISOString()).toBe(afterHoursNow);
    expect(new Date(second[0].next_attempt_at).toISOString()).toBe('2026-09-17T23:01:00.000Z');
  });

  it('keeps a normal text message on the existing path with a different contact id', async () => {
    const service = new ConversationWebhookService(dataSource);
    const eventId = `${suffix}-normal-text`;
    await service.acceptCustomerReplied({
      event_id: eventId,
      ghl_message_id: `${eventId}-message`,
      ghl_contact_id: normalContactId,
      ghl_conversation_id: normalConversationId,
      channel: 'messenger',
      contact_name: 'Normal Text Lead',
      contact_phone: '',
      message_body: 'Mi número es 240-841-4211. Estoy buscando un Corolla.',
      occurred_at: now,
    }, 'fredericksburg', { contactId: normalContactId, conversationId: normalConversationId });

    const rows = await dataSource.query(
      `SELECT l.canonical_phone, c.status, c.qualification_snapshot,
              (SELECT COUNT(*) FROM conversation_messages m WHERE m.conversation_id = c.id) AS message_count,
              (SELECT COUNT(*) FROM conversation_attachments a WHERE a.conversation_id = c.id) AS attachment_count
       FROM conversations c JOIN leads l ON l.id = c.lead_id
       WHERE c.ghl_contact_id = $1`,
      [normalContactId],
    ) as Array<{ canonical_phone: string; status: string; qualification_snapshot: { phone: string }; message_count: string; attachment_count: string }>;
    expect(rows[0]).toMatchObject({ canonical_phone: '+12408414211', status: 'partial' });
    expect(rows[0].qualification_snapshot.phone).toBe('+12408414211');
    expect(Number(rows[0].message_count)).toBe(1);
    expect(Number(rows[0].attachment_count)).toBe(0);
  });

  it('reinjects interpreted vehicle and document evidence into the normalizer', async () => {
    const service = new ConversationWebhookService(dataSource);
    await service.acceptCustomerReplied({
      event_id: `${suffix}-interpreted-image`,
      ghl_message_id: `${suffix}-interpreted-image-message`,
      ghl_contact_id: imageContactId,
      ghl_conversation_id: imageConversationId,
      channel: 'messenger',
      contact_name: 'Aldair M Denilson',
      contact_phone: '',
      message_body: 'Como este modelo',
      occurred_at: now,
      message_attachments: [{ url: 'https://links.example.test/equinox.jpg', content_type: 'image/jpeg' }],
    }, 'koons-culpeper', { contactId: imageContactId, conversationId: imageConversationId });

    const attachment = await dataSource.query(
      `SELECT id FROM conversation_attachments WHERE ghl_conversation_id = $1`,
      [imageConversationId],
    ) as Array<{ id: string }>;
    expect(attachment).toHaveLength(1);
    await dataSource.query(
      `UPDATE conversation_attachments
       SET processing_status = 'done', extracted_text = $2, processing_metadata = $3::jsonb,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [
        attachment[0].id,
        "[image interpretation]\nvehicle: Chevrolet Equinox\ndocuments: I have my driver's license; I have proof of income",
        JSON.stringify({ vision_status: 'processed', source: 'local-transformers', model: 'qa-fixture' }),
      ],
    );

    const conversation = await dataSource.query(
      `SELECT id FROM conversations WHERE ghl_conversation_id = $1`,
      [imageConversationId],
    ) as Array<{ id: string }>;
    const result = await service.reconcileMediaConversation(conversation[0].id, new Date(now));

    expect(result.qualificationSnapshot).toMatchObject({
      vehicle_type: 'Chevrolet Equinox',
      identification: 'yes',
    });
    expect(result.qualificationSnapshot?.documents).toContain('proof of income: yes');
    expect(result.qualificationSnapshot?.missing_qualification).not.toContain('proof_of_income');

    const stored = await dataSource.query(
      `SELECT cm.body, cm.raw_payload
       FROM conversation_messages cm
       JOIN conversation_attachments ca ON ca.conversation_message_id = cm.id
       WHERE ca.id = $1`,
      [attachment[0].id],
    ) as Array<{ body: string; raw_payload: Record<string, unknown> }>;
    expect(stored[0].body).toBe('Como este modelo');
    expect(stored[0].raw_payload).toMatchObject({ message_body: 'Como este modelo' });
  });

  it('injects a local audio transcription as a separate inbound conversation message', async () => {
    const service = new ConversationWebhookService(dataSource);
    await service.acceptCustomerReplied({
      event_id: `${suffix}-audio`,
      ghl_message_id: `${suffix}-audio-message`,
      ghl_contact_id: audioContactId,
      ghl_conversation_id: audioConversationId,
      channel: 'messenger',
      contact_name: 'Audio QA Customer',
      contact_phone: '',
      message_body: 'Te mando una nota de voz',
      message_attachments: [{ url: 'https://links.example.test/voice.m4a', content_type: 'audio/mp4', filename: 'voice.m4a' }],
      occurred_at: now,
    }, 'koons-culpeper', { contactId: audioContactId, conversationId: audioConversationId, messageId: `${suffix}-audio-message` });

    const attachment = await dataSource.query(
      `SELECT id, conversation_message_id, ghl_message_id FROM conversation_attachments WHERE ghl_conversation_id = $1`,
      [audioConversationId],
    ) as Array<{ id: string; conversation_message_id: string; ghl_message_id: string }>;
    expect(attachment).toHaveLength(1);
    const transcription = 'I am looking for an SUV and can bring 3000 for the down payment';
    await dataSource.query(
      `UPDATE conversation_attachments
       SET processing_status = 'done', extracted_text = $2, processing_metadata = $3::jsonb,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [attachment[0].id, transcription, JSON.stringify({ engine: 'faster-whisper', model: 'small' })],
    );
    await dataSource.query(
      `INSERT INTO conversation_messages
         (conversation_id, dedupe_key, ghl_message_id, direction, body, occurred_at, raw_payload)
       SELECT ca.conversation_id, 'media:' || ca.id::text, ca.ghl_message_id || ':media:' || ca.id::text,
              'inbound', $2, cm.occurred_at, $3::jsonb
       FROM conversation_attachments ca
       JOIN conversation_messages cm ON cm.id = ca.conversation_message_id
       WHERE ca.id = $1`,
      [attachment[0].id, transcription, JSON.stringify({ source: 'audio_transcription', attachment_id: attachment[0].id })],
    );

    const conversation = await dataSource.query(
      `SELECT id FROM conversations WHERE ghl_conversation_id = $1`,
      [audioConversationId],
    ) as Array<{ id: string }>;
    const result = await service.reconcileMediaConversation(conversation[0].id, new Date(now));
    expect(result.qualificationSnapshot).toMatchObject({ vehicle_type: 'SUV' });

    const stored = await dataSource.query(
      `SELECT body, raw_payload->>'source' AS source
       FROM conversation_messages
       WHERE conversation_id = $1 AND dedupe_key LIKE 'media:%'`,
      [conversation[0].id],
    ) as Array<{ body: string; source: string }>;
    expect(stored).toEqual([{ body: transcription, source: 'audio_transcription' }]);
  });
});
