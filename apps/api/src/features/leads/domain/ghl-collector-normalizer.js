// Body for the HighLevel Custom Code action used by all four collector workflows.
// Keep this executable without imports: HighLevel provides inputData at runtime.
const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const advisorHandoffVehicle = 'Quiere hablar con un asesor';
const cashDownPayment = 'Pagara en cash / de contado';
const isAdvisorHandoffVehicle = (value) => clean(value).toLocaleLowerCase() === advisorHandoffVehicle.toLocaleLowerCase();
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
  const source = String(value ?? '').trim();
  // A phone field may contain formatting, but a free-form message must not
  // be treated as a phone just because its prices/mileage add up to 10 digits.
  if (!/^\+?[\d\s().-]+$/.test(source)) return '';
  const digits = source.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return '';
};
const phoneFrom = (...values) => {
  for (const value of values) {
    const direct = normalizePhone(value);
    if (direct) return direct;
    const matches = String(value ?? '').match(/(?<!\d)(?:\+?1[\s().-]*)?(?:\([2-9]\d{2}\)|[2-9]\d{2})[\s.-]*\d{3}[\s.-]*\d{4}(?!\d)/g) || [];
    for (const candidate of matches) {
      const normalized = normalizePhone(candidate);
      if (normalized) return normalized;
    }
  }
  return '';
};
const isPhoneOnlyLine = (value) => {
  const source = clean(value);
  const digits = source.replace(/\D/g, '');
  return (digits.length === 10 || (digits.length === 11 && digits.startsWith('1')))
    && !/[a-záéíóúüñ]/i.test(source);
};
const isPhoneAreaCodeAmount = (value, phone) => {
  const areaCode = String(phone ?? '').match(/^\+1(\d{3})/)?.[1] || '';
  return Boolean(areaCode && clean(value).replace(/\D/g, '') === areaCode);
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
const invalidRealNames = new Set(['.', '..', '...', 'unknown', 'n/a', 'na', 'lead', 'whatsapp', 'facebook', 'saludos', 'hello', 'hi', 'hey', 'hola', 'greetings', 'thu chikitha linda']);
const qualificationResponseMarkers = /\b(?:today|hoy|asap|as soon as possible|immediately|inmediato|para ya|ahora mismo|now if possible|if possible now|ahora si se puede|si es posible ahora|lo m[aá]s pronto posible|lo antes posible|lo antes que pueda|this week|esta semana|this month|este mes|next week|pr[oó]xima? semana|next month|pr[oó]ximo mes|baltimore|maryland|where are you located|where are you|d[oó]nde est[aá]n ubicad[oa]s?|d[oó]nde est[aá]n|ubicaci[oó]n|ubicados?|suv|sedan|truck|troca|pickup|pick-up|van|minivan|crossover|coupe|coupé|hatchback|motorcycle|moto|requirements?|requisitos?|yes|yeah|yep|correct|tengo|tiene|have it|i have|i'm looking|im looking|looking for|busco|buscando|quiero|want|interested|si|sí|no|no tengo|papeles?|aplicar|apply|perfecto|perfect|claro|bien|bueno)\b/i;
const singleWordNameBlocklist = /^(?:ok(?:ay)?|si|s[ií]|yes|no|yeah|yep|correct|cash|today|hoy|now|ahora|asap|inmediato|requirements?|requisitos?|information|informaci[oó]n|details?|detalles?|baltimore|maryland|virginia|laurel|rosedale|sterling|elkton|manda|nada|bale|vale|ubicaci[oó]n|ubicasion|tacoma|toyota|hummer|honda|ford|nissan|chevrolet|chevy|hyundai|kia|mazda|subaru|volkswagen|vw|jeep|ram|gmc|bmw|mercedes|audi|lexus|acura|volvo|tesla|dodge|chrysler|buick|cadillac|lincoln|infiniti|genesis|mini|porsche|jaguar|rivian|lucid|mitsubishi|pontiac|saturn|oldsmobile|fiat|suzuki|isuzu|scion|mustang|rav4|civic|accord|camry|corolla|highlander|sienna|4runner|tundra|sequoia|prius|avalon|maverick|ranger|bronco|explorer|expedition|escape|edge|pilot|passport|ridgeline|odyssey|sierra|silverado|tahoe|suburban|traverse|equinox|camaro|malibu|blazer|colorado|yukon|acadia|terrain|wrangler|gladiator|cherokee|compass|renegade|charger|challenger|durango|journey|caravan|pacifica|frontier|titan|rogue|pathfinder|altima|sentra|versa|maxima|armada|sportage|telluride|sorento|soul|rio|palisade|santa fe|tucson|elantra|sonata|veloster|wrx|forester|outback|ascent|impreza|atlas|tiguan|jetta|passat|cayenne|range rover|defender|suv|sedan|truck|troca|pickup|pick-up|van|minivan|crossover|coupe|coupé|hatchback|motorcycle|moto|camioneta|financiar|finance|financing|down|payment|enganche|documents?|documentos?|identificaci[oó]n|income|ingresos|proof|prueba|phone|tel[eé]fono|number|n[uú]mero)$/i;
const vehicleBrands = /\b(?:toyota|hummer|honda|ford|nissan|chevrolet|chevy|hyundai|kia|mazda|subaru|volkswagen|vw|jeep|ram|gmc|bmw|mercedes|audi|lexus|acura|volvo|tesla|dodge|chrysler|buick|cadillac|lincoln|infiniti|genesis|mini|porsche|jaguar|land rover|rivian|lucid|mitsubishi|pontiac|saturn|oldsmobile|fiat|suzuki|isuzu|scion)\b/i;
const vehicleModels = /\b(?:grand caravan|grand cherokee|transit connect|promaster city|mustang|tacoma|tacma|rav\s*4|civic|civc|accord|camry|coroll?a|highlander|hilander|sienna|4\s*runner|tundra|sequoia|prius|avalon|f-?150|f-?250|f-?350|maverick|ranger|bronco|explorer|expedition|escape|edge|cr-?v|hr-?v|pilot|passport|ridgeline|odyssey|sierra|silverado|tahoe|suburban|traverse|equinox|camaro|malibu|blazer|colorado|yukon|acadia|terrain|wrangler|gladiator|cherokee|compass|renegade|charger|challenger|durango|journey|caravan|pacifica|frontier|titan|rogue|pathfinder|altima|sentra|versa|maxima|armada|sportage|telluride|sorento|soul|rio|palisade|santa fe|tucson|elantra|sonata|veloster|wrx|forester|outback|ascent|impreza|atlas|tiguan|jetta|passat|cayenne|rlx|model [3syx]|f-?type|range rover|defender|wrx|highlander)\b/i;
const vehicleCategories = /suv|sedan|truck|troca|trokita|troquita|troque|trokas|pickup|pick-up|van|minivan|crossover|coupe|coupé|hatchback|motorcycle|moto|camioneta|camion|camión/i;
const vehicleContext = /\b(?:tengo|tiene|have|has|i have|my vehicle is|mi (?:carro|auto|veh[ií]culo) es|estoy buscando|ando buscando|looking for|busco|buscando|quiero|want|interested in|interesado en)\b/i;
const economicCarIntent = /\b(?:carro|auto|coche|veh[ií]culo)\s+econ[oó]mic[oa]s?\b/i;
// Stafford's WhatsApp flow commonly answers the vehicle-type prompt with
// "Algo económico" followed by "Normal". Keep it as a sedan category during
// late GHL reconciliation instead of falling back to advisor handoff.
const economicSedanIntent = /\b(?:carro|auto|coche|veh[ií]culo|algo)\s+econ[oó]mic[oa]s?\b/i;
const noDownPaymentResponse = /\b(?:no(?:\s+\w+){0,3}\s+(?:down(?:\s+payment)?|enganche|pago\s+inicial|dinero)|sin\s+(?:down|enganche|pago\s+inicial)|zero\s+down|\$?0\s*(?:down|enganche|pago\s+inicial)?)\b/i;
const canonicalVehicleLabel = (value) => clean(value)
  .replace(/\bcorola\b/gi, 'Corolla')
  .replace(/\bcivc\b/gi, 'Civic')
  .replace(/\btacma\b/gi, 'Tacoma')
  .replace(/\brav\s*4\b/gi, 'RAV4')
  .replace(/\b4\s*runner\b/gi, '4Runner')
  .replace(/\bhilander\b/gi, 'Highlander')
  .replace(/\bcrv\b/gi, 'CR-V')
  .replace(/\bhrv\b/gi, 'HR-V')
  .replace(vehicleBrands, (match) => {
    const lower = match.toLocaleLowerCase();
    if (lower === 'gmc' || lower === 'bmw' || lower === 'vw') return lower.toLocaleUpperCase();
    return `${lower[0].toLocaleUpperCase()}${lower.slice(1)}`;
  })
  .replace(vehicleModels, (match) => match.split(/\s+/).map((token) => {
    const lower = token.toLocaleLowerCase();
    if (lower === 'rav4') return 'RAV4';
    if (lower === '4runner') return '4Runner';
    if (lower === 'rlx') return 'RLX';
    if (lower === 'cr-v' || lower === 'hr-v') return lower.toLocaleUpperCase();
    if (/^f-?\d+$/.test(lower)) return lower.replace(/^f/, 'F-');
    return `${lower[0].toLocaleUpperCase()}${lower.slice(1)}`;
  }).join(' '));
const canonicalVehicleCategory = (value) => clean(value).replace(/\b(?:troca|trokita|troquita|troque|trokas|camioneta|camion|camión)\b/gi, 'truck');
const tradeInLanguage = /\btrade[- ]?in\b|\bmy (?:car|vehicle|van|truck)\b|\bmi (?:carro|auto|veh[ií]culo|van|troca|camioneta|camion)\b|\bcarro como enganche\b|\b(?:cambiar|cambio)\s+(?:(?:mi|el|de)\s+)?(?:veh[ií]culo|carro|auto|van|troca|camioneta|camion)\b|\bchange\s+(?:my\s+)?(?:vehicle|car|van|truck)\b|\b(?:entregar|entrego|entregue|dar|doy)\s+(?:(?:mi|el|de)\s+)?(?:veh[ií]culo|carro|auto|van|troca|camioneta|camion)\b/i;
const vehicleLabel = (value) => {
  let source = clean(value)
    .replace(/\b(?:19|20)\d{2}\b/g, ' ')
    .replace(/\b(?:tengo|tiene|have|has|i have|my vehicle is|mi (?:carro|auto|veh[ií]culo) es|estoy buscando|ando buscando|looking for|busco|buscando|quiero|want|interested in|interesado en)\b/gi, ' ')
    .replace(/\b(?:a|an|un|una|my|mi|the|carro|auto|car|vehicle|veh[ií]culo)\b/gi, ' ')
    .replace(/[!?.,:;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!source) return '';
  const brandMatch = source.match(vehicleBrands);
  const modelMatch = source.match(vehicleModels);
  const categoryMatch = source.match(vehicleCategories);
  const firstMatch = [
    brandMatch ? { kind: 'brand', match: brandMatch } : null,
    modelMatch ? { kind: 'model', match: modelMatch } : null,
    categoryMatch ? { kind: 'category', match: categoryMatch } : null,
  ].filter(Boolean).sort((left, right) => left.match.index - right.match.index)[0];
  if (!firstMatch) return '';
  if (firstMatch.kind === 'brand') {
    const brand = firstMatch.match[0];
    const afterBrand = source.slice(source.toLocaleLowerCase().indexOf(brand.toLocaleLowerCase()) + brand.length).trim();
    const modelAfterBrand = afterBrand.match(vehicleModels);
    if (modelAfterBrand?.index !== undefined) {
      const model = modelAfterBrand[0];
      const afterModel = afterBrand.slice(modelAfterBrand.index + model.length);
      const trim = afterModel.match(/^\s+(?:(?:con|with)\s+(?:(?:el|la|the)\s+)?(?:(?:paquete|package)\s+)?)?(\d+\s*lt|lt|xle|le|se|sr5|limited|sport|touring|ex)\b/i)?.[1];
      const category = afterModel.match(vehicleCategories)?.[0];
      return canonicalVehicleLabel(`${brand} ${model}${trim ? ` ${trim}` : ''}${category ? ` ${category}` : ''}`);
    }
    const stopWords = new Set(['this', 'next', 'today', 'hoy', 'week', 'month', 'for', 'and', 'y', 'that', 'que']);
    const suffix = afterBrand.split(/\s+/).filter(Boolean).slice(0, 2).filter((token) => !stopWords.has(token.toLocaleLowerCase())).join(' ');
    return canonicalVehicleLabel(`${brand} ${suffix}`);
  }
  if (firstMatch.kind === 'model') {
    const model = firstMatch.match[0];
    const afterModel = source.slice((firstMatch.match.index || 0) + model.length);
    const trim = afterModel.match(/^\s+(?:(?:con|with)\s+(?:(?:el|la|the)\s+)?(?:(?:paquete|package)\s+)?)?(\d+\s*lt|lt|xle|le|se|sr5|limited|sport|touring|ex)\b/i)?.[1];
    return canonicalVehicleLabel(`${model}${trim ? ` ${trim}` : ''}`);
  }
  return canonicalVehicleCategory(firstMatch.match[0]);
};
const isVehicleStatement = (value) => {
  const candidate = clean(value);
  const label = vehicleLabel(candidate);
  if (!candidate || !label) return false;
  const withoutContext = candidate
    .replace(/\b(?:tengo|tiene|have|has|i have|my vehicle is|mi (?:carro|auto|veh[ií]culo) es|estoy buscando|ando buscando|looking for|busco|buscando|quiero|want|interested in|interesado en)\b/gi, ' ')
    .replace(/\b(?:a|an|un|una|my|mi|the|carro|auto|car|vehicle|veh[ií]culo)\b/gi, ' ')
    .replace(/[!?.,:;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return vehicleContext.test(candidate) || withoutContext.toLocaleLowerCase() === label.toLocaleLowerCase();
};
const phoneLikeText = (value) => {
  const candidate = clean(value);
  const digits = candidate.replace(/\D/g, '');
  return /\b(?:mi|my)\s+(?:n[uú]mero|number|phone|tel[eé]fono|telephone|contact)\b/i.test(candidate)
    || digits.length >= 7;
};
const normalizeRealName = (value) => {
  const candidate = clean(value);
  if (!candidate || invalidRealNames.has(candidate.toLowerCase()) || phoneLikeText(candidate) || !/[a-záéíóúüñ]/i.test(candidate) || /^[\W_\d]+$/u.test(candidate) || qualificationResponseMarkers.test(candidate) || isVehicleStatement(candidate)) return '';
  if (candidate.length > 100 || candidate.split(/\s+/).length > 8) return '';
  return formatPersonalName(candidate);
};
const isMessengerChannel = (value) => /(?:^|[^a-z])(?:messenger|facebook)(?:$|[^a-z])/i.test(clean(value));
const isWhatsAppChannel = (value) => /(?:^|[^a-z])whats?app(?:$|[^a-z])/i.test(clean(value));
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
    const isTitleCasedToken = candidate[0] === candidate[0].toLocaleUpperCase() || candidate === candidate.toLocaleUpperCase();
    const isOneWordName = /^[a-záéíóúüñ][a-záéíóúüñ'-]{1,39}$/i.test(candidate)
      && isTitleCasedToken
      && !singleWordNameBlocklist.test(candidate);
    const isFullName = /^[a-záéíóúüñ][a-záéíóúüñ'-]*(?:\s+[a-záéíóúüñ][a-záéíóúüñ'-]*){1,3}$/i.test(candidate);
    if (!isOneWordName && !isFullName) continue;
    if (/\b(?:quiero|busco|necesito|tengo|carro|auto|veh[ií]culo|suv|sedan|truck|troca|camioneta|pickup|van|financiar|finance|down|payment|hoy|today|yes|no)\b/i.test(candidate)) continue;
    const name = normalizeRealName(candidate);
    if (name) return name;
  }
  return '';
};
const suppliedName = normalizeRealName(inputData.real_name);
const contactName = normalizeRealName(first(inputData.contact_name, inputData.contactName, inputData.name));
const extractedNames = [
  memoryValue(['real_name', 'real name', 'customer_name', 'customer name', 'contact_name', 'contact name', 'full_name', 'full name', 'name', 'nombre_real', 'nombre real', 'nombre completo', 'nombre']),
  nameFromText(rawMessage),
  nameFromText(rawHistory),
];
const realName = isMessengerChannel(inputData.channel)
  ? (contactName || suppliedName)
  : isWhatsAppChannel(inputData.channel)
    ? extractedNames.map(normalizeRealName).find(Boolean) || ''
    : ((isBusinessName(suppliedName) || isProfileDisplayName(suppliedName)) ? [...extractedNames, suppliedName] : [suppliedName, ...extractedNames]).map(normalizeRealName).find(Boolean) || '';
const isCampaignButton = (value) => /^(?:quiero mi auto con eastern|quiero (?:un )?auto hoy|i want (?:a )?car today|quiero financiar un auto(?: con ustedes)?|me gustaria financiar un auto(?: con ustedes)?|financiar un auto(?: con ustedes)?|(?:quiero )?financiar con easterns?)$/.test(normalizeMatch(String(value ?? '').replace(/([!?])\s*\d{1,3}$/, '$1').replace(/[!?.,]/g, '')));
const isNonVehicleIntent = (value) => nonVehicleIntentValues.test(clean(value).replace(/[!?.,]/g, '').trim());
const stripCampaignButtonPhrases = (value) => String(value ?? '')
  .replace(/\bquiero mi auto con eastern\b/gi, ' ')
  .replace(/\bquiero (?:un )?auto hoy\b/gi, ' ')
  .replace(/\bi want (?:a )?car today\b/gi, ' ')
  .replace(/\bquiero financiar un auto(?: con ustedes)?\b/gi, ' ')
  .replace(/\bme gustar[ií]a financiar un auto(?: con ustedes)?\b/gi, ' ')
  .replace(/\b(?:quiero )?financiar con easterns?\b/gi, ' ');
const campaign = isCampaignButton(message);
const amount = (value) => {
  const source = clean(value).toLowerCase();
  if (!source || emptyMarker(source)) return '';
  if (noDownPaymentResponse.test(source)) return 'No down payment';
  const tradeMarker = tradeInLanguage;
  if (tradeMarker.test(source)) {
    const cash = source.match(/\$?\s*(\d[\d,.]*\s*k?)\b/i)?.[1];
    const base = cash ? amount(cash) : '';
    return base ? `${base} + trade-in` : 'trade-in';
  }
  const compound = source.match(/^(.+?)\s*\+\s*trade[- ]?in\d*$/i);
  if (compound) { const base = amount(compound[1]); return base ? `${base} + trade-in` : ''; }
  if (source.replace(/\D/g, '').length >= 10) return '';
  if (/\b(?:cash|contado|efectivo|paid in full|paga(?:r)? de contado)\b/i.test(source)) return cashDownPayment;
  const compact = source.replace(/[$,]/g, '').trim();
  const k = compact.match(/^(\d+(?:\.\d+)?)\s*k$/i);
  if (k) return String(Math.round(Number(k[1]) * 1000));
  const numeric = compact.match(/^(\d+(?:\.\d+)?)(?:\s*(?:dollars?|d[oó]lar(?:es|e)?|usd))?$/i);
  if (numeric) return String(Math.round(Number(numeric[1])));
  const thousand = source.match(/\b(\d{1,2})\s*(?:mil|thousand)\b/i);
  if (thousand) return String(Number(thousand[1]) * 1000);
  const words = {
    mil: 1000, 'un mil': 1000, 'one thousand': 1000, 'a thousand': 1000,
    'mil quinientos': 1500, 'one thousand five hundred': 1500,
    'dos mil': 2000, 'two thousand': 2000, 'dos mil quinientos': 2500,
    'two thousand five hundred': 2500, 'tres mil': 3000, 'three thousand': 3000,
    'tres mil quinientos': 3500, 'three thousand five hundred': 3500,
    'cuatro mil': 4000, 'four thousand': 4000, 'cinco mil': 5000,
    'five thousand': 5000, 'seis mil': 6000, 'six thousand': 6000,
    'siete mil': 7000, 'seven thousand': 7000, 'ocho mil': 8000,
    'eight thousand': 8000, 'nueve mil': 9000, 'nine thousand': 9000,
    'diez mil': 10000, 'ten thousand': 10000,
  };
  for (const [phrase, value] of Object.entries(words).sort((left, right) => right[0].length - left[0].length)) {
    if (source.includes(phrase)) return String(value);
  }
  return '';
};
const validAmount = (value) => amount(value);
const amountToken = '(?:\\d{1,3}(?:,\\d{3})+|\\d{1,2}\\s*(?:mil|thousand)|mil(?:\\s+quinientos)?|(?:un|one|a|dos|two|tres|three|cuatro|four|cinco|five|seis|six|siete|seven|ocho|eight|nueve|nine|diez|ten)\\s+(?:mil|thousand)(?:\\s+(?:quinientos|five hundred))?|\\d+(?:[,.]\\d+)?\\s*k?)(?:\\s*d[oó]lar(?:es|e)?)?';
const tradeIn = (text) => {
  const source = clean(text);
  if (!source || campaign || isNonVehicleIntent(source)) return '';
  const token = amountToken;
  const trade = '(?:trade[- ]?in|my car|my vehicle|my van|my truck|mi carro|mi auto|mi vehículo|mi van|mi troca|mi camioneta|carro como enganche|(?:entregar|entrego|entregue|dar|doy)\\s+(?:(?:mi|el|de)\\s+)?(?:vehículo|carro|auto|van|troca|camioneta|camion))';
  const match = source.match(new RegExp(`\\$?\\s*(${token})\\s*(?:down|payment|enganche|inicial)?\\s*(?:\\+|and|y)\\s*${trade}`, 'i')) || source.match(new RegExp(`${trade}\\s*(?:(?:and|plus|with|y|mas|más|con)\\s*(?:put|poner|pay|pagar|give|dar)?\\s*|[^0-9;.!?]{0,16}(?:down|payment|enganche|inicial|deposit|dep[oó]sito)[^0-9;.!?]{0,8})\\$?\\s*(${token})`, 'i'));
  const value = validAmount(match?.[1]);
  return value ? `${value} + trade-in` : tradeInLanguage.test(source) ? 'trade-in' : '';
};
const downFrom = (text) => {
  const source = String(text ?? '').replace(/\r\n?/g, '\n').trim();
  if (!source || campaign) return '';
  if (noDownPaymentResponse.test(source)) return 'No down payment';
  if (/\b(?:cash|contado|efectivo|paid\s+in\s+full|paga(?:r)?\s+de\s+contado)\b/i.test(source)) return cashDownPayment;
  const token = `(${amountToken})`;
  const explicit = source.match(new RegExp(`(?:down|enganche|inicial|deposit|dep[oó]sito)[ \\t]*(?:payment|pago)?[ \\t]*(?:is|es|de|:)?[ \\t]*\\$?[ \\t]*${token}`, 'i'));
  const withAmount = source.match(new RegExp(`\\b(?:puedo|puede|can|could|i can|i could)[ \\t]+(?:con|with)[ \\t]*\\$?[ \\t]*${token}\\b`, 'i'));
  const declared = source.match(new RegExp(`\\b(?:i have|tengo|i can put|puedo poner)[ \\t]+\\$?[ \\t]*${token}[ \\t]*(?:down|payment|enganche|inicial)?\\b`, 'i'));
  const noisyDeclared = source.match(new RegExp(`\\b(?:cuento|cuenta)\\b[^\\n]{0,80}?(?:y|and|plus)[ \\t.,;:]*\\$?[ \\t]*${token}\\b`, 'i'));
  const safeSource = source.split('\\n').filter((line) => !isPhoneOnlyLine(line)).join('\\n');
  const standalone = safeSource.match(new RegExp(`(?:^|\\n)\\$?[ \\t]*${token}[ \\t]*\\$?[ \\t]*(?:tengo|have|available|disponible|i have|i can put)?[ \\t]*\\d{0,2}[ \\t]*\\.?[ \\t]*(?=\\n|$)`, 'im'));
  const candidate = standalone?.[1]?.replace(/[$,\s]/g, '') || '';
  if (!explicit && /^20(?:1\d|2\d)$/.test(candidate)) return '';
  return validAmount(explicit?.[1] || withAmount?.[1] || declared?.[1] || noisyDeclared?.[1] || standalone?.[1]);
};
const affirmativeDownConfirmation = (value) => {
  const source = normalizeMatch(value).replace(/[.,!?¡¿-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!source || source.length > 120 || /\b(?:phone|number|n[uú]mero|tel[eé]fono|document|documentos?|identificaci[oó]n|license|licencia|income|ingresos?|proof|prueba|bank|banco|cuenta|vehicle|veh[ií]culo|carro|auto|suv|sedan|truck|troca|van|hoy|today|semana|week|mes|month|ubicad|located|location)\b/i.test(source)) return false;
  if (/^(?:yes|yeah|yep|correct|that's right|thats right|si|claro|correcto|okay|ok|bien|esta bien|seria bien|me parece bien|that works|works for me)(?:\s+(?:yes|yeah|yep|si|claro|correcto|okay|ok))*?(?:\s+(?:eso|that|works|for me))?$/i.test(source)
    || /^(?:(?:si|claro|correcto|ok(?:ay)?|bien)[,\s]+)?(?:con\s+(?:ese|este)\s+(?:monto|enganche|down)|con\s+(?:esa|esta)\s+cantidad|(?:ese|este)\s+(?:monto|enganche|down)|(?:esa|esta)\s+cantidad|con\s+eso|with\s+that\s+(?:amount|down)|that\s+(?:amount|down))(?:\s+(?:si|s[ií]\s+lo\s+tengo|s[ií]\s+puedo|esta\s+bien|est[aá]\s+bien|works?|is\s+(?:fine|okay|perfect)))?$/i.test(source)) return true;
  return /^(?:yes|yeah|yep|si|claro|correcto|okay|ok|bien|esta bien|seria bien|me parece bien)(?=\s|$)(?:\s+(?:yes|yeah|yep|si|claro|correcto|okay|ok))*\s*(?:puedo|podria|can|could|i can|i could)\b(?:.*\b(?:subir(?:le|lo)?|raise|increase|more|mas|conseguir|get|bring|put)\b.*|\s*)$/i.test(source);
};
const lastMeaningfulLine = (value) => String(value ?? '').replace(/\r\n?/g, '\n').split(/\n+/).map(clean).filter(Boolean).at(-1) || '';
const questionedDownPayment = (value) => {
  const lastQuestion = String(value ?? '').replace(/\r\n?/g, '\n').match(/[^?\n]*\?/g)?.at(-1) || '';
  if (!lastQuestion || !/(?:down|payment|enganche|inicial|deposit|dep[oó]sito|m[ií]nimo|minimum|required|conseguir|bring|subir|raise|increase|m[aá]s|more)/i.test(lastQuestion)) return '';
  const amount = lastQuestion.match(new RegExp(`(?:down|payment|enganche|inicial|deposit|dep[oó]sito|m[ií]nimo|minimum|required)[^?\\n]{0,80}?\\$?[ \\t]*(${amountToken})`, 'i'))?.[1]
    || lastQuestion.match(new RegExp(`\\$?[ \\t]*(${amountToken})[^?\\n]{0,80}?(?:down|payment|enganche|inicial|deposit|dep[oó]sito|m[ií]nimo|minimum|required)`, 'i'))?.[1]
    || lastQuestion.match(new RegExp(`\\$?[ \\t]*(${amountToken})`, 'i'))?.[1];
  return validAmount(amount);
};
const predictorAskedMinimumQuestion = (value) => {
  const source = clean(value);
  return Boolean(source)
    && /\$?\s*\d[\d,.]*/.test(source)
    && /\b(?:m[ií]nimo|minimum|required)\b/i.test(source)
    && /\b(?:podr[ií]as?|could|can|conseguir|bring|subir(?:le|lo)?|raise|increase|m[aá]s|more|cuent(?:as|a|o|en)|contar(?:[íi]as)?|how\s+much|amount)\b/i.test(source);
};
const vehicleFrom = (text) => {
  const source = String(text ?? '').replace(/\r\n?/g, '\n').trim();
  if (!source || campaign) return '';
  const candidates = [];
  const lines = source.split(/\n+/).map(clean).filter(Boolean);
  for (const [lineIndex, line] of lines.entries()) {
    const candidate = stripCampaignButtonPhrases(line);
    if (!candidate || isCampaignButton(candidate) || isNonVehicleIntent(candidate)) continue;
    if (tradeInLanguage.test(candidate)
      && /\b(?:tengo|tiene|have|has|my|mi)\b/i.test(candidate)
      && !/\b(?:looking for|busco|quiero|want|interested in|interesado en)\b/i.test(candidate)) continue;
    const candidateForVehicle = /\b(?:looking for|busco|quiero|want|interested in|interesado en)\b/i.test(candidate)
      ? candidate
      : candidate.split(/[;,]/, 1)[0];
    const cleaned = candidateForVehicle
      .replace(/(?:\+?1[\s().-]*)?(?:\(?[2-9]\d{2}\)?[\s.-]*)\d{3}[\s.-]?\d{4}/g, ' ')
      .replace(/(?:down|enganche|inicial|deposit|dep[oó]sito)\s*(?:payment|pago)?\s*(?:is|es|de|:)?\s*\$?[\d,.]+\s*k?/gi, '')
      .replace(/\b(?:today|hoy|asap|immediately|this week|esta semana|this month|este mes|next week|pr[oó]xima? semana|next month|pr[oó]ximo mes)\b/gi, '')
      // Keep comma-separated natural language such as "Soy Ana, busco un Civic".
      // Semicolon remains the transcript separator used to stop at the next field.
      .split(/;/, 1)[0]
      .trim();
    const requested = cleaned.match(/(?:looking for|busco|quiero|want|interested in|interesado en)\s+(?:a|an|un|una)?\s*([^.!?]+)/i)?.[1];
    if (requested && !isNonVehicleIntent(requested)) {
      const requestedLabel = vehicleLabel(requested);
      if (requestedLabel) candidates.push({ label: requestedLabel, score: 100 + (vehicleModels.test(requested) ? 25 : 0) + lineIndex / 1000, lineIndex, hasModel: vehicleModels.test(requested), brand: requested.match(vehicleBrands)?.[0] || '' });
    }
    const category = cleaned.match(/\b(?:suv|sedan|truck|troca|trokita|troquita|troque|trokas|pickup|pick-up|van|minivan|crossover|coupe|coupé|hatchback|motorcycle|moto|camioneta|camion|camión)\b/i);
    const hasModel = vehicleModels.test(cleaned);
    const brand = cleaned.match(vehicleBrands)?.[0] || '';
    const label = vehicleLabel(cleaned);
    const followsVehicleQuestion = lineIndex > 0 && /\b(?:what|which)\s+(?:vehicles?|cars?|trucks?)|\b(?:qu[eé]|cu[aá]l)\s+(?:veh[ií]culos?|carros?|autos?)\b/i.test(lines[lineIndex - 1]);
    if (label && (category || vehicleContext.test(candidate) || followsVehicleQuestion || vehicleBrands.test(candidate) || hasModel || vehicleCategories.test(candidate))) {
      const lowQualityNarrative = /\b(?:seg[uú]n|anuncio|anuncios|variedad|maneja|manejan|opciones|informaci[oó]n)\b/i.test(candidate);
      const score = (hasModel ? 80 : category ? 25 : brand ? 15 : 0)
        + (vehicleContext.test(candidate) ? 10 : 0)
        + (followsVehicleQuestion ? 10 : 0)
        - (lowQualityNarrative && !hasModel ? 30 : 0)
        + lineIndex / 1000;
      candidates.push({ label, score, lineIndex, hasModel, brand });
    }
  }
  candidates.sort((left, right) => right.score - left.score || right.lineIndex - left.lineIndex);
  const best = candidates[0];
  if (!best) return '';
  const brands = [...new Set(candidates.map((candidate) => candidate.brand).filter(Boolean).map((brand) => brand.toLocaleLowerCase()))];
  if (!vehicleBrands.test(best.label) && brands.length === 1 && (best.hasModel || vehicleCategories.test(best.label))) {
    const brand = candidates.find((candidate) => candidate.brand && candidate.brand.toLocaleLowerCase() === brands[0])?.brand || brands[0];
    return clean(`${brand} ${best.label}`).replace(/\b([a-z]+)\b/gi, (token) => token[0].toLocaleUpperCase() + token.slice(1).toLocaleLowerCase()).replace(/\b(\d)\s*lt\b/gi, '$1LT');
  }
  return canonicalVehicleLabel(clean(best.label).replace(/\b(\d)\s*lt\b/gi, '$1LT'));
};
const cleanVehicleValue = (value) => {
  if (isCampaignButton(value) || isNonVehicleIntent(value)) return '';
  const candidate = clean(value).replace(/(?:19|20)\d{2}(?:\d{2})*$/i, '').trim();
  if (!candidate) return '';
  // Do not allow arbitrary Custom Code/memory text to become vehicle_type.
  // Keep exact categories and recognized make/model labels only.
  const label = vehicleLabel(candidate);
  const categoryOnly = /^(?:suv|sedan|truck|troca|pickup|pick-up|van|minivan|crossover|coupe|coupé|hatchback|motorcycle|moto|camioneta|camion|camión|carro|auto|coche)$/i.test(candidate);
  return label || categoryOnly ? (label || candidate.replace(/^troca$/i, 'truck').replace(/^camion(?:eta)?$/i, 'truck').replace(/^camión(?:eta)?$/i, 'truck')) : '';
};
const timelineFrom = (text) => {
  const hit = clean(text).match(/\b(?:today|hoy|now if possible|if possible now|ahora si se puede|si es posible ahora|asap|as soon as possible|immediately|inmediato|para ya|ahora mismo|de inmediato|lo antes posible|this week|esta semana|this month|este mes|next week|pr[oó]xima? semana|next month|pr[oó]ximo mes|within \d+ days?|en \d+ d[ií]as?)\b/i)?.[0] || '';
  if (/today|hoy|now if possible|if possible now|ahora si se puede|si es posible ahora|asap|immediately|inmediato|para ya|ahora mismo|de inmediato|lo antes/i.test(hit)) return 'today';
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
const conversationalEvidence = (...values) => values
  .flatMap((value) => String(value ?? '').replace(/\r\n?/g, '\n').split(/\n+/))
  .map((line) => line.trim())
  .filter(Boolean)
  .filter((line) => !line.includes('?') && !/^\s*(?:do you|does|did|what|which|when|where|how|can you|are you|tienes|tiene|cu[aá]l|qu[eé]|cu[aá]ndo|d[oó]nde|c[oó]mo)\b/i.test(line))
  .join('; ');
const documentFieldStatus = (value, pattern) => {
  const source = clean(value);
  if (!source) return '';
  const labeled = source.match(new RegExp(`(?:^|[;,])\\s*(?:${pattern})\\s*[:=]\\s*([^;,]+)`, 'i'))?.[1] || '';
  const labeledStatus = labeled ? yesNo(labeled) : '';
  if (labeledStatus) return labeledStatus;
  const segment = source.split(/[;,]/).find((part) => new RegExp(pattern, 'i').test(part)) || '';
  if (!segment) return '';
  return yesNo(segment) || 'yes';
};
const documentStatus = (pattern, memoryAliases, custom) => {
  const fieldStatus = emptyMarker(custom) ? '' : documentFieldStatus(custom, pattern);
  if (fieldStatus) return fieldStatus;
  const customStatus = emptyMarker(custom) ? '' : yesNo(custom);
  if (customStatus) return customStatus;
  if (new RegExp(pattern, 'i').test(clean(custom)) && !/\b(?:no|n[oó]|sin|not|dont|don't|no tengo|do not have|not available)\b/i.test(clean(custom))) return 'yes';
  const conversational = conversationalEvidence(rawMessage, rawHistory);
  const positive = 'yes|sí|si|yeah|yep|correct|tengo|have it|i do|i have|available';
  const negative = "no|n[oó]|sin|not|dont|don't|no tengo|i do not|do not have|not available";
  const conversationalContext = conversational.match(new RegExp(`(?:${positive}|${negative})[^!?]{0,160}(?:${pattern})|(?:${pattern})[^!?]{0,160}(?:${positive}|${negative})`, 'i'))?.[0] || '';
  const conversationalStatus = yesNo(conversationalContext);
  if (conversationalStatus) return conversationalStatus;
  if (new RegExp(pattern, 'i').test(conversational) && !new RegExp(`\\b(?:${negative})\\b`, 'i').test(conversational)) return 'yes';
  const memory = [memoryValue(memoryAliases), memoryValue(['documents', 'docs', 'documentos'])].filter(Boolean);
  for (const value of memory) {
    if (new RegExp(pattern, 'i').test(value)) return yesNo(value) || 'yes';
  }
  return '';
};
const vehicleSource = [rawHistory, rawMessage].filter(Boolean).join('\n');
const phoneFromConversation = phoneFrom(message, history);
// Keep the WhatsApp/Messenger shorthand "carro económico" as the stable
// Sedan category.
const extractedVehicle = economicSedanIntent.test(vehicleSource)
  ? 'Sedan'
  : first(
    campaign ? '' : cleanVehicleValue(vehicleFrom(vehicleSource)),
    cleanVehicleValue(memoryValue(['vehicle', 'vehicle_type'])),
    cleanVehicleValue(inputData.vehicle_type),
  );
const existingAdvisorMarker = [memoryValue(['vehicle', 'vehicle_type']), inputData.vehicle_type].some(isAdvisorHandoffVehicle);
const phone = phoneFrom(message, history, inputData.phone);
const vehicle = extractedVehicle || (existingAdvisorMarker || phoneFromConversation || (isWhatsAppChannel(inputData.channel) && phone)
  ? advisorHandoffVehicle
  : '');
// Prefer a phone found in the conversation before accepting custom/memory down values.
// This prevents a stale area-code-only value (e.g. 443) from becoming a down payment.
const memoryDown = memoryValue(['down payment', 'down_payment', 'downpayment']);
const inputDown = clean(inputData.down_payment);
const latestInboundMessage = lastMeaningfulLine(rawMessage);
const previousFinancingQuestion = /(?:has\s+financiado|han?\s+financiado|have\s+you\s+financed|did\s+you\s+finance|financ(?:ed|ing)\s+before|financiamiento\s+(?:de autos?|de un veh[ií]culo)|(?:ya|antes|anteriormente|previously|before)[^?\n]{0,80}(?:financ(?:e|ed|ing)|financiad[oa]))/i;
const previousFinancingYes = /(?:ya\s+he\s+financiado|he\s+financiado\s+antes|financi(?:é|e)\s+antes|(?:ya|anteriormente)\s+financi(?:é|e)(?=\s|$|[,.;!?])|i\s+have\s+financed\s+before|i\s+financed\s+(?:a|an|the)\s+(?:vehicle|car)|financed\s+before|previous(?:ly)?\s+financ(?:ed|ing))/i;
const previousFinancingNo = /^(?:no(?=[\s,.;!?]|$)|nope|nah|nunca|jamas|never|not\s+before|no\s+(?:he\s+)?financiado|no\s+tengo\s+(?:historial|experiencia|financiamiento))/i;
const previousFinancingAffirmative = /^(?:yes|yeah|yep|si|sí|claro|correcto|tengo|have it|i do|i have|i can|i could|could|can|puedo|podr[ií]a|es posible|possible|con (?:este|ese) monto|(?:este|ese) monto|con (?:esta|esa) cantidad|(?:esta|esa) cantidad)(?=[\s,.;!?]|$)/i;
const predictorQuestion = clean(inputData.previous_predicted_bot_question ?? '');
const historyQuestions = rawHistory.match(/[^?\n]*\?/g) || [];
const latestTranscriptQuestion = clean(historyQuestions.at(-1) || '');
const financingQuestionAsked = previousFinancingQuestion.test(predictorQuestion || latestTranscriptQuestion);
const previousFinancing = financingQuestionAsked && previousFinancingNo.test(latestInboundMessage)
  ? 'no'
  : financingQuestionAsked && previousFinancingAffirmative.test(latestInboundMessage)
    ? 'yes'
    : previousFinancingYes.test(conversationalEvidence(predictorQuestion && !financingQuestionAsked ? rawHistory.split(/\r?\n/).slice(0, -1).join('\n') : rawMessage, rawMemory))
      ? 'yes'
      : previousFinancingNo.test(conversationalEvidence(predictorQuestion && !financingQuestionAsked ? rawHistory.split(/\r?\n/).slice(0, -1).join('\n') : rawMessage, rawMemory))
        ? 'no'
        : first(memoryValue(['previous_financing', 'previous financing', 'financing history', 'historial de financiamiento']), '');
const confirmedQuestionDown = affirmativeDownConfirmation(latestInboundMessage)
  ? (questionedDownPayment(rawHistory) || questionedDownPayment(inputData.previous_predicted_bot_question || ''))
  : '';
const predictorAskedMinimum = predictorAskedMinimumQuestion(first(inputData.previous_predicted_bot_question, confirmedQuestionDown ? rawHistory : ''));
const cashDown = campaign ? '' : first(
  downFrom(rawMessage),
  downFrom(rawHistory),
  confirmedQuestionDown,
  isPhoneAreaCodeAmount(memoryDown, phone) ? '' : memoryDown,
  isPhoneAreaCodeAmount(inputDown, phone) ? '' : validAmount(inputDown),
);
const tradeDown = campaign ? '' : first(tradeIn(message), tradeIn(history), tradeIn(memoryText(rawMemory)));
const downCandidate = cashDown || tradeDown;
const conversationalDownSource = `${message}; ${history}`;
let down = validAmount(cashDown && /trade[- ]?in|my car|my vehicle|mi carro|mi auto|carro como enganche|(?:cambiar|cambio)\\s+(?:(?:mi|el|de)\\s+)?(?:veh[ií]culo|carro|auto)|change\\s+(?:my\\s+)?(?:vehicle|car)/i.test(conversationalDownSource) && !/trade[- ]?in/i.test(cashDown)
  ? `${cashDown} + trade-in`
  : downCandidate);
const source = clean(inputData.source).toLocaleLowerCase();
const sourceAware = Boolean(source);
const offlease = ['stafford', 'fredericksburg', 'fredericksburg-2'].includes(source);
const stafford = source === 'stafford';
const requiresLocation = ['easterns', 'easterns-millersville'].includes(source);
const phoneSatisfiedByNative = stafford && isWhatsAppChannel(inputData.channel);
const customerLocation = first(inputData.customer_location, message.match(/\b(?:Baltimore|Laurel|Sterling|Millersville|Frederick|Fredericksburg|Woodbridge|Alexandria|Culpeper|Stafford)\b/i)?.[0] || '');
const vehicleCategory = /\b(?:truck|troca|trokita|troquita|troque|trokas|pickup|pick[- ]?up|camioneta|camion|camión|tacoma|tundra|f[- ]?150|f[- ]?250|f[- ]?350|maverick|ranger|silverado|sierra|colorado|frontier|titan|ridgeline|gladiator|ram)\b/i.test(vehicle)
  ? 'truck'
  : /\b(?:suv|van|minivan|crossover|highlander|rav\s*4|4\s*runner|sienna|grand caravan|caravan|pacifica|odyssey|transit|promaster|pilot|passport|cr[- ]?v|hr[- ]?v|tahoe|suburban|traverse|equinox|blazer|yukon|acadia|terrain|wrangler|cherokee|compass|renegade|durango|explorer|expedition|escape|edge|armada|rogue|pathfinder|sportage|telluride|sorento|palisade|santa fe|tucson|forester|outback|ascent|atlas|tiguan|cayenne|range rover|defender)\b/i.test(vehicle)
    ? 'suv_or_van'
    : /\b(?:camaro|challenger|charger|mercedes(?:[- ]?benz)?|bmw|audi|lexus|acura|infiniti|genesis|cadillac|lincoln|volvo|tesla|porsche|jaguar)\b/i.test(vehicle)
      ? 'luxury_sedan'
      : /\b(?:sedan|civic|corolla|camry|accord|altima|sentra|versa|maxima|malibu|jetta|passat|sonata|elantra|optima|forte|rio|impala|avalon|prius|mustang|coupe|hatchback)\b/i.test(vehicle)
        ? 'sedan'
        : '';
const requiredDownPayment = ({ sedan: 1500, luxury_sedan: 2000, suv_or_van: 2000, truck: 3000 }[vehicleCategory] || null);
const downPaymentAmountBeforeAcceptance = /^\d+(?:\.\d+)?$/.test(String(down).replace(/[$,\s]/g, '')) ? Number(String(down).replace(/[$,\s]/g, '')) : null;
const tradeInDownPayment = /\btrade[\s-]?in\b|\b(?:my|mi)\s+(?:car|vehicle|van|truck|carro|auto|veh[ií]culo|troca|camioneta|camion)\b|\bcarro\s+como\s+enganche\b|\b(?:cambiar|cambio)\s+(?:(?:mi|el|de)\s+)?(?:veh[ií]culo|carro|auto|van|troca|camioneta|camion)\b|\bchange\s+(?:my\s+)?(?:vehicle|car|van|truck)\b|\b(?:entregar|entrego|entregue|dar|doy)\s+(?:(?:mi|el|de)\s+)?(?:veh[ií]culo|carro|auto|van|troca|camioneta|camion)\b/i.test(down);
const confirmsMinimumShortfall = offlease && requiredDownPayment !== null && Boolean(cashDown) && downPaymentAmountBeforeAcceptance !== null && downPaymentAmountBeforeAcceptance < requiredDownPayment && predictorAskedMinimum && affirmativeDownConfirmation(latestInboundMessage);
if (confirmsMinimumShortfall) down = tradeInDownPayment ? `${requiredDownPayment} + trade-in` : String(requiredDownPayment);
const downPaymentAmount = /^\d+(?:\.\d+)?$/.test(String(down).replace(/[$,\s]/g, '')) ? Number(String(down).replace(/[$,\s]/g, '')) : null;
const downPaymentSufficient = requiredDownPayment !== null && (tradeInDownPayment || down === cashDownPayment || down.toLocaleLowerCase().includes(cashDownPayment.toLocaleLowerCase()) || (offlease && previousFinancing === 'yes' && downPaymentAmount === 1000) || (downPaymentAmount !== null && downPaymentAmount >= requiredDownPayment));
const rawTimeline = first(timelineFrom(message), timelineFrom(history), memoryValue(['timeline', 'purchase timeline', 'purchase_timeline']), inputData.purchase_timeline);
const identification = documentStatus('id\\b|identification\\b|identificación\\b|driver.?s license\\b|license\\b|licencia\\b|itin\\b|passport\\b|pasaporte\\b', ['identification', 'id', 'itin', 'passport', 'pasaporte'], inputData.identification || inputData.documents);
const income = documentStatus('proof of income|income proof|prueba de ingresos|comprobante de ingresos|estados? de cuenta|account statements?|bank statements?|financial statements?|pay stubs?|check stubs?|talones? de pago|colillas? de cheques?|recibos? de n[oó]mina|bank account|cuenta bancaria|cuenta de banco', ['income', 'proof of income', 'estados de cuenta', 'account statements', 'bank statements', 'check stubs', 'bank account', 'cuenta bancaria'], inputData.documents);
const bankContext = conversationalEvidence(rawMessage, rawHistory).match(/(?:bank account|cuenta bancaria)[^;]*(?:yes|sí|si|yeah|yep|correct|tengo|have it|i do|i have|available|no|not|sin|dont|don't|no tengo|i do not|do not have|not available)/i)?.[0] || '';
const bankAccount = first(yesNo(inputData.bank_account), yesNo(bankContext), yesNo(memoryValue(['bank account', 'bank_account', 'cuenta bancaria'])));
const documents = first(memoryValue(['documents', 'docs', 'documentos']), inputData.documents, [identification === 'yes' ? 'identification: yes' : '', income === 'yes' ? 'proof of income: yes' : ''].filter(Boolean).join(', '));
const customPresent = [inputData.vehicle_type, inputData.down_payment, inputData.purchase_timeline, inputData.documents, inputData.identification, inputData.bank_account].some((value) => clean(value) && !emptyMarker(value));
const qualificationSource = rawMemory && customPresent ? 'both' : rawMemory ? 'qualification_memory' : customPresent ? 'custom_fields' : 'none';
// The queue handoff requires a usable identity, phone, vehicle, down payment,
// and purchase timing. Document evidence remains visible but is non-blocking.
// Prefer a phone written in the inbound conversation, then a native GHL phone.
const languageText = `${message}; ${history}`;
const englishSignals = (languageText.match(/\b(?:i|i'm|im|my|want|wants|need|looking|have|yes|yeah|yep|what|when|where|how|this|next|today|week|month|do|does)\b/gi) || []).length;
const spanishSignals = (languageText.match(/\b(?:yo|mi|quiero|necesito|busco|tengo|sí|si|qué|cuando|donde|este|esta|hoy|semana|mes|tienes)\b/gi) || []).length;
const language = message || history ? (englishSignals > spanishSignals ? 'en' : 'es') : 'en';
const timeline = language === 'es'
  ? ({ today: 'hoy', 'this week': 'esta semana', 'this month': 'este mes', 'next week': 'próxima semana', 'next month': 'próximo mes', 'within 30 days': 'en 30 días', 'exploring options': 'explorando opciones' }[rawTimeline] || rawTimeline)
  : rawTimeline;
const hasRealVehicle = Boolean(vehicle) && !isAdvisorHandoffVehicle(vehicle);
const needsOffleaseMinimum = offlease && hasRealVehicle && Boolean(down) && !downPaymentSufficient;
const coreMissing = (sourceAware
  ? [stafford && !realName ? 'real_name' : '', !phone && !phoneSatisfiedByNative ? 'phone' : '', !hasRealVehicle ? 'vehicle_type' : '', !down ? 'down_payment' : '', needsOffleaseMinimum ? 'down_payment_minimum' : '', !timeline ? 'purchase_timeline' : '']
  : [!realName ? 'real_name' : '', !phone ? 'phone' : '', !hasRealVehicle ? 'vehicle_type' : '', !down ? 'down_payment' : '', !timeline ? 'purchase_timeline' : ''])
  .filter(Boolean);
const qualificationMissing = [
  ...coreMissing,
  requiresLocation && !customerLocation ? 'customer_location' : '',
  identification !== 'yes' ? 'identification' : '',
  income !== 'yes' ? 'proof_of_income' : '',
  bankAccount !== 'yes' ? 'bank_account' : '',
].filter(Boolean);
const parts = memoryText(rawMemory).split(';').map((part) => clean(part).replace(/^\d+(?=(?:vehicle|vehicle[_ ]?type|down|down[_ ]?payment|documents?|timeline)\b)/i, '')).filter((part) => Boolean(part) && !/^\$?\d[\d,.]*$/.test(part));
const canonical = [['real_name', realName], ['vehicle', vehicle], ['down payment', down], ['previous financing', previousFinancing], ['documents', documents], ['timeline', timeline]].filter(([, value]) => value).map(([key, value]) => `${key}: ${String(value).replace(/\s*;\s*/g, ', ')}`);
const qualificationMemory = [...new Set([...parts.filter((part) => !/^(?:real_name|real name|name|nombre|nombre real|nombre completo|vehicle|vehicle_type|down|down payment|down_payment|previous financing|previous_financing|financing history|historial de financiamiento|documents?|docs|timeline|purchase timeline|purchase_timeline)\s*(?::|=|-)/i.test(part)), ...canonical])].join('; ');
const qualificationStep = sourceAware
  ? (stafford && !realName
    ? 'real_name'
    : !hasRealVehicle
      ? 'vehicle_type'
      : requiresLocation && !customerLocation
        ? 'customer_location'
        : !phone && !phoneSatisfiedByNative
          ? 'phone'
          : !down || needsOffleaseMinimum
            ? 'down_payment'
            : !timeline
              ? 'purchase_timeline'
              : identification !== 'yes' || income !== 'yes'
                ? 'documents'
                : !bankAccount || bankAccount !== 'yes'
                  ? 'bank_account'
                  : 'complete')
  : (!realName
    ? 'real_name'
      : !hasRealVehicle
      ? 'vehicle_type'
      : !down
        ? 'down_payment'
        : !timeline
          ? 'purchase_timeline'
          : identification !== 'yes' || income !== 'yes'
            ? 'documents'
            : !bankAccount || bankAccount !== 'yes'
              ? 'bank_account'
              : 'complete');
const questions = {
  en: {
    real_name: 'What is your full name?', vehicle_type: 'What vehicle are you looking for?', customer_location: 'What city are you located in?', phone: "What's the best phone number to reach you?",
    down_payment: 'How much do you have for the down payment?', purchase_timeline: 'When are you planning to buy?',
    documents: 'Do you have identification and proof of income?', bank_account: 'Do you have a bank account?', complete: '',
  },
  es: {
    real_name: '¿Cuál es tu nombre completo?', vehicle_type: '¿Qué vehículo estás buscando?', customer_location: '¿En qué ciudad te encuentras?', phone: '¿Cuál es el mejor número para contactarte?',
    down_payment: '¿Cuánto tienes para el enganche?', purchase_timeline: '¿Cuándo planeas comprar?',
    documents: '¿Tienes identificación y comprobante de ingresos?', bank_account: '¿Tienes una cuenta bancaria?', complete: '',
  },
};
const minimumQuestion = requiredDownPayment
  ? (language === 'es' ? `Para este vehículo requerimos un enganche mínimo de $${requiredDownPayment}. ¿Con cuánto cuentas para el enganche?` : `This vehicle requires a minimum down payment of $${requiredDownPayment}. How much do you have available?`)
  : questions[language][qualificationStep];
const shortfallQuestion = language === 'es'
  ? `Te comento que el mínimo para este vehículo es de $${requiredDownPayment}. ¿Crees que podrías conseguir un poco más?`
  : `The minimum for this vehicle is $${requiredDownPayment}. Do you think you could bring a little more?`;
const financingHistoryQuestion = language === 'es'
  ? 'Para aplicar a la promoción de $1000 de enganche, ¿anteriormente ya has financiado algún vehículo?'
  : 'To apply for the $1000 down payment promotion, have you financed a vehicle before?';
const repeatPreviousMinimumQuestion = qualificationStep === 'down_payment'
  && offlease
  && predictorAskedMinimum
  && !downPaymentSufficient
  && Boolean(clean(inputData.previous_predicted_bot_question));
const predictedBotQuestion = qualificationStep === 'down_payment' && offlease && downPaymentAmount === 1000 && previousFinancing === '' && !predictorAskedMinimum
  ? financingHistoryQuestion
  : repeatPreviousMinimumQuestion
    ? clean(inputData.previous_predicted_bot_question)
  : qualificationStep === 'down_payment' && needsOffleaseMinimum
    ? shortfallQuestion
    : qualificationStep === 'down_payment' && offlease
      ? minimumQuestion
      : questions[language][qualificationStep];
const lastAnsweredField = qualificationStep === 'complete'
  ? 'bank_account'
  : (sourceAware
    ? [['real_name', stafford && Boolean(realName)], ['vehicle_type', hasRealVehicle], ['customer_location', Boolean(customerLocation)], ['phone', Boolean(phone) || phoneSatisfiedByNative], ['down_payment', Boolean(down) && !needsOffleaseMinimum], ['purchase_timeline', timeline], ['documents', identification === 'yes' && income === 'yes'], ['bank_account', bankAccount === 'yes']]
    : [['real_name', realName], ['phone', phone], ['vehicle_type', hasRealVehicle], ['down_payment', down], ['purchase_timeline', timeline], ['documents', identification === 'yes' && income === 'yes'], ['bank_account', bankAccount === 'yes']])
    .reverse().find(([, complete]) => Boolean(complete))?.[0] || null;
// Prefer a phone written in the conversation, but preserve a validated native
// GHL contact phone when the webhook delivers the conversation message
// separately (for example, message = "Ok"). Never scan
// qualification_memory/qualifier text: vehicle values such as
// "SUV20202020202020" must not become a lead phone.
const appendOnlyHistory = [history, message]
  .filter((value, index, values) => value && values.findIndex((item) => item.toLowerCase() === value.toLowerCase()) === index)
  .join('\n');
return {
  channel: String(inputData.channel ?? ''),
  real_name: realName,
  vehicle_type: vehicle,
  customer_location: customerLocation,
  vehicle_category: vehicleCategory || null,
  required_down_payment: requiredDownPayment,
  down_payment_amount: downPaymentAmount,
  down_payment_sufficient: downPaymentSufficient,
  down_payment: down,
  previous_financing: previousFinancing,
  purchase_timeline: timeline,
  documents,
  identification,
  bank_account: bankAccount,
  qualification_memory: qualificationMemory,
  // This write-back value is derived only from the inbound chat/transcript.
  // Never source the number from qualification fields or a stale contact value.
  phone,
  chat_history_log: appendOnlyHistory,
  dealeradmin_send_now: coreMissing.length === 0,
  has_identification: identification,
  has_income_proof: income,
  next_question: predictedBotQuestion,
  qualification_step: qualificationStep,
  qualification_progress: {
    step: qualificationStep,
    last_answered_field: lastAnsweredField,
    predicted_bot_question: predictedBotQuestion,
    language,
    confidence: qualificationStep === 'complete' ? 1 : 0.95,
    evidence: qualificationStep === 'complete' ? 'complete' : 'normalized_fields',
  },
  qualification_complete: coreMissing.length === 0 && (!requiresLocation || Boolean(customerLocation)),
  missing_qualification: qualificationMissing,
  qualification_source: qualificationSource,
};
