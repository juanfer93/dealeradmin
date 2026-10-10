import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const source = JSON.parse(await readFile('C:/Users/Dell/.codex/attachments/e7f43b6f-2ec3-49fb-b40e-4b36c5d6c075/pasted-text.txt', 'utf8'));
const conversation = JSON.parse(source[0].conversation_json)[0];
const bodies = conversation.messages.map((message) => message.body);
const history = bodies.join('\n');
const latest = bodies.at(-1) ?? '';
const customCode = await readFile(new URL('../../apps/api/src/features/leads/domain/ghl-collector-normalizer.js', import.meta.url), 'utf8');
const execute = (inputData) => new Function('inputData', customCode)(inputData);
const baseInput = {
  channel: conversation.conversation.channel,
  contact_name: conversation.messages[0]?.raw_payload?.contact_name,
  phone: conversation.lead.canonical_phone,
  message: latest,
  chat_history_log: history,
  vehicle_type: conversation.conversation.qualification_snapshot.vehicle_type,
};
const currentRaw = execute(baseInput);
const currentWithStaleDown = execute({ ...baseInput, down_payment: conversation.conversation.qualification_snapshot.down_payment });
const evidence = {
  run_id: 'qa-marie-flanagan-20260913',
  source: 'user-pasted JSON used only as synthetic local fixture',
  lead: { id: conversation.lead.id, first_name: conversation.lead.first_name, last_name: conversation.lead.last_name, canonical_phone: conversation.lead.canonical_phone },
  conversation: { id: conversation.conversation.id, ghl_conversation_id: conversation.conversation.ghl_conversation_id, channel: conversation.conversation.channel },
  messages: conversation.messages.map(({ id, body, direction, occurred_at, ghl_message_id }) => ({ id, body, direction, occurred_at, ghl_message_id })),
  current_normalizer_without_stale_down: currentRaw,
  current_normalizer_with_stale_down: currentWithStaleDown,
};
evidence.assertions = {
  phone_normalized: currentRaw.phone === '+14438626592',
  vehicle_preserved: currentRaw.vehicle_type === 'SUV',
  no_down_from_phone_only: currentRaw.down_payment === '',
  stale_443_is_not_accepted_as_evidence: currentWithStaleDown.down_payment === '',
};
evidence.result = Object.values(evidence.assertions).every(Boolean) ? 'PASS' : 'FAIL';
const output = new URL('./evidence-before-fix.json', import.meta.url);
await mkdir(new URL('.', output), { recursive: true });
await writeFile(output, JSON.stringify(evidence, null, 2), 'utf8');
console.log(JSON.stringify({ result: evidence.result, currentRaw: { phone: currentRaw.phone, down_payment: currentRaw.down_payment, vehicle_type: currentRaw.vehicle_type }, currentWithStaleDown: { phone: currentWithStaleDown.phone, down_payment: currentWithStaleDown.down_payment } }, null, 2));
if (evidence.result !== 'PASS') process.exitCode = 1;
