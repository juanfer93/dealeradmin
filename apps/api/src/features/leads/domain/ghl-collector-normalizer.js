// Body for the HighLevel Custom Code action used by all four collector workflows.
// Keep this executable without imports: HighLevel provides inputData at runtime.
const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const emptyMarker = (value) => /^(?:--|-|n\/?a|not indicated|not specified|no indicado|no especificado)$/i.test(clean(value));
const first = (...values) => values.map(clean).find((value) => value && !emptyMarker(value)) || '';
const rawMemory = String(inputData.qualification_memory ?? '').trim();
const message = clean(inputData.message);
const history = clean(inputData.chat_history_log);
const memoryText = (value) => {
  const source = String(value ?? '').trim();
  if (!source) return '';
  try {
    const parsed = JSON.parse(source);
    if (parsed && typeof parsed === 'object') return Object.entries(parsed).map(([key, item]) => `${key}: ${typeof item === 'object' ? JSON.stringify(item) : item}`).join('; ');
  } catch {}
  return source.replace(/[\r\n]+/g, '; ').replace(/(?:^|;)\s*[-*•]\s*/g, '; ').replace(/\s*\|\s*/g, '; ');
};
const normalizedMemory = memoryText(rawMemory);
const memoryValue = (aliases) => {
  const pattern = aliases.slice().sort((a, b) => b.length - a.length).map((alias) => alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\ /g, '\\s+')).join('|');
  const match = normalizedMemory.match(new RegExp(`(?:^|[^a-z])(?:${pattern})\\s*(?::|=|-|\\bis\\b|\\bare\\b)\\s*([^;]+)`, 'i'));
  return clean(match?.[1]).replace(/(trade[- ]?in)\d+$/i, '$1');
};
const campaign = /^(?:quiero mi auto con eastern|quiero (?:un )?auto hoy|i want (?:a )?car today)$/i.test(message.replace(/([!?])\s*\d{1,3}$/, '$1').replace(/[!?.,]/g, '').trim());
const amount = (value) => {
  const source = clean(value).toLowerCase();
  if (!source || emptyMarker(source)) return '';
  const tradeMarker = /\btrade[- ]?in\b|\bmy (?:car|vehicle)\b|\bmi (?:carro|auto)\b|\bcarro como enganche\b|\b(?:cambiar|cambio)\s+(?:(?:mi|el|de)\s+)?(?:veh[ií]culo|carro|auto)\b|\bchange\s+(?:my\s+)?(?:vehicle|car)\b/i;
  if (tradeMarker.test(source)) {
    const cash = source.match(/\$?\s*(\d[\d,.]*\s*k?)\b/i)?.[1];
    const base = cash ? amount(cash) : '';
    return base ? `${base} + trade-in` : 'trade-in';
  }
  const compound = source.match(/^(.+?)\s*\+\s*trade[- ]?in\d*$/i);
  if (compound) { const base = amount(compound[1]); return base ? `${base} + trade-in` : ''; }
  if (source.replace(/\D/g, '').length >= 10) return '';
  if (/\b(?:cash|contado|efectivo|paid in full|paga(?:r)? de contado)\b/i.test(source)) return 'Cash';
  const compact = source.replace(/[$,]/g, '').trim();
  const k = compact.match(/^(\d+(?:\.\d+)?)\s*k$/i);
  if (k) return String(Math.round(Number(k[1]) * 1000));
  const numeric = compact.match(/^(\d+(?:\.\d+)?)(?:\s*(?:dollars?|usd))?$/i);
  return numeric ? String(Math.round(Number(numeric[1]))) : '';
};
const validAmount = (value) => amount(value);
const tradeIn = (text) => {
  const source = clean(text);
  if (!source || campaign) return '';
  const token = '(?:\\d{1,3}(?:,\\d{3})+|\\d+(?:[,.]\\d+)?\\s*k?)';
  const trade = '(?:trade[- ]?in|my car|my vehicle|mi carro|mi auto|carro como enganche)';
  const match = source.match(new RegExp(`\\$?\\s*(${token})\\s*(?:down|payment|enganche|inicial)?\\s*(?:\\+|and|y)\\s*${trade}`, 'i')) || source.match(new RegExp(`${trade}[^0-9]{0,24}\\$?\\s*(${token})`, 'i'));
  const value = validAmount(match?.[1]);
  return value ? `${value} + trade-in` : /\btrade[- ]?in\b|\bmy (?:car|vehicle)\b|\bmi (?:carro|auto)\b|\bcarro como enganche\b|\b(?:cambiar|cambio)\s+(?:(?:mi|el|de)\s+)?(?:veh[ií]culo|carro|auto)\b|\bchange\s+(?:my\s+)?(?:vehicle|car)\b/i.test(source) ? 'trade-in' : '';
};
const downFrom = (text) => {
  const source = clean(text);
  if (!source || campaign) return '';
  const token = '(\\d{1,3}(?:,\\d{3})+|\\d+(?:[,.]\\d+)?\\s*k?)';
  const explicit = source.match(new RegExp(`(?:down|enganche|inicial|deposit|dep[oó]sito)\\s*(?:payment|pago)?\\s*(?:is|es|de|:)?\\s*\\$?\\s*${token}`, 'i'));
  const standalone = source.match(/^\$?\s*(\d{1,3}(?:[,.]\d{3})+|\d+(?:[,.]\d+)?\s*k?)\s*(?:tengo|have|available|disponible|i have|i can put)?\s*\d{0,2}\s*\.?$/i);
  return validAmount(explicit?.[1] || standalone?.[1]);
};
const vehicleFrom = (text) => {
  const source = clean(text);
  if (!source || campaign) return '';
  const cleaned = source.replace(/(?:down|enganche|inicial|deposit|dep[oó]sito)\s*(?:payment|pago)?\s*(?:is|es|de|:)?\s*\$?[\d,.]+\s*k?/gi, '').replace(/\b(?:today|hoy|asap|immediately|this week|esta semana|this month|este mes|next week|pr[oó]xima? semana|next month|pr[oó]ximo mes)\b/gi, '').trim();
  const requested = cleaned.match(/(?:looking for|busco|quiero|want|interested in|interesado en)\s+(?:a|an|un|una)?\s*([^.!?]+)/i)?.[1];
  if (requested && /\b(?:suv|sedan|truck|troca|pickup|van|minivan|crossover|coupe|hatchback|toyota|honda|ford|nissan|chevrolet|hyundai|kia|mazda|subaru|volkswagen|jeep|ram|gmc|bmw|mercedes|audi|lexus|acura|volvo|tesla|tacoma|rav4|civic|accord|camry|corolla|f-?150|explorer|cr-v|pilot|sierra|silverado|wrangler)\b/i.test(requested)) return clean(requested);
  const hit = cleaned.match(/\b(?:suv|sedan|truck|troca|pickup|van|minivan|crossover|coupe|hatchback|toyota|honda|ford|nissan|chevrolet|hyundai|kia|mazda|subaru|volkswagen|jeep|ram|gmc|bmw|mercedes|audi|lexus|acura|volvo|tesla|tacoma|rav4|civic|accord|camry|corolla|f-?150|explorer|cr-v|pilot|sierra|silverado|wrangler)\b[^.!?]*/i)?.[0];
  return clean(hit?.replace(/\b(?:19|20)\d{2}\b/g, '').replace(/\d+$/g, ''));
};
const timelineFrom = (text) => {
  const hit = clean(text).match(/\b(?:today|hoy|asap|as soon as possible|immediately|inmediato|para ya|ahora mismo|de inmediato|lo m[aá]s pronto posible|lo antes posible|this week|esta semana|this month|este mes|next week|pr[oó]xima? semana|next month|pr[oó]ximo mes|within \d+ days?|en \d+ d[ií]as?)\b/i)?.[0] || '';
  if (/today|hoy|asap|immediately|inmediato|para ya|ahora mismo|de inmediato|lo antes/i.test(hit)) return 'today';
  if (/this week|esta semana/i.test(hit)) return 'this week';
  if (/this month|este mes/i.test(hit)) return 'this month';
  if (/next week|pr[oó]xima? semana/i.test(hit)) return 'next week';
  if (/next month|pr[oó]ximo mes/i.test(hit)) return 'next month';
  return hit;
};
const yesNo = (value) => {
  const source = clean(value).toLowerCase();
  if (/\b(?:no|n[oó]|sin|not|dont|don't|no tengo|i do not|do not have|not available)\b/i.test(source)) return 'no';
  if (/\b(?:yes|sí|si|yeah|yep|correct|tengo|have it|i do|i have|available)\b/i.test(source)) return 'yes';
  return '';
};
const documentStatus = (pattern, memoryAliases, custom) => {
  const customStatus = emptyMarker(custom) ? '' : yesNo(custom);
  if (customStatus) return customStatus;
  if (new RegExp(pattern, 'i').test(clean(custom)) && !/\b(?:no|n[oó]|sin|not|dont|don't|no tengo|do not have|not available)\b/i.test(clean(custom))) return 'yes';
  const conversational = `${message}; ${history}`;
  const conversationalStatus = yesNo(conversational.match(new RegExp(`(?:${pattern})[^;.!?]{0,60}`, 'i'))?.[0] || conversational.match(new RegExp(`[^;.!?]{0,60}(?:${pattern})`, 'i'))?.[0] || '');
  if (conversationalStatus) return conversationalStatus;
  const memory = [memoryValue(memoryAliases), memoryValue(['documents', 'docs', 'documentos'])].filter(Boolean);
  for (const value of memory) {
    if (new RegExp(pattern, 'i').test(value)) return yesNo(value) || 'yes';
  }
  return '';
};
const vehicle = first(campaign ? '' : vehicleFrom(message), vehicleFrom(history), memoryValue(['vehicle', 'vehicle_type']), inputData.vehicle_type);
const downCandidate = campaign ? '' : first(tradeIn(message), downFrom(message), downFrom(history), memoryValue(['down payment', 'down_payment', 'downpayment']), validAmount(inputData.down_payment));
const down = validAmount(downCandidate);
const timeline = first(timelineFrom(message), timelineFrom(history), memoryValue(['timeline', 'purchase timeline', 'purchase_timeline']), inputData.purchase_timeline);
const identification = documentStatus('id\\b|identification|identificación|driver.?s license|license|licencia', ['identification', 'id'], inputData.identification || inputData.documents);
const income = documentStatus('proof of income|income proof|prueba de ingresos|comprobante de ingresos', ['income', 'proof of income'], inputData.documents);
const bankAccount = first(yesNo(inputData.bank_account), yesNo(message), yesNo(memoryValue(['bank account', 'bank_account', 'cuenta bancaria'])));
const documents = first(memoryValue(['documents', 'docs', 'documentos']), inputData.documents, [identification === 'yes' ? 'identification: yes' : '', income === 'yes' ? 'proof of income: yes' : ''].filter(Boolean).join(', '));
const customPresent = [inputData.vehicle_type, inputData.down_payment, inputData.purchase_timeline, inputData.documents, inputData.identification, inputData.bank_account].some((value) => clean(value) && !emptyMarker(value));
const qualificationSource = rawMemory && customPresent ? 'both' : rawMemory ? 'qualification_memory' : customPresent ? 'custom_fields' : 'none';
const missing = [!vehicle ? 'vehicle_type' : '', !down ? 'down_payment' : '', !timeline ? 'purchase_timeline' : '', identification !== 'yes' ? 'identification' : '', income !== 'yes' ? 'proof_of_income' : ''].filter(Boolean);
const parts = memoryText(rawMemory).split(';').map((part) => clean(part).replace(/^\d+(?=(?:vehicle|vehicle[_ ]?type|down|down[_ ]?payment|documents?|timeline)\b)/i, '')).filter(Boolean);
const canonical = [['vehicle', vehicle], ['down payment', down], ['documents', documents], ['timeline', timeline]].filter(([, value]) => value).map(([key, value]) => `${key}: ${String(value).replace(/\s*;\s*/g, ', ')}`);
const qualificationMemory = [...new Set([...parts.filter((part) => !/^(?:vehicle|vehicle_type|down|down payment|down_payment|documents?|docs|timeline|purchase timeline|purchase_timeline)\s*(?::|=|-)/i.test(part)), ...canonical])].join('; ');
return {
  vehicle_type: vehicle,
  down_payment: down,
  purchase_timeline: timeline,
  documents,
  identification,
  bank_account: bankAccount,
  qualification_memory: qualificationMemory,
  has_identification: identification,
  has_income_proof: income,
  next_question: !identification ? 'Do you have a valid ID or driver license?' : !income ? 'Do you have proof of income?' : !bankAccount ? 'Do you have a bank account?' : '',
  qualification_complete: missing.length === 0,
  missing_qualification: missing,
  qualification_source: qualificationSource,
};
