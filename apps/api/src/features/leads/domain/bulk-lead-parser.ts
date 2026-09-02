import type { CreateManualLeadDto } from '@dealeradmin/contracts';
import { normalizeCollectorInput } from './collector-normalizer';
import { normalizePhone } from './phone-normalizer';

export type ParsedBulkLead = {
  rowNumber: number;
  rawLine: string;
  name: string;
  phone: string;
  dto?: CreateManualLeadDto;
  error?: string;
};

const PHONE = /(?:\+?\d[\d().\s-]{8,}\d)/;
const WHATSAPP_METADATA = [
  /^\[\s*\d{1,2}:\d{2}\s*(?:a\.?\s*m\.?|p\.?\s*m\.?|AM|PM)?\s*,\s*\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\s*\]\s*[^:\n]{1,80}:\s*/i,
  /^\s*\d{1,2}:\d{2}\s*(?:a\.?\s*m\.?|p\.?\s*m\.?|AM|PM)?\s*,\s*\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\s*[-–]\s*[^:\n]{1,80}:\s*/i,
];
const LABELS: Record<string, keyof CreateManualLeadDto> = {
  name: 'name',
  nombre: 'name',
  phone: 'phone',
  telefono: 'phone',
  teléfono: 'phone',
  vehicle: 'vehicle_type',
  vehiculo: 'vehicle_type',
  vehículo: 'vehicle_type',
  'vehicle type': 'vehicle_type',
  down: 'down_payment',
  'down payment': 'down_payment',
  enganche: 'down_payment',
  documentos: 'documents',
  documents: 'documents',
  timeline: 'purchase_timeline',
  'purchase timeline': 'purchase_timeline',
  'tiempo de compra': 'purchase_timeline',
  identificacion: 'identification',
  identificación: 'identification',
  id: 'identification',
  'bank account': 'bank_account',
  'cuenta bancaria': 'bank_account',
};

function clean(value: string | undefined): string {
  return value?.replace(/\s+/g, ' ').trim() ?? '';
}

function stripWhatsAppMetadata(value: string): string {
  return clean(WHATSAPP_METADATA.reduce((current, pattern) => current.replace(pattern, ''), value));
}

function parseLabeled(line: string): Partial<Record<keyof CreateManualLeadDto, string>> {
  const values: Partial<Record<keyof CreateManualLeadDto, string>> = {};
  const pattern = Object.keys(LABELS).map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const matcher = new RegExp(`(?:^|[|;,])\\s*(${pattern})\\s*:\\s*([^|;,]+)`, 'gi');
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(line))) values[LABELS[match[1].toLowerCase()]] = clean(match[2]);
  return values;
}

function parseNaturalIdentity(line: string, phoneMatch: RegExpMatchArray | null): Partial<Record<keyof CreateManualLeadDto, string>> {
  if (!phoneMatch || phoneMatch.index === undefined || /[|\t;]/.test(line)) return {};
  const values: Partial<Record<keyof CreateManualLeadDto, string>> = {};
  const name = clean(line.slice(0, phoneMatch.index)).replace(/^(?:name|nombre)\s*[:,-]?\s*/i, '');
  const afterPhone = clean(line.slice(phoneMatch.index + phoneMatch[0].length)).replace(/^[,;:\s-]+/, '');
  const firstClause = clean(afterPhone.split(/[,.!?]/, 1)[0]);
  const isFactClause = /^(?:down|enganche|inicial|deposit|dep[oó]sito|id|identification|identificación|license|licencia|bank account|cuenta bancaria|cuenta|documents?|documentos?|proof of income|income proof|prueba de ingresos|comprobante de ingresos|wants? to buy|quiere comprar|looking for|busco|quiero|want)\b/i.test(firstClause);

  if (name) values.name = name;
  if (firstClause && !isFactClause) values.vehicle_type = firstClause;
  return values;
}

function parseLine(line: string, rowNumber: number): ParsedBulkLead {
  const rawLine = stripWhatsAppMetadata(line);
  const labeled = parseLabeled(rawLine);
  const columns = rawLine.split(/\s*[|\t;]\s*/).map(clean).filter(Boolean);
  const phoneMatch = rawLine.match(PHONE);
  const natural = parseNaturalIdentity(rawLine, phoneMatch);
  const phoneText = labeled.phone ?? phoneMatch?.[0] ?? (columns[1] && /\d/.test(columns[1]) ? columns[1] : '') ?? '';
  const name = labeled.name ?? natural.name ?? (phoneMatch ? clean(rawLine.slice(0, phoneMatch.index)) : columns[0] ?? '');
  const positional = columns.length >= 3 ? {
    vehicle_type: columns[2],
    down_payment: columns[3],
    documents: columns[4],
    purchase_timeline: columns[5],
    identification: columns[6],
    bank_account: columns[7],
  } : {};
  const values = { ...positional, ...natural, ...labeled };
  if (!values.name) values.name = name.replace(/^(?:name|nombre)\s*[:,-]?\s*/i, '').replace(/[|,:-]+$/, '').trim();
  else values.name = values.name.replace(/[|,:-]+$/, '').trim();
  if (!values.down_payment) {
    const withoutPhone = rawLine.replace(phoneText, ' ');
    const amount = withoutPhone.match(/(?:^|[\s,])\$?(?:\d{1,2}(?:,\d{3})+|\d{3,5})(?:\.\d+)?\s*(?:k)?\b/i)?.[0];
    if (amount) values.down_payment = amount.trim();
  }
  const context = rawLine.replace(phoneText, ' ').replace(values.name ?? '', ' ');
  if (!values.identification && /\b(?:id|identification|identificación|license|licencia)\b/i.test(context)) values.identification = 'yes';
  if (!values.bank_account && /\b(?:bank account|cuenta bancaria|cuenta)\b/i.test(context)) values.bank_account = 'yes';
  if (!values.documents && /\b(?:proof of income|income proof|prueba de ingresos|comprobante de ingresos|documentos?)\b/i.test(context)) values.documents = context.match(/(?:proof of income|income proof|prueba de ingresos|comprobante de ingresos|documentos?)[^,.;]*/i)?.[0] ?? 'yes';

  if (!values.name) return { rowNumber, rawLine, name: '', phone: phoneText, error: 'Falta el nombre.' };
  if (!phoneText) return { rowNumber, rawLine, name: values.name, phone: '', error: 'Falta el teléfono.' };

  let phone: string;
  try {
    phone = normalizePhone(phoneText);
  } catch {
    return { rowNumber, rawLine, name: values.name, phone: phoneText, error: 'El teléfono no tiene un formato válido.' };
  }

  const normalized = normalizeCollectorInput({
    message: rawLine,
    vehicle_type: values.vehicle_type,
    down_payment: values.down_payment,
    purchase_timeline: values.purchase_timeline,
    documents: values.documents,
    identification: values.identification,
    bank_account: values.bank_account,
  });
  return {
    rowNumber,
    rawLine,
    name: values.name,
    phone,
    dto: {
      name: values.name,
      phone,
      vehicle_type: normalized.vehicle_type,
      down_payment: normalized.down_payment,
      purchase_timeline: normalized.purchase_timeline,
      documents: normalized.documents,
      identification: normalized.identification,
      bank_account: normalized.bank_account,
    },
  };
}

export function parseBulkLeads(text: string): ParsedBulkLead[] {
  return text.split(/\r?\n/).map((line, index) => ({ line: line.trim(), index }))
    .filter(({ line }) => Boolean(line) && !line.startsWith('#'))
    .map(({ line, index }) => parseLine(line, index + 1));
}
