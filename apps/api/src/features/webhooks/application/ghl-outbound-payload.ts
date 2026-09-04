import type { LeadWebhookDto } from '@dealeradmin/contracts';
import { normalizeCollectorInput } from '../../leads/domain/collector-normalizer';

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
  if (payload.lead && payload.event_id) return input;

  const customData = asRecord(payload.customData ?? payload.custom_data);
  const contact = asRecord(payload.contact);
  const contactCustomFields = asRecord(contact.customFields ?? contact.custom_fields);
  const payloadCustomFields = asRecord(payload.customFields ?? payload.custom_fields);
  const location = asRecord(payload.location);
  const records = [customData, contactCustomFields, payloadCustomFields, contact, payload];

  const contactId = text(firstValue(records, ['ghl_contact_id', 'contactId', 'contact_id', 'id']));
  const locationId = text(firstValue(records, ['ghl_location_id', 'locationId', 'location_id'])) || text(location.id);
  const name = text(firstValue(records, ['name', 'full_name', 'fullName'])) ||
    [text(firstValue(records, ['first_name', 'firstName'])), text(firstValue(records, ['last_name', 'lastName']))]
      .filter(Boolean)
      .join(' ');
  const phone = text(firstValue(records, ['phone', 'mobile', 'mobile_phone']));
  const dealerName = text(firstValue(records, ['dealer_name', 'dealerName'])) || text(location.name) || 'GHL dealer';

  const lead = {
    name: name || 'Lead',
    phone: phone || '',
    vehicle_type: findField(records, ['vehicle_type', 'vehicle_interest', 'vehicle', 'car', 'truck', 'suv']),
    down_payment: findField(records, ['down_payment', 'downpayment', 'down'] ),
    identification: findField(records, ['identification', 'id_number', 'license', 'drivers_license']),
    bank_account: findField(records, ['bank_account', 'bankaccount', 'bank', 'account_last4']),
    purchase_timeline: findField(records, ['purchase_timeline', 'timeline', 'buying_timeline']),
    documents: findField(records, ['documents', 'documents_available', 'proof_of_income']),
    message: text(firstValue(records, ['message', 'message_body', 'messageBody', 'last_message', 'lastMessage', 'body'])),
    qualification_memory: findField(records, ['qualification_memory', 'qualificationMemory']),
    chat_history_log: findField(records, ['chat_history_log', 'chatHistoryLog', 'conversation_history', 'conversationHistory']),
    easterns_zone: findField(records, ['easterns_zone', 'location_zone', 'zone']),
    easterns_dealer_selected: findField(records, ['easterns_dealer_selected', 'dealer_selected', 'explicit_dealer']) === 'true' ? true : undefined,
    city: text(firstValue(records, ['city'])),
    state: text(firstValue(records, ['state'])),
    zip_code: text(firstValue(records, ['zip_code', 'postal_code', 'postalCode'])),
  };

  const normalized = normalizeCollectorInput(lead);

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
      vehicle_type: normalized.vehicle_type || lead.vehicle_type,
      down_payment: normalized.down_payment,
      purchase_timeline: normalized.purchase_timeline || lead.purchase_timeline,
      documents: normalized.documents || lead.documents,
      identification: normalized.identification || lead.identification,
      bank_account: normalized.bank_account || lead.bank_account,
      qualification_memory: normalized.qualification_memory || lead.qualification_memory,
    },
  };
}
