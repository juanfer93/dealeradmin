export type CollectorInput = {
  message?: string | null;
  vehicle_type?: string | null;
  down_payment?: string | null;
  purchase_timeline?: string | null;
  documents?: string | null;
  identification?: string | null;
  bank_account?: string | null;
  qualification_memory?: string | null;
};

export type CollectorOutput = {
  vehicle_type: string;
  down_payment: string;
  purchase_timeline: string;
  documents: string;
  identification: string;
  bank_account: string;
  qualification_memory: string;
  has_identification: string;
  has_income_proof: string;
  next_question: string;
};

const EMPTY = '';

function clean(value: string | null | undefined): string {
  return value?.replace(/\s+/g, ' ').trim() ?? EMPTY;
}

function firstNonEmpty(...values: Array<string | null | undefined>): string {
  return values.map(clean).find(Boolean) ?? EMPTY;
}

function normalizeAmount(value: string): string {
  const source = clean(value).toLowerCase();
  if (!source) return EMPTY;
  if (/\b(?:cash|contado|efectivo|paid in full|paga(?:r)? de contado)\b/i.test(source)) return 'Cash';

  const compact = source.replace(/\$/g, '').replace(/,/g, '').trim();
  const kMatch = compact.match(/^(\d+(?:\.\d+)?)\s*k$/i);
  if (kMatch) return String(Math.round(Number(kMatch[1]) * 1000));

  const amountMatch = compact.match(/^(\d+(?:\.\d+)?)\s*(?:dollars?|usd)?$/i);
  if (amountMatch) return String(Math.round(Number(amountMatch[1])));

  const words: Record<string, number> = {
    hundred: 100,
    thousand: 1000,
    'one thousand': 1000,
    'dos mil': 2000,
    'tres mil': 3000,
    'cinco mil': 5000,
  };
  for (const [phrase, amount] of Object.entries(words)) {
    if (source.includes(phrase)) return String(amount);
  }
  return clean(value);
}

function normalizeVehicle(value: string): string {
  const source = clean(value);
  if (!source) return EMPTY;
  const lower = source.toLowerCase();
  const category = lower.match(/\b(suv|sedan|truck|troca|pickup|pick-up|van|minivan|crossover|coupe|coupé|hatchback|motorcycle|moto)\b/i)?.[1];
  const brand = source.match(/\b(toyota|honda|ford|nissan|chevrolet|chevy|hyundai|kia|mazda|subaru|volkswagen|vw|jeep|ram|gmc|bmw|mercedes|audi|lexus|acura|volvo|tesla)\b/i)?.[1];
  if (category && brand) return `${category.replace('troca', 'truck')} — ${source}`;
  return source;
}

function extractVehicle(message: string): string {
  const source = clean(message);
  if (!source) return EMPTY;
  const withoutOtherFacts = source
    .replace(/(?:down|enganche|inicial|deposit|dep[oó]sito)\s*(?:payment|pago)?\s*(?:is|es|de|:)?\s*\$?\s*[\d,.]+\s*k?/gi, '')
    .replace(/\b(?:today|hoy|asap|this week|esta semana|this month|este mes|next week|pr[oó]xima? semana|next month|pr[oó]ximo mes)\b/gi, '')
    .trim();
  const requested = withoutOtherFacts.match(/(?:looking for|busco|quiero|want|interested in|interesado en)\s+(?:a|an|un|una)?\s*([^.!?]+)/i)?.[1];
  if (requested) return clean(requested);
  const category = withoutOtherFacts.match(/\b(suv|sedan|truck|troca|pickup|pick-up|van|minivan|crossover|coupe|coupé|hatchback|motorcycle|moto)\b/i)?.[1];
  const brand = withoutOtherFacts.match(/\b(toyota|honda|ford|nissan|chevrolet|chevy|hyundai|kia|mazda|subaru|volkswagen|vw|jeep|ram|gmc|bmw|mercedes|audi|lexus|acura|volvo|tesla)\b/i)?.[1];
  return brand || category ? clean(withoutOtherFacts) : EMPTY;
}

function extractDownPayment(message: string): string {
  const source = clean(message);
  if (!source) return EMPTY;
  if (/\b(?:cash|contado|efectivo|paid\s+in\s+full|paga(?:r)?\s+de\s+contado)\b/i.test(source)) return 'Cash';
  const amount = source.match(/(?:down|enganche|inicial|deposit|dep[oó]sito)\s*(?:payment|pago)?\s*(?:is|es|de|:)?\s*\$?\s*([\d,.]+\s*k?)/i)?.[1]
    ?? source.match(/\$?\s*(\d+(?:[,.]\d+)?\s*k?)\s*(?:(?:for|para|as|on)\s*)?(?:down|enganche|inicial)/i)?.[1];
  return amount ? normalizeAmount(amount) : EMPTY;
}

function extractTimeline(message: string): string {
  const source = clean(message);
  if (!source) return EMPTY;
  const match = source.match(/\b(?:today|hoy|asap|immediately|inmediato|this week|esta semana|this month|este mes|esta mes|next week|pr[oó]xima? semana|next month|pr[oó]ximo mes|within \d+ days?|en \d+ d[ií]as?)\b/i)?.[0];
  return match ? normalizeTimeline(match) : /\b(?:solo|sólo|just|only)\b.*\b(?:mirando|viendo|looking|browsing)\b/i.test(source) ? 'exploring options' : EMPTY;
}

function normalizeTimeline(value: string): string {
  const source = clean(value).toLowerCase();
  if (!source) return EMPTY;
  if (/\b(today|hoy|asap|immediately|inmediato)\b/i.test(source)) return 'today';
  if (/\b(this|esta)\s+(week|semana)\b/i.test(source)) return 'this week';
  if (/\b(this|este|esta)\s+(month|mes)\b/i.test(source)) return 'this month';
  if (/\b(next|proximo|próximo)\s+(week|semana)\b/i.test(source)) return 'next week';
  if (/\b(next|proximo|próximo)\s+(month|mes)\b/i.test(source)) return 'next month';
  if (/\b(30|thirty)\s+days?\b/i.test(source)) return 'within 30 days';
  if (/\b(solo|sólo|just|only)\b.*\b(mirando|viendo|looking|browsing)\b/i.test(source)) return 'exploring options';
  return clean(value);
}

function yesNo(value: string): 'yes' | 'no' | '' {
  const source = clean(value).toLowerCase();
  if (!source) return '';
  if (/\b(no|n[oó]|dont|don't|no tengo|i do not|do not have|don't have|not available)\b/i.test(source)) return 'no';
  if (/\b(yes|sí|si|yeah|yep|correct|tengo|have it|i do|i have|available)\b/i.test(source)) return 'yes';
  return '';
}

function mergeDocuments(current: string, message: string): { value: string; id: string; income: string } {
  const source = `${current} ${message}`.trim();
  const answer = (documentPattern: string): 'yes' | 'no' | '' => {
    const positive = 'yes|sí|si|yeah|yep|correct|tengo|have it|i do|i have|available';
    const negative = "no|nó|dont|don't|no tengo|i do not|do not have|don't have|not available";
    const context = source.match(new RegExp(`(?:${positive}|${negative})[^.;,!?]{0,40}(?:${documentPattern})|(?:${documentPattern})[^.;,!?]{0,40}(?:${positive}|${negative})`, 'i'))?.[0] ?? '';
    return yesNo(context);
  };
  const id = answer('id|identification|identificación|license|licencia');
  const income = answer('proof of income|income proof|prueba de ingresos|comprobante de ingresos');
  const parts = [clean(current)];
  if (id) parts.push(`identification: ${id}`);
  if (income) parts.push(`proof of income: ${income}`);
  return { value: [...new Set(parts.filter(Boolean))].join('; '), id, income };
}

function mergeMemory(current: string, values: Record<string, string>): string {
  const existing = clean(current);
  const currentFacts = Object.entries(values)
    .filter(([, value]) => Boolean(clean(value)))
    .map(([key, value]) => `${key}: ${clean(value)}`);
  const merged = [existing, ...currentFacts].filter(Boolean).join('; ');
  return merged;
}

export function normalizeCollectorInput(input: CollectorInput): CollectorOutput {
  const message = clean(input.message);
  const vehicle = normalizeVehicle(firstNonEmpty(input.vehicle_type, extractVehicle(message)));
  const down = normalizeAmount(firstNonEmpty(input.down_payment, extractDownPayment(message)));
  const timeline = normalizeTimeline(firstNonEmpty(input.purchase_timeline, extractTimeline(message)));
  const docs = mergeDocuments(clean(input.documents), message);
  const identification = firstNonEmpty(input.identification, docs.id);
  const bankAccount = firstNonEmpty(input.bank_account, message.match(/(?:bank account|cuenta bancaria)[^.!?]*/i)?.[0]);
  const memory = mergeMemory(input.qualification_memory ?? EMPTY, {
    vehicle,
    'down payment': down,
    documents: docs.value,
    timeline,
  });

  const nextQuestion = !docs.id
    ? 'Do you have a valid ID or driver license?'
    : !docs.income
      ? 'Do you have proof of income?'
      : EMPTY;

  return {
    vehicle_type: vehicle,
    down_payment: down,
    purchase_timeline: timeline,
    documents: docs.value,
    identification,
    bank_account: bankAccount,
    qualification_memory: memory,
    has_identification: docs.id,
    has_income_proof: docs.income,
    next_question: nextQuestion,
  };
}
