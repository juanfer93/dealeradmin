// Body for the HighLevel Custom Code action used by all four collector workflows.
// Keep this executable without imports: HighLevel provides inputData at runtime.
const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const emptyMarker = (value) => /^(?:--|-|n\/?a|not indicated|not specified|no indicado|no especificado)$/i.test(clean(value));
const first = (...values) => values.map(clean).find((value) => value && !emptyMarker(value)) || '';
const rawMemory = String(inputData.qualification_memory ?? '').trim();
const rawMessage = String(inputData.message ?? '').replace(/\r\n?/g, '\n').trim();
const rawHistory = String(inputData.chat_history_log ?? '').replace(/\r\n?/g, '\n').trim();
const message = clean(rawMessage);
const history = clean(rawHistory);
const normalizeMatch = (value) => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const nonVehicleIntentValues = /^(?:(?:(?:quiero|necesito|me gustar[ií]a|me interesa)\s+)?(?:m[aá]s\s+)?(?:informaci[oó]n|info|detalles?|details?|information)|more\s+(?:information|info|details?)|learn\s+more)$/i;
const normalizePhone = (value) => {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return '';
};
const phoneFrom = (...values) => {
  for (const value of values) {
    const direct = normalizePhone(value);
    if (direct) return direct;
  }
  const source = values.map((value) => String(value ?? '')).join(' ');
  const matches = source.match(/(?:\+?1[\d\s().-]{9,16}\d|\d[\d\s().-]{8,14}\d)/g) || [];
  for (const candidate of matches) {
    const normalized = normalizePhone(candidate);
    if (normalized) return normalized;
  }
  return '';
};
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
const invalidRealNames = new Set(['.', '..', '...', 'unknown', 'n/a', 'na', 'lead', 'whatsapp', 'facebook', 'thu chikitha linda']);
const qualificationResponseMarkers = /\b(?:today|hoy|asap|as soon as possible|immediately|inmediato|para ya|ahora mismo|this week|esta semana|this month|este mes|next week|pr[oó]xima? semana|next month|pr[oó]ximo mes|baltimore|maryland|suv|sedan|truck|troca|pickup|pick-up|van|minivan|crossover|coupe|coupé|hatchback|motorcycle|moto|yes|yeah|yep|correct|tengo|have it|i have|si|sí|no|no tengo)\b/i;
const phoneLikeText = (value) => {
  const candidate = clean(value);
  const digits = candidate.replace(/\D/g, '');
  return /\b(?:mi|my)\s+(?:n[uú]mero|number|phone|tel[eé]fono|telephone|contact)\b/i.test(candidate)
    || digits.length >= 7;
};
const normalizeRealName = (value) => {
  const candidate = clean(value);
  if (!candidate || invalidRealNames.has(candidate.toLowerCase()) || phoneLikeText(candidate) || !/[a-záéíóúüñ]/i.test(candidate) || /^[\W_\d]+$/u.test(candidate) || qualificationResponseMarkers.test(candidate)) return '';
  if (candidate.length > 100 || candidate.split(/\s+/).length > 8) return '';
  return formatPersonalName(candidate);
};
const isBusinessName = (value) => /\b(?:auto\s*sales|motors?|dealership|dealer|llc|inc(?:orporated)?|corp(?:oration)?|company|tatuajes?|tattoos?|operaciones?|operations?|transport(?:ation)?|logistics|construction|remodeling|roofing|realty|consulting|services?|servicios?|shop|tienda|salon|barbershop|restaurant)\b/i.test(clean(value));
const isProfileDisplayName = (value) => /[^\p{L}\p{M}\s.'-]/u.test(clean(value));
const nameParticles = new Set(['da', 'de', 'del', 'der', 'di', 'la', 'las', 'los', 'van', 'von', 'y']);
const formatPersonalName = (value) => {
  if (isBusinessName(value) || !/^[a-záéíóúüñ][a-záéíóúüñ' -]*$/i.test(value)) return value;
  return value.split(/\s+/).map((part, index) => {
    const lower = part.toLocaleLowerCase();
    if (index > 0 && nameParticles.has(lower)) return lower;
    return lower.split(/([-'])/).map((piece) => /[-']/.test(piece) ? piece : piece ? `${piece[0].toLocaleUpperCase()}${piece.slice(1)}` : piece).join('');
  }).join(' ');
};
const nameFromText = (value) => {
  const segments = String(value ?? '').replace(/\r\n?/g, '\n').split(/[\n.!?;]+/).map(clean).filter(Boolean);
  for (const segment of segments) {
    const named = normalizeRealName(segment.match(/(?:me llamo|mi nombre es|soy|my name is|this is)\s+([a-záéíóúüñ][a-záéíóúüñ' -]{1,80})/i)?.[1]);
    if (named) return named;
    const candidate = segment.replace(/[.!?,;:]+$/g, '');
    if (!/^[a-záéíóúüñ][a-záéíóúüñ'-]*(?:\s+[a-záéíóúüñ][a-záéíóúüñ'-]*){1,3}$/i.test(candidate)) continue;
    if (/\b(?:quiero|busco|necesito|tengo|carro|auto|veh[ií]culo|suv|sedan|truck|troca|camioneta|pickup|van|financiar|finance|down|payment|hoy|today|yes|no)\b/i.test(candidate)) continue;
    const name = normalizeRealName(candidate);
    if (name) return name;
  }
  return '';
};
const suppliedName = normalizeRealName(inputData.real_name);
const extractedNames = [
  memoryValue(['real_name', 'real name', 'customer_name', 'customer name', 'contact_name', 'contact name', 'full_name', 'full name', 'name', 'nombre_real', 'nombre real', 'nombre completo', 'nombre']),
  nameFromText(rawMessage),
  nameFromText(rawHistory),
];
const realName = ((isBusinessName(suppliedName) || isProfileDisplayName(suppliedName)) ? [...extractedNames, suppliedName] : [suppliedName, ...extractedNames]).map(normalizeRealName).find(Boolean) || '';
const isCampaignButton = (value) => /^(?:quiero mi auto con eastern|quiero (?:un )?auto hoy|i want (?:a )?car today|quiero financiar un auto(?: con ustedes)?|me gustaria financiar un auto(?: con ustedes)?|financiar un auto(?: con ustedes)?)$/.test(normalizeMatch(String(value ?? '').replace(/([!?])\s*\d{1,3}$/, '$1').replace(/[!?.,]/g, '')));
const isNonVehicleIntent = (value) => nonVehicleIntentValues.test(clean(value).replace(/[!?.,]/g, '').trim());
const stripCampaignButtonPhrases = (value) => String(value ?? '')
  .replace(/\bquiero mi auto con eastern\b/gi, ' ')
  .replace(/\bquiero (?:un )?auto hoy\b/gi, ' ')
  .replace(/\bi want (?:a )?car today\b/gi, ' ')
  .replace(/\bquiero financiar un auto(?: con ustedes)?\b/gi, ' ')
  .replace(/\bme gustar[ií]a financiar un auto(?: con ustedes)?\b/gi, ' ');
const campaign = isCampaignButton(message);
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
  if (!source || campaign || isNonVehicleIntent(source)) return '';
  const token = '(?:\\d{1,3}(?:,\\d{3})+|\\d+(?:[,.]\\d+)?\\s*k?)';
  const trade = '(?:trade[- ]?in|my car|my vehicle|mi carro|mi auto|carro como enganche)';
  const match = source.match(new RegExp(`\\$?\\s*(${token})\\s*(?:down|payment|enganche|inicial)?\\s*(?:\\+|and|y)\\s*${trade}`, 'i')) || source.match(new RegExp(`${trade}\\s*(?:(?:and|plus|with|y|mas|más|con)\\s*(?:put|poner|pay|pagar|give|dar)?\\s*|[^0-9;.!?]{0,16}(?:down|payment|enganche|inicial|deposit|dep[oó]sito)[^0-9;.!?]{0,8})\\$?\\s*(${token})`, 'i'));
  const value = validAmount(match?.[1]);
  return value ? `${value} + trade-in` : /\btrade[- ]?in\b|\bmy (?:car|vehicle)\b|\bmi (?:carro|auto)\b|\bcarro como enganche\b|\b(?:cambiar|cambio)\s+(?:(?:mi|el|de)\s+)?(?:veh[ií]culo|carro|auto)\b|\bchange\s+(?:my\s+)?(?:vehicle|car)\b/i.test(source) ? 'trade-in' : '';
};
const downFrom = (text) => {
  const source = String(text ?? '').replace(/\r\n?/g, '\n').trim();
  if (!source || campaign) return '';
  const token = '(\\d{1,3}(?:,\\d{3})+|\\d+(?:[,.]\\d+)?\\s*k?)';
  const explicit = source.match(new RegExp(`(?:down|enganche|inicial|deposit|dep[oó]sito)\\s*(?:payment|pago)?\\s*(?:is|es|de|:)?\\s*\\$?\\s*${token}`, 'i'));
  const standalone = source.match(/(?:^|\n)\$?\s*(\d{1,3}(?:[,.]\d{3})+|\d+(?:[,.]\d+)?\s*k?)\s*(?:tengo|have|available|disponible|i have|i can put)?\s*\d{0,2}\s*\.?\s*(?=\n|$)/im);
  const candidate = standalone?.[1]?.replace(/[$,\s]/g, '') || '';
  if (!explicit && /^20(?:1\d|2\d)$/.test(candidate)) return '';
  return validAmount(explicit?.[1] || standalone?.[1]);
};
const vehicleFrom = (text) => {
  const source = clean(stripCampaignButtonPhrases(text));
  if (!source || campaign) return '';
  const cleaned = source
    .replace(/(?:\+?1[\s().-]*)?(?:\(?[2-9]\d{2}\)?[\s.-]*)\d{3}[\s.-]?\d{4}/g, ' ')
    .replace(/(?:down|enganche|inicial|deposit|dep[oó]sito)\s*(?:payment|pago)?\s*(?:is|es|de|:)?\s*\$?[\d,.]+\s*k?/gi, '')
    .replace(/\b(?:today|hoy|asap|immediately|this week|esta semana|this month|este mes|next week|pr[oó]xima? semana|next month|pr[oó]ximo mes)\b/gi, '')
    .split(/[;,]/, 1)[0]
    .trim();
  const requested = cleaned.match(/(?:looking for|busco|quiero|want|interested in|interesado en)\s+(?:a|an|un|una)?\s*([^.!?]+)/i)?.[1];
  if (requested && !isNonVehicleIntent(requested) && /\b(?:suv|sedan|truck|troca|pickup|van|minivan|crossover|coupe|hatchback|toyota|honda|ford|nissan|chevrolet|hyundai|kia|mazda|subaru|volkswagen|jeep|ram|gmc|bmw|mercedes|audi|lexus|acura|volvo|tesla|tacoma|rav4|civic|accord|camry|corolla|f-?150|explorer|cr-v|pilot|sierra|silverado|wrangler)\b/i.test(requested)) return clean(requested);
  const category = cleaned.match(/\b(suv|sedan|truck|troca|pickup|van|minivan|crossover|coupe|hatchback)\b/i)?.[1];
  if (category) return category;
  const vehicle = cleaned.match(/\b(?:toyota|honda|ford|nissan|chevrolet|hyundai|kia|mazda|subaru|volkswagen|jeep|ram|gmc|bmw|mercedes|audi|lexus|acura|volvo|tesla)\b(?:\s+[a-z0-9-]+){0,2}/i)?.[0];
  return clean(vehicle?.replace(/\b(?:19|20)\d{2}\b/g, '').replace(/\s+/g, ' '));
};
const cleanVehicleValue = (value) => isCampaignButton(value) || isNonVehicleIntent(value) ? '' : clean(value).replace(/(?:19|20)\d{2}(?:\d{2})*$/i, '').trim();
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
  const positive = 'yes|sí|si|yeah|yep|correct|tengo|have it|i do|i have|available';
  const negative = "no|n[oó]|sin|not|dont|don't|no tengo|i do not|do not have|not available";
  const conversationalContext = conversational.match(new RegExp(`(?:${positive}|${negative})[^;.!?]{0,60}(?:${pattern})|(?:${pattern})[^;.!?]{0,60}(?:${positive}|${negative})`, 'i'))?.[0] || '';
  const conversationalStatus = yesNo(conversationalContext);
  if (conversationalStatus) return conversationalStatus;
  if (new RegExp(pattern, 'i').test(conversational) && !new RegExp(`\\b(?:${negative})\\b`, 'i').test(conversational)) return 'yes';
  const memory = [memoryValue(memoryAliases), memoryValue(['documents', 'docs', 'documentos'])].filter(Boolean);
  for (const value of memory) {
    if (new RegExp(pattern, 'i').test(value)) return yesNo(value) || 'yes';
  }
  return '';
};
const vehicle = first(
  campaign ? '' : cleanVehicleValue(vehicleFrom(message)),
  cleanVehicleValue(vehicleFrom(history)),
  cleanVehicleValue(memoryValue(['vehicle', 'vehicle_type'])),
  cleanVehicleValue(inputData.vehicle_type),
);
const cashDown = campaign ? '' : first(downFrom(rawMessage), downFrom(rawHistory), memoryValue(['down payment', 'down_payment', 'downpayment']), validAmount(inputData.down_payment));
const tradeDown = campaign ? '' : first(tradeIn(message), tradeIn(history), tradeIn(memoryText(rawMemory)));
const downCandidate = cashDown || tradeDown;
const conversationalDownSource = `${message}; ${history}`;
const down = validAmount(cashDown && /trade[- ]?in|my car|my vehicle|mi carro|mi auto|carro como enganche|(?:cambiar|cambio)\\s+(?:(?:mi|el|de)\\s+)?(?:veh[ií]culo|carro|auto)|change\\s+(?:my\\s+)?(?:vehicle|car)/i.test(conversationalDownSource) && !/trade[- ]?in/i.test(cashDown)
  ? `${cashDown} + trade-in`
  : downCandidate);
const timeline = first(timelineFrom(message), timelineFrom(history), memoryValue(['timeline', 'purchase timeline', 'purchase_timeline']), inputData.purchase_timeline);
const identification = documentStatus('id\\b|identification\\b|identificación\\b|driver.?s license\\b|license\\b|licencia\\b|itin\\b|passport\\b|pasaporte\\b', ['identification', 'id', 'itin', 'passport', 'pasaporte'], inputData.identification || inputData.documents);
const income = documentStatus('proof of income|income proof|prueba de ingresos|comprobante de ingresos|estados? de cuenta|account statements?|bank statements?|financial statements?|pay stubs?|check stubs?|talones? de pago|colillas? de cheques?|recibos? de n[oó]mina|bank account|cuenta bancaria|cuenta de banco', ['income', 'proof of income', 'estados de cuenta', 'account statements', 'bank statements', 'check stubs', 'bank account', 'cuenta bancaria'], inputData.documents);
const bankContext = `${message}; ${history}`.match(/(?:bank account|cuenta bancaria)[^;]*(?:yes|sí|si|yeah|yep|correct|tengo|have it|i do|i have|available|no|not|sin|dont|don't|no tengo|i do not|do not have|not available)/i)?.[0] || '';
const bankAccount = first(yesNo(inputData.bank_account), yesNo(bankContext), yesNo(memoryValue(['bank account', 'bank_account', 'cuenta bancaria'])));
const documents = first(memoryValue(['documents', 'docs', 'documentos']), inputData.documents, [identification === 'yes' ? 'identification: yes' : '', income === 'yes' ? 'proof of income: yes' : ''].filter(Boolean).join(', '));
const customPresent = [inputData.vehicle_type, inputData.down_payment, inputData.purchase_timeline, inputData.documents, inputData.identification, inputData.bank_account].some((value) => clean(value) && !emptyMarker(value));
const qualificationSource = rawMemory && customPresent ? 'both' : rawMemory ? 'qualification_memory' : customPresent ? 'custom_fields' : 'none';
const missing = [!vehicle ? 'vehicle_type' : '', !down ? 'down_payment' : '', !timeline ? 'purchase_timeline' : '', identification !== 'yes' ? 'identification' : '', income !== 'yes' ? 'proof_of_income' : '', bankAccount !== 'yes' ? 'bank_account' : ''].filter(Boolean);
const parts = memoryText(rawMemory).split(';').map((part) => clean(part).replace(/^\d+(?=(?:vehicle|vehicle[_ ]?type|down|down[_ ]?payment|documents?|timeline)\b)/i, '')).filter((part) => Boolean(part) && !/^\$?\d[\d,.]*$/.test(part));
const canonical = [['real_name', realName], ['vehicle', vehicle], ['down payment', down], ['documents', documents], ['timeline', timeline]].filter(([, value]) => value).map(([key, value]) => `${key}: ${String(value).replace(/\s*;\s*/g, ', ')}`);
const qualificationMemory = [...new Set([...parts.filter((part) => !/^(?:real_name|real name|name|nombre|nombre real|nombre completo|vehicle|vehicle_type|down|down payment|down_payment|documents?|docs|timeline|purchase timeline|purchase_timeline)\s*(?::|=|-)/i.test(part)), ...canonical])].join('; ');
// Prefer a phone written in the conversation, but preserve a validated native
// GHL contact phone when the webhook delivers the conversation message
// separately (for example, message = "Ok"). Never scan
// qualification_memory/qualifier text: vehicle values such as
// "SUV20202020202020" must not become a lead phone.
const phone = phoneFrom(message, history, inputData.phone);
const appendOnlyHistory = [history, message]
  .filter((value, index, values) => value && values.findIndex((item) => item.toLowerCase() === value.toLowerCase()) === index)
  .join('\n');
return {
  real_name: realName,
  vehicle_type: vehicle,
  down_payment: down,
  purchase_timeline: timeline,
  documents,
  identification,
  bank_account: bankAccount,
  qualification_memory: qualificationMemory,
  // This write-back value is derived only from the inbound chat/transcript.
  // Never source the number from qualification fields or a stale contact value.
  phone,
  chat_history_log: appendOnlyHistory,
  dealeradmin_send_now: missing.length === 0 && Boolean(phone),
  has_identification: identification,
  has_income_proof: income,
  next_question: !identification ? 'Do you have a valid ID or driver license?' : !income ? 'Do you have proof of income?' : !bankAccount ? 'Do you have a bank account?' : '',
  qualification_complete: missing.length === 0,
  missing_qualification: missing,
  qualification_source: qualificationSource,
};
