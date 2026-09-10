import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { ConversationWebhookService } from '../../application/conversation-webhook.service';
import { getTestConversationEvents, resetTestConversationEvents } from '../../application/test-conversation-store';

describe('ConversationWebhookService', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    resetTestConversationEvents();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('captures one inbound message using the native contact id header', async () => {
    const service = new ConversationWebhookService();
    const result = await service.acceptCustomerReplied(
      {
        message_body: 'I am looking for an SUV.',
        contact_phone: '+13015550123',
        contact_name: 'Ana Torres',
        channel: 'whatsapp',
      },
      'stafford',
      { contactId: 'ghl-contact-1', conversationId: 'ghl-conversation-1', messageId: 'ghl-message-1' },
      '{"message_body":"I am looking for an SUV."}',
    );

    expect(result).toMatchObject({ accepted: true, source: 'stafford', conversationId: 'ghl-conversation-1', status: 'processed' });
    expect(getTestConversationEvents()).toEqual([
      expect.objectContaining({ contactId: 'ghl-contact-1', conversationId: 'ghl-conversation-1', message: 'I am looking for an SUV.', channel: 'whatsapp' }),
    ]);
  });

  it('rejects a message when the native contact id is absent', async () => {
    const service = new ConversationWebhookService();
    await expect(service.acceptCustomerReplied({ message_body: 'SUV' }, 'stafford', {})).rejects.toThrow('Contact ID');
  });

  it('keeps the source mapping for Easterns independent of free-form dealer text', async () => {
    const service = new ConversationWebhookService();
    const result = await service.acceptCustomerReplied(
      { message_body: 'I live in Baltimore and need an SUV.', channel: 'messenger' },
      'easterns',
      { contactId: 'ghl-easterns-contact', conversationId: 'ghl-easterns-conversation' },
    );

    expect(result.source).toBe('easterns');
    expect(result.conversationId).toBe('ghl-easterns-conversation');
  });
});
