import type { DealeradminCaptureContract } from '@dealeradmin/contracts';
import { DEALERADMIN_CAPTURE_SCHEMA_VERSION } from '@dealeradmin/contracts';
import type { CollectorInput, CollectorOutput } from './collector-normalizer';

type CaptureInput = CollectorInput & {
  channel?: string | null;
  contact_id?: string | null;
  occurred_at?: string | null;
  city?: string | null;
  state?: string | null;
  zip_code?: string | null;
  easterns_zone?: string | null;
};

const clean = (value: string | null | undefined): string => value?.replace(/\s+/g, ' ').trim() ?? '';
const nullable = (value: string | null | undefined): string | null => clean(value) || null;

function evidenceSource(input: CaptureInput, value: string, fieldInput?: string | null) {
  if (!value) return { source: 'backend' as const, evidence: null };
  if (clean(fieldInput)) return { source: 'custom_field' as const, evidence: clean(fieldInput) };
  if (clean(input.message) && clean(input.message).toLowerCase().includes(value.toLowerCase())) {
    return { source: 'message' as const, evidence: clean(input.message) };
  }
  if (clean(input.chat_history_log)) return { source: 'transcript' as const, evidence: clean(input.chat_history_log) };
  if (clean(input.qualification_memory)) return { source: 'qualification_memory' as const, evidence: clean(input.qualification_memory) };
  return { source: 'backend' as const, evidence: null };
}

function field(
  input: CaptureInput,
  value: string | null | undefined,
  fieldInput?: string | null,
  confidence = 0.85,
) {
  const normalized = nullable(value);
  const source = evidenceSource(input, normalized ?? '', fieldInput);
  return { value: normalized, ...source, confidence: normalized ? confidence : 0 };
}

function appendOnlyTranscript(input: CaptureInput): string {
  const history = clean(input.chat_history_log);
  const message = clean(input.message);
  if (!history) return message;
  if (!message || history.toLowerCase().includes(message.toLowerCase())) return history;
  return `${history}\n${message}`;
}

function phoneEvidence(input: CaptureInput, phone: string | null) {
  if (!phone) return { source: 'contact.phone' as const, evidence: null };
  const transcript = `${clean(input.message)} ${clean(input.chat_history_log)}`;
  const digits = phone.replace(/\D/g, '');
  const match = transcript.match(new RegExp(`(?:\\+?1[\\s().-]*)?${digits.slice(-10, -7)}[\\s().-]*${digits.slice(-7, -4)}[\\s.-]*${digits.slice(-4)}`));
  return match
    ? { source: 'message' as const, evidence: match[0] }
    : { source: 'contact.phone' as const, evidence: null };
}

export function buildDealeradminCaptureContract(
  input: CaptureInput,
  normalized: CollectorOutput,
  phone?: string | null,
): DealeradminCaptureContract {
  const transcript = appendOnlyTranscript(input);
  const missing = [...normalized.missing_qualification];
  if (!nullable(phone)) missing.unshift('phone');
  const phoneValue = nullable(phone);
  const phoneSource = phoneEvidence(input, phoneValue);

  return {
    raw_evidence: {
      schema_version: DEALERADMIN_CAPTURE_SCHEMA_VERSION,
      channel: clean(input.channel) || 'ghl_messenger',
      transcript,
      contact_id: nullable(input.contact_id),
      occurred_at: nullable(input.occurred_at),
      append_only: true,
    },
    extraction: {
      schema_version: DEALERADMIN_CAPTURE_SCHEMA_VERSION,
      fields: {
        phone: {
          value: phoneValue,
          ...phoneSource,
          confidence: phoneValue ? 0.95 : 0,
        },
        real_name: field(input, normalized.real_name, input.real_name),
        vehicle_type: field(input, normalized.vehicle_type, input.vehicle_type),
        down_payment: field(input, normalized.down_payment, input.down_payment),
        purchase_timeline: field(input, normalized.purchase_timeline, input.purchase_timeline),
        identification: field(input, normalized.identification, input.identification),
        proof_of_income: field(input, normalized.has_income_proof === 'yes' ? 'yes' : '', input.documents),
        bank_account: field(input, normalized.bank_account, input.bank_account),
        city: field(input, input.city, input.city),
        state: field(input, input.state, input.state),
        zip_code: field(input, input.zip_code, input.zip_code),
        easterns_zone: field(input, input.easterns_zone, input.easterns_zone),
      },
      completeness: {
        status: !nullable(phone) ? 'blocked' : missing.length === 0 ? 'complete' : 'partial',
        missing,
      },
    },
  };
}
