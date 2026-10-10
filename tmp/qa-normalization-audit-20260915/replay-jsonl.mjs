import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

const apiUrl = 'http://127.0.0.1:3015/api/webhooks/ghl/customer-replied';
const secret = 'local-normalization-audit-secret';
const auditDir = new URL('./', import.meta.url);
const samples = readFileSync(new URL('./conversations.jsonl', auditDir), 'utf8')
  .trim().split(/\r?\n/).map((line) => JSON.parse(line));
const edge = JSON.parse(readFileSync(new URL('./phone-only-advisor-edge.jsonl', auditDir), 'utf8').trim());
samples.push(edge);

const sourceFor = (sample) => {
  const location = sample.conversation.ghl_location_id;
  if (location === 'LiaoSID3nvAhad49ZpNJ') return 'stafford';
  if (location === 'xuHo0opTO2g5edIuPJRl') return 'koons-fred';
  if (location === 'MyxWNKacThim798E8KC6') return 'fredericksburg';
  return 'easterns';
};

const results = [];
for (const [index, sample] of samples.entries()) {
  const source = sourceFor(sample);
  const original = sample.messages[0];
  const tag = `qa-normalization-audit-20260915-v4-${index + 1}`;
  const body = {
    event_id: `${tag}-event`,
    event_type: 'customer.replied',
    ghl_message_id: `${tag}-message`,
    ghl_contact_id: `${tag}-contact`,
    ghl_conversation_id: `${tag}-conversation:${sample.conversation.channel}`,
    message_body: original.body,
    contact_phone: original.raw_payload?.contact_phone || sample.lead.canonical_phone || '',
    contact_name: original.raw_payload?.contact_name || [sample.lead.first_name, sample.lead.last_name].filter(Boolean).join(' '),
    channel: sample.conversation.channel,
    occurred_at: original.occurred_at,
    raw_payload: original.raw_payload,
  };
  const raw = JSON.stringify(body);
  const response = await fetch(`${apiUrl}/${source}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-ghl-signature': `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`,
      'x-dealeradmin-test-now': '2026-09-15T15:00:00.000Z',
    },
    body: raw,
  });
  results.push({ index: index + 1, source, status: response.status, body: await response.json() });
}

console.log(JSON.stringify(results, null, 2));
