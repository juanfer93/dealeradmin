import type { LeadWebhookDto } from '@dealeradmin/contracts';
import { normalizeCollectorInput, normalizeRealName } from '../../leads/domain/collector-normalizer';

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : {};

const firstValue = (records: UnknownRecord[], keys: string[]): unknown => {
  for (const record of records) {
    for (const key of keys) {
      const value = record[key];
      if (value !== undefined && value !== null && String(value).trim() !== '') return value;
    }
  }
  return undefined;
};

const text = (value: unknown): string | null => {
  if (value === undefined || value === null) return null;
  const result = String(value).trim();
  return result || null;
};

const CONVERSATION_PHONE_ALIASES = [
  'message',
  'message_body',
  'messageBody',
  'last_message',
  'lastMessage',
  'body',
  'chat_history_log',
  'chatHistoryLog',
  'conversation_history',
  'conversationHistory',
  'conversation_text',
  'conversationText',
];

const PHONE_TOKEN = /(?:\+?1[\s().-]*)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}|\b\d{10}\b/;

function phoneFromValue(value: unknown): string | null {
  const candidate = text(value);
  if (!candidate) return null;
  const match = candidate.match(PHONE_TOKEN);
  return match?.[0] || (!/[a-z]/i.test(candidate) && /^\+?[\d\s().-]{10,20}$/.test(candidate) ? candidate : null);
}

function findConversationPhone(records: UnknownRecord[]): string | null {
  for (const record of records) {
    for (const [key, value] of Object.entries(record)) {
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
      const isConversationAlias = CONVERSATION_PHONE_ALIASES.some((alias) => {
        const normalizedAlias = alias.toLowerCase().replace(/[^a-z0-9]/g, '');
        return normalizedKey === normalizedAlias || normalizedKey.endsWith(normalizedAlias);
      });
      if (isConversationAlias) {
        const phone = phoneFromValue(value);
        if (phone) return phone;
      }
    }
  }
  return null;
}

/**
 * Native HighLevel webhooks flatten the contact object in different ways
 * depending on the action version. The collector writes the number extracted
 * from the user's message to contact.phone, so this is the safe fallback when
 * HighLevel omits the conversation transcript from the outbound webhook.
 *
 * Deliberately read only the contact phone/root phone here. Do not inspect
 * customData or arbitrary fields: those can contain stale or contaminated
 * values (for example digits from a vehicle or a down payment).
 */
function findContactPhone(payload: UnknownRecord, contact: UnknownRecord, customData: UnknownRecord): string | null {
  // The published main workflows map customData.phone directly from
  // {{contact.phone}}. Accept that exact key only as a compatibility fallback;
  // arbitrary qualifier fields remain ineligible as phone sources.
  for (const value of [contact.phone, payload.phone, customData.phone]) {
    const phone = phoneFromValue(value);
    if (phone) return phone;
  }
  return null;
}

const conversationText = (value: unknown): string | null => {
  const conversation = asRecord(value);
  const messages = Array.isArray(conversation.messages)
    ? conversation.messages
    : Array.isArray(conversation.history)
      ? conversation.history
      : [];

  const result = messages
    .map((message) => {
      if (typeof message === 'string') return message;
      const record = asRecord(message);
      return text(firstValue([record], ['body', 'message', 'text', 'content']) || '');
    })
    .filter((message): message is string => Boolean(message))
    .join('\n');

  return result || null;
};

function findField(records: UnknownRecord[], aliases: string[]): string | null {
  const normalizedAliases = aliases.map((alias) => alias.toLowerCase().replace(/[^a-z0-9]/g, ''));
  for (const record of records) {
    for (const [key, value] of Object.entries(record)) {
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (normalizedAliases.some((alias) => normalizedKey === alias || normalizedKey.endsWith(alias))) {
        const result = text(value);
        if (result) return result;
      }
    }
  }
  return null;
}

/**
 * HighLevel's native outbound Webhook action sends contact data at the root
 * and custom key/value data under customData. The API contract is deliberately
 * normalized here so the domain service can keep receiving its stable shape.
 */
export function normalizeGhlOutboundPayload(input: unknown): LeadWebhookDto | unknown {
  const payload = asRecord(input);
  if (payload.lead && payload.event_id) {
    const lead = asRecord(payload.lead);
    const normalizedLead = normalizeCollectorInput({
      real_name: text(lead.real_name),
      qualification_memory: text(lead.qualification_memory),
      message: text(lead.message),
      chat_history_log: text(lead.chat_history_log),
    });
    const phone = findConversationPhone([
      lead,
      { conversation_text: conversationText(lead.conversation) },
    ]) || '';
    const normalizedName = normalizedLead.real_name || normalizeRealName(text(lead.name)) || 'Lead';
    const currentRealName = text(lead.real_name);
    if (phone === text(lead.phone) && normalizedName === text(lead.name) && (currentRealName === normalizedLead.real_name || !normalizedLead.real_name)) return input;
    return { ...payload, lead: { ...lead, name: normalizedName, real_name: normalizedLead.real_name || text(lead.real_name) || null, phone } };
  }

  const customData = asRecord(payload.customData ?? payload.custom_data);
  const contact = asRecord(payload.contact);
  const contactCustomFields = asRecord(contact.customFields ?? contact.custom_fields);
  const payloadCustomFields = asRecord(payload.customFields ?? payload.custom_fields);
  const location = asRecord(payload.location);
  const nestedConversationText = conversationText(payload.conversation);
  const records = [customData, contactCustomFields, payloadCustomFields, contact, payload];

  const contactId = text(firstValue(records, ['ghl_contact_id', 'contactId', 'contact_id', 'id']));
  const locationId = text(firstValue(records, ['ghl_location_id', 'locationId', 'location_id'])) || text(location.id);
  const displayName = text(firstValue(records, ['name', 'full_name', 'fullName'])) ||
    [text(firstValue(records, ['first_name', 'firstName'])), text(firstValue(records, ['last_name', 'lastName']))]
      .filter(Boolean)
      .join(' ');
  // A number written in the conversation wins. If HighLevel omits the
  // transcript, the collector-written contact.phone is the only fallback;
  // custom fields are never treated as a phone source.
  const conversationPhone = findConversationPhone([
    ...records,
    { conversation_text: nestedConversationText },
  ]);
  // Prefer a number explicitly present in the conversation. When the native
  // action sends no transcript, contact.phone is the value written by the
  // collector from that same user message.
  const phone = conversationPhone || findContactPhone(payload, contact, customData);
  const dealerName = text(firstValue(records, ['dealer_name', 'dealerName'])) || text(location.name) || 'GHL dealer';

  const lead = {
    name: normalizeRealName(displayName) || displayName || 'Lead',
    real_name: findField(records, ['real_name', 'realName', 'customer_name', 'contact_name', 'nombre_real', 'nombre_completo']),
    phone: phone || '',
    vehicle_type: findField(records, ['vehicle_type', 'vehicle_interest', 'vehicle', 'car', 'truck', 'suv']),
    down_payment: findField(records, ['down_payment', 'downpayment', 'down'] ),
    identification: findField(records, ['identification', 'id_number', 'license', 'drivers_license']),
    bank_account: findField(records, ['bank_account', 'bankaccount', 'bank', 'account_last4']),
    purchase_timeline: findField(records, ['purchase_timeline', 'timeline', 'buying_timeline']),
    documents: findField(records, ['documents', 'documents_available', 'proof_of_income']),
    message: nestedConversationText || text(firstValue(records, ['message', 'message_body', 'messageBody', 'last_message', 'lastMessage', 'body'])),
    qualification_memory: findField(records, ['qualification_memory', 'qualificationMemory']),
    chat_history_log: findField(records, ['chat_history_log', 'chatHistoryLog', 'conversation_history', 'conversationHistory']),
    easterns_zone: findField(records, ['easterns_zone', 'location_zone', 'zone']),
    easterns_dealer_selected: findField(records, ['easterns_dealer_selected', 'dealer_selected', 'explicit_dealer']) === 'true' ? true : undefined,
    city: text(firstValue(records, ['city'])),
    state: text(firstValue(records, ['state'])),
    zip_code: text(firstValue(records, ['zip_code', 'postal_code', 'postalCode'])),
  };

  const normalized = normalizeCollectorInput(lead);
  const realName = normalized.real_name || normalizeRealName(lead.name) || 'Lead';

  return {
    event_id: text(firstValue(records, ['event_id', 'eventId', 'webhook_id', 'webhookId'])) ||
      `ghl:${locationId || 'unknown'}:${contactId || 'unknown'}:${text(firstValue(records, ['date_updated', 'dateUpdated', 'date_created', 'dateAdded'])) || 'current'}`,
    event_type: text(firstValue(records, ['event_type', 'eventType', 'type'])) || 'lead.ready_for_whatsapp',
    occurred_at: text(firstValue(records, ['occurred_at', 'occurredAt', 'date_updated', 'dateUpdated', 'date_created', 'dateAdded'])) || new Date().toISOString(),
    dealer_id: text(firstValue(records, ['dealer_id', 'dealerId'])) || locationId || 'ghl-location',
    dealer_name: dealerName,
    ghl_location_id: locationId || 'unknown-location',
    ghl_contact_id: contactId || 'unknown-contact',
    lead: {
      ...lead,
      name: realName,
      real_name: normalized.real_name || null,
      vehicle_type: normalized.vehicle_type || lead.vehicle_type,
      down_payment: normalized.down_payment,
      purchase_timeline: normalized.purchase_timeline || lead.purchase_timeline,
      documents: normalized.documents || lead.documents,
      identification: normalized.identification || lead.identification,
      bank_account: normalized.bank_account || lead.bank_account,
      qualification_memory: normalized.qualification_memory || lead.qualification_memory,
      qualification_source: normalized.qualification_source,
      qualification_complete: normalized.qualification_complete,
      missing_qualification: normalized.missing_qualification,
    },
  };
}
