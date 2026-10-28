import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { normalizePhone } from '../../../../leads/domain/phone-normalizer';
import type { ConversationMessageRow, SourceKey, SourceConfigMap } from './conversation-webhook.types';

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function clean(value: unknown): string {
  return value === undefined || value === null ? '' : String(value).replace(/\s+/g, ' ').trim();
}

export function normalizedChannel(value: unknown): string {
  const channel = clean(value).toLowerCase();
  if (channel === 'wa' || channel === 'whatsapp' || channel.includes('whatsapp')) return 'whatsapp';
  if (channel === 'fb' || channel === 'facebook' || channel.includes('messenger')) return 'messenger';
  return channel;
}

export function nativeAttributionChannel(input: unknown): string {
  const value = asRecord(input);
  const contact = asRecord(value.contact);
  const sources = [contact.attributionSource, contact.lastAttributionSource, value.attributionSource, value.lastAttributionSource].map(asRecord);
  for (const source of sources) {
    for (const candidate of [source.medium, source.channel, source.type, source.source]) {
      const channel = normalizedChannel(candidate);
      if (channel === 'whatsapp' || channel === 'messenger') return channel;
    }
  }
  return '';
}

export function inputIndicatesWhatsApp(input: unknown, normalizedEventChannel: string): boolean {
  const value = asRecord(input);
  const customData = asRecord(value.customData ?? value.custom_data);
  const nativeMessage = asRecord(value.message);
  const explicitChannels = [value.channel, customData.channel, nativeMessage.channel]
    .map(normalizedChannel)
    .filter(Boolean);
  // GHL contact attribution can retain an old WhatsApp medium after the
  // contact replies through Messenger. An explicit channel carried by the
  // current webhook is stronger evidence and must win over that stale field.
  if (explicitChannels.includes('messenger')) return false;
  if (explicitChannels.includes('whatsapp')) return true;
  return [
    normalizedEventChannel,
    nativeAttributionChannel(input),
    nativeMessage.type,
  ].some((candidate) => normalizedChannel(candidate) === 'whatsapp');
}

export function isAttachmentEvidenceMessage(message: ConversationMessageRow): boolean {
  const payload = asRecord(message.raw_payload);
  return payload.source === 'image_interpretation' || payload.source === 'image_ocr_attachment_fallback';
}

export function addProcessedImageEvidence(messages: ConversationMessageRow[]): ConversationMessageRow[] {
  return messages.flatMap((message) => message.attachment_extracted_text
    ? [message, {
      body: message.attachment_extracted_text,
      direction: 'inbound',
      occurred_at: message.occurred_at,
      raw_payload: { source: 'image_ocr_attachment_fallback' },
    }]
    : [message]);
}

export function hasAttachmentValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.some(hasAttachmentValue);
  return true;
}

export function sourceKey(value: string, sourceConfig: SourceConfigMap): SourceKey {
  const source = value.trim().toLowerCase() as SourceKey;
  if (!(source in sourceConfig)) throw new BadRequestException(`Fuente GHL no configurada: ${value}`);
  return source;
}

export function isStaffordWhatsApp(source: SourceKey, channel: string): boolean {
  return source === 'stafford' && channel.trim().toLowerCase() === 'whatsapp';
}

export function parseOccurredAt(value: string | undefined): string {
  if (!value) return new Date().toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

export function splitName(value: string): { firstName: string; lastName: string } {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] || 'Lead', lastName: parts.slice(1).join(' ') };
}

export function withinDispatchWindow(timezone: string, now: Date): boolean {
  try {
    const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: '2-digit', hour12: false }).format(now));
    return hour >= 3 && hour < 15;
  } catch {
    return false;
  }
}

export function plusHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

export function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function currentLocalNow(): Date {
  const fixed = process.env.DEALERADMIN_FIXED_NOW;
  if (fixed && process.env.NODE_ENV !== 'production') {
    const parsed = new Date(fixed);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

export function safePhone(value: string | null | undefined): string | null {
  const candidate = clean(value);
  if (!candidate) return null;
  try { return normalizePhone(candidate); } catch { return null; }
}

export function extractNativeWhatsappPhone(messages: ConversationMessageRow[]): string | null {
  for (const message of [...messages].reverse()) {
    if (!message.raw_payload || typeof message.raw_payload !== 'object' || Array.isArray(message.raw_payload)) continue;
    const value = (message.raw_payload as Record<string, unknown>).contact_phone;
    const phone = safePhone(typeof value === 'string' ? value : null);
    if (phone) return phone;
  }
  return null;
}

export function normalizeWebhookInput(input: unknown, defaultChannel: string, headers: { contactId?: string; conversationId?: string; messageId?: string }): Record<string, unknown> {
  const value = asRecord(input);
  const nestedContact = asRecord(value.contact);
  const nestedProfile = asRecord(value.profile);
  const nestedWhatsapp = asRecord(value.whatsapp);
  const nestedWhatsappProfile = asRecord(nestedWhatsapp.profile);
  const nestedLocation = asRecord(value.location);
  const customData = asRecord(value.customData);
  const nestedMessage = asRecord(value.message);
  const triggerData = asRecord(value.triggerData);
  const triggerMessage = asRecord(triggerData.message);
  const nativeMessage = Object.keys(nestedMessage).length > 0 ? nestedMessage : triggerMessage;
  const attachmentValue = [
    value.message_attachments,
    value.messageAttachments,
    value.attachments,
    customData.message_attachments,
    customData.messageAttachments,
    customData.attachments,
    nativeMessage.message_attachments,
    nativeMessage.messageAttachments,
    nativeMessage.attachments,
    nativeMessage.media,
    nativeMessage.attachment,
    triggerData.message_attachments,
    triggerData.messageAttachments,
    triggerData.attachments,
  ].find(hasAttachmentValue);
  return {
    ...value,
    event_id: value.event_id ?? value.eventId,
    event_type: value.event_type ?? value.eventType ?? 'customer.replied',
    ghl_location_id: value.ghl_location_id
      ?? value.location_id
      ?? value.locationId
      ?? nestedLocation.id
      ?? customData.ghl_location_id
      ?? customData.location_id
      ?? customData.locationId,
    ghl_message_id: value.ghl_message_id ?? value.messageId ?? headers.messageId,
    ghl_contact_id: value.ghl_contact_id ?? value.contact_id ?? value.contactId ?? headers.contactId ?? nestedContact.id ?? value.id,
    ghl_conversation_id: value.ghl_conversation_id ?? value.conversation_id ?? value.conversationId ?? headers.conversationId,
    message_body: value.message_body
      ?? value.messageBody
      ?? customData.message_body
      ?? customData.messageBody
      ?? (typeof value.message === 'string' ? value.message : undefined)
      ?? nativeMessage.body
      ?? nativeMessage.text
      ?? value.body,
    contact_phone: value.contact_phone ?? customData.contact_phone ?? nestedContact.phone ?? value.phone,
    contact_name: value.contact_name
      ?? customData.contact_name
      ?? nestedContact.name
      ?? nestedProfile.name
      ?? nestedWhatsappProfile.name
      ?? value.name
      ?? value.full_name,
    // Prefer the channel attached to this message. Attribution is contact
    // metadata and may describe an older WhatsApp interaction even when the
    // current message arrived through Messenger.
    channel: normalizedChannel(value.channel)
      || normalizedChannel(customData.channel)
      || normalizedChannel(nativeMessage.channel)
      || nativeAttributionChannel(input)
      || defaultChannel,
    occurred_at: value.occurred_at ?? value.occurredAt ?? value.date_updated ?? value.dateUpdated,
    message_attachments: attachmentValue,
    raw_payload: value.raw_payload ?? value,
    location: nestedLocation,
  };
}
