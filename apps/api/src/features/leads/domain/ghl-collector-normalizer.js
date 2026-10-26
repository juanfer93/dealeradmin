/*
 * Generated GHL Custom Code entrypoint.
 *
 * Source: domain/ghl-collector-normalizer/source/modules/*.js
 * Build:  node domain/ghl-collector-normalizer/build-entrypoint.mjs
 *
 * Do not edit this artifact by hand. GoHighLevel receives this standalone
 * body and provides inputData at runtime.
 */
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
  const repeatedExchange = source.match(/(?<!\d)([2-9]\d{2})[\s.-]+(\d{3})[\s.-]+\2[\s.-]+(\d{4})(?!\d)/);
  if (repeatedExchange) return `+1${repeatedExchange[1]}${repeatedExchange[2]}${repeatedExchange[3]}`;
  // A phone field may contain formatting, but a free-form message must not
  // be treated as a phone just because its prices/mileage add up to 10 digits.
  if (!/^\+?[\d\s().,-]+$/.test(source)) return '';
  const digits = source.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return '';
};
const phoneFrom = (...values) => {
  for (const value of values) {
    const direct = normalizePhone(value);
    if (direct) return direct;
    // Keep the same bounded parser as collector-normalizer.ts. This accepts
    // spoken/grouped numbers such as "704 699 07 61" without turning prices,
    // mileage, years, or IDs into phone evidence.
    const matches = String(value ?? '').match(/(?<!\d)(?:\+?1[\s().,-]*)?(?:\([2-9]\d{2}\)|[2-9]\d{2})(?:[\s().,-]*\d){7}(?!\d)/g) || [];
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
  const numericGroups = source.match(/\d+/g)?.length ?? 0;
  const isCanonicalPhoneLength = digits.length === 10 || (digits.length === 11 && digits.startsWith('1'));
  // GHL can prepend or duplicate a spoken area-code fragment, producing a
  // grouped phone line longer than 10/11 digits (for example
  // `301 455 455-4350`). Do not let the hyphen in that phone be interpreted
  // as a down-payment range. Comma-separated values remain eligible for
  // monetary ranges such as `10,000 - 12,000`.
  const isGroupedPhone = digits.length >= 10 && digits.length <= 15
    && numericGroups >= 3
    && !/,/.test(source);
  return (isCanonicalPhoneLength || isGroupedPhone)
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
const invalidRealNames = new Set(['.', '..', '...', 'unknown', 'n/a', 'na', 'lead', 'whatsapp', 'facebook', 'saludos', 'hello', 'hi', 'hey', 'hola', 'greetings', 'buenos dias', 'buenas tardes', 'buenas noches', 'bendiciones', 'buenos dias bendiciones', 'buenas tardes bendiciones', 'buenas noches bendiciones', 'thu chikitha linda']);
const qualificationResponseMarkers = /\b(?:today|hoy|asap|as soon as possible|immediately|inmediato|para ya|ahora mismo|now if possible|if possible now|ahora si se puede|si es posible ahora|lo m[aá]s pronto posible|lo antes posible|lo antes que pueda|this week|esta semana|this month|este mes|next week|pr[oó]xima? semana|next month|pr[oó]ximo mes|baltimore|maryland|where are you located|where are you|d[oó]nde est[aá]n ubicad[oa]s?|d[oó]nde est[aá]n|ubicaci[oó]n|ubicados?|vehicle|car|auto|carro|coche|veh[ií]culo|suv|sedan|midsize|mid[- ]?size|medium[- ]?size|mediano|mediana|truck|troca|pickup|pick-up|van|minivan|crossover|coupe|coupé|hatchback|motorcycle|moto|requirements?|requisitos?|yes|yeah|yep|correct|tengo|tiene|have it|i have|i'm looking|im looking|looking for|busco|buscando|quiero|want|interested|si|sí|no|no tengo|papeles?|cheques?|checks?|aplicar|apply|perfecto|perfect|claro|bien|bueno)\b/i;
const genericVehicleIntent = /\b(?:need|needs|looking\s+for|want|wants|seeking|shopping\s+for|trying\s+to\s+find|necesito|busco|buscando|quiero|me\s+interesa)\b[\s\S]*\b(?:vehicle|car|auto|carro|coche|veh[ií]culo|truck|suv|sedan|van|camioneta|pickup|pick-up)\b/i;
const inventoryIntent = /\b(?:inventory|inventario|see\s+(?:the\s+)?inventory|can\s+i\s+see|show\s+me|mu[eé]strame|ver\s+(?:el\s+)?inventario)\b/i;
const greetingOnly = /^(?:buenos\s+d[ií]as|buenas\s+tardes|buenas\s+noches|saludos|hello|hi|hey|hola|ola|greetings)(?:[,.!?\s]+bendiciones)?[,.!?\s]*$/i;
const singleWordNameBlocklist = /^(?:ok(?:ay)?|si|s[ií]|yes|no|yeah|yep|correct|cash|today|hoy|now|ahora|asap|inmediato|requirements?|requisitos?|information|informaci[oó]n|details?|detalles?|baltimore|maryland|virginia|laurel|rosedale|sterling|elkton|manda|nada|bale|vale|ubicaci[oó]n|ubicasion|tacoma|toyota|hummer|honda|ford|nissan|chevrolet|chevy|hyundai|kia|mazda|subaru|volkswagen|vw|jeep|ram|gmc|bmw|mercedes|audi|lexus|acura|volvo|tesla|dodge|chrysler|buick|cadillac|lincoln|infiniti|genesis|mini|porsche|jaguar|rivian|lucid|mitsubishi|pontiac|saturn|oldsmobile|fiat|suzuki|isuzu|scion|mustang|rav4|civic|accord|camry|corolla|highlander|sienna|4runner|tundra|sequoia|prius|avalon|maverick|ranger|bronco|explorer|expedition|escape|edge|pilot|passport|ridgeline|odyssey|sierra|silverado|tahoe|suburban|traverse|equinox|camaro|malibu|blazer|colorado|yukon|acadia|terrain|wrangler|gladiator|cherokee|compass|renegade|charger|challenger|durango|journey|caravan|pacifica|frontier|titan|rogue|pathfinder|altima|sentra|versa|maxima|armada|sportage|telluride|sorento|soul|rio|palisade|santa fe|tucson|elantra|sonata|veloster|wrx|forester|outback|ascent|impreza|atlas|tiguan|jetta|passat|cayenne|range rover|defender|suv|sedan|midsize|mid[- ]?size|medium[- ]?size|mediano|mediana|truck|troca|pickup|pick-up|van|minivan|crossover|coupe|coupé|hatchback|motorcycle|moto|camioneta|financiar|finance|financing|down|payment|enganche|documents?|documentos?|identificaci[oó]n|income|ingresos|proof|prueba|phone|tel[eé]fono|number|n[uú]mero)$/i;
const vehicleBrands = /\b(?:toyotas?|hummer|honda|ford|nissan|chevrolet|chevy|hyundai|kia|mazda|subarus?|suvarus?|volkswagen|vw|jeep|ram|gmc|bmw|mercedes|audi|lexus|acura|volvo|tesla|dodge|chrysler|buick|cadillac|lincoln|infiniti|genesis|mini|porsche|jaguar|land rover|rivian|lucid|mitsubishi|pontiac|saturn|oldsmobile|fiat|suzuki|isuzu|scion)\b/i;
const vehicleModels = /\b(?:grand caravan|grand cherokee|transit connect|promaster city|mustang|tacomas?|tacomos?|tacmas?|tecomas?|sti|rava|rav\s*4|civic|civc|accord|camry|coroll?a|highlander|hilander|sienna|4\s*runner|for\s+runner|for\s+runer|tundra|sequoia|prius|avalon|f-?150|f-?250|f-?350|maverick|ranger|bronco|explorer|expedition|escape|edge|cr-?v|hr-?v|pilot|passport|ridgeline|odyssey|sierra|silverado|tahoe|suburban|traverse|equinox|camaros?|malibu|blazer|colorado|yukon|acadia|terrain|wrangler|gladiator|cherokee|compass|renegade|charger|challenger|durango|journey|caravan|pacifica|frontier|titan|rogue|pathfinder|altima|sentra|versa|maxima|armada|sportage|telluride|sorento|soul|rio|palisade|santa fe|tucson|elantra|sonata|veloster|wrx|forester|outback|ascent|impreza|atlas|tiguan|jetta|passat|cayenne|rlx|model [3syx]|f-?type|range rover|defender|wrx|highlander)\b/i;
const vehicleCategories = /\b(?:suv|sedans?|midsize|mid[- ]?size|medium[- ]?size|mediano|mediana|turismos?|trucks?|truk|troka|troca|trokita|troquita|troque|trokas|dump\s*trucks?|pickup|pick-up|van|minivan|crossover|coupe|coupé|hatchback|motorcycle|moto|camioneta|camionetq|camion|camión)\b/i;
const vehicleContext = /\b(?:tengo|tiene|tienen|ten[ií]an|have|has|got|carry|available|need|needs|i have|my vehicle is|mi (?:carro|auto|veh[ií]culo) es|estoy buscando|ando buscando|looking for|busco|buscando|quiero|want|love|like|prefer|interested in|interesado en)\b/i;
// Messenger may insert an emoji/punctuation into a compact-car answer, and
// Spanish speech-to-text commonly produces phonetic spellings such as
// "pek[e]no" or "chico". Keep these answers in the Sedan category.
const genericSedanIntent = /\b(?:small|compact|affordable|budget|economical)\s+(?:car|auto|coche|carro|vehicle)\b|\b(?:carro|auto|coche|veh[ií]culo)[\s\W_]{1,8}(?:pequeñ[oa]|pequen[oa]|peken[oa]|chic[oa])\b/i;
const economicCarIntent = /\b(?:(?:carro|carros|auto|autos|coche|coches|veh[ií]culo|veh[ií]culos)\s+econ[oó]mic[oa]s?|(?:economic|economical|affordable|budget)\s+(?:car|cars|auto|vehicle)|algo\s+econ[oó]mic[oa]?)\b/i;
// Stafford's WhatsApp flow commonly answers the vehicle-type prompt with
// "Algo económico" followed by "Normal". Keep it as a sedan category during
// late GHL reconciliation instead of falling back to advisor handoff.
const economicSedanIntent = economicCarIntent;
// When a buyer is explicitly undecided, use Sedan as the safe default so the
// lead can continue through routing instead of remaining partial. This is a
// fallback only: explicit vehicle evidence still wins below.
const indecisiveVehicleIntent = /\b(?:anything\s+(?:you\s+)?(?:have|got|offer|carry|available|in\s+stock)|whatever\s+(?:you\s+have|you(?:'ve|\s+have)?\s+got|is\s+available)|(?:i(?:'m|\s+am)\s+)?(?:not\s+sure|unsure|undecided|do\s+not\s+know|don't\s+know|have\s+no\s+idea|no\s+idea|no\s+preference)\s+(?:about\s+|on\s+|what\s+|which\s+)?(?:vehicle|car|auto|coche|carro|truck|suv|sedan)?|(?:it\s+)?does(?:n't|\s+not)\s+matter\s+(?:what|which)\s+(?:vehicle|car|auto|coche|carro)|i\s+do(?:n't|\s+not)\s+care\s+(?:what|which)\s+(?:vehicle|car|auto|coche|carro)|(?:any|whatever)\s+(?:vehicle|car|auto|coche|carro)|(?:no\s+(?:sé|se)\s+(?:qué|que)|no\s+tengo\s+(?:idea|preferencia|claro\s+qué|claro\s+que)|estoy\s+indecis[oa]|no\s+estoy\s+segur[oa]|me\s+da\s+igual|me\s+es\s+igual)\s*(?:de\s+|sobre\s+|qué\s+|que\s+)?(?:carro|auto|coche|veh[ií]culo|vehiculo|camioneta)|(?:cualquiera|lo\s+que\s+sea|el\s+que\s+sea|la\s+que\s+sea)(?:\s+(?:carro|auto|coche|veh[ií]culo|vehiculo))?)\b/i;
const familyPassengerVanIntent = /\b(?:algo\s+)?familiar\b[\s\S]{0,80}\bpasajeros?\b/i;
const noDownPaymentResponse = /\b(?:no(?:\s+\w+){0,3}\s+(?:down(?:\s+payment)?|enganche|pago\s+inicial|dinero)|sin\s+(?:down|enganche|pago\s+inicial)|zero\s+down|\$?0\s*(?:down|enganche|pago\s+inicial)?)\b/i;
const normalizeWhisperVehicleAliases = (value) => clean(value)
  .replace(/^ban$/i, 'van')
  .replace(/\bsedán\b/gi, 'Sedan')
  // Spanish GHL/Messenger transcription can render "van" as "ban" in a
  // vehicle request such as "ban con rampa". Keep the context boundary so
  // an older trade-in phrase like "mi ban y 2000" is not reinterpreted.
  .replace(/\bban\b(?=\s+(?:con|para)\b)/gi, 'van')
  .replace(/\b(?:andas|onda|ondas|honda)\s+y\s*vis\s+si\b/gi, 'Honda Civic')
  .replace(/\b(?:andas|onda|ondas)\s+civ(?:ic|is)\b/gi, 'Honda Civic')
  // GHL/Messenger transcription in the Culpeper replay rendered
  // "Toyota Tundra" as "toyata tandra". Keep these bounded to vehicle
  // tokens so a misspelling cannot alter names or free-form notes.
  .replace(/\btoyata\b/gi, 'Toyota')
  .replace(/\btandra\b/gi, 'Tundra')
  // GHL can omit the leading "4" when a buyer asks for a Toyota 4Runner.
  // Keep this scoped to Toyota so a generic "runner" is never promoted.
  .replace(/\btoyota\s+runner\b/gi, 'Toyota 4Runner')
  // GHL/Messenger can transcribe 4Runner with spaces, hyphens, a missing
  // "n", a homophone, or a plural suffix. Keep all variants canonical.
  .replace(/\b(?:4|four|for)\s*-?\s*run(?:ner|er)s?\b/gi, '4Runner')
  // Messenger/Whisper commonly renders RAV4 as "raw4".
  .replace(/\braw\s*4\b/gi, 'RAV4')
  .replace(/\braw\s+four\b/gi, 'RAV4')
  // GHL/Messenger can also transcribe the spoken model as "rava".
  // Keep this alias scoped to vehicle extraction.
  .replace(/\brava\b/gi, 'RAV4')
  // GHL can transcribe Durango as the phonetic "darango". Keep the alias
  // scoped to vehicle extraction so it cannot alter names or notes.
  .replace(/\bdodge\s+darangos?\b/gi, 'Dodge Durango')
  .replace(/\bdarangos?\b/gi, 'Dodge Durango')
  .replace(/\bcamaros?\b/gi, 'Camaro')
  .replace(/\buna\s*troca\b/gi, 'troca')
  .replace(/\bttoca\b/gi, 'troca')
  .replace(/\b(?:dum|dumb|dump)\s*truck\b/gi, 'truck')
  // GHL transcribed the Ford model answer as "For 250". This alias is
  // applied only to vehicle extraction; payment extraction still sees the
  // original text and therefore cannot turn the answer into $250.
  .replace(/\bfor\s+(150|250|350)\b/gi, 'F-$1');
const canonicalVehicleLabel = (value) => normalizeWhisperVehicleAliases(value)
  .replace(/\btoyotas?\b/gi, 'Toyota')
  .replace(/\bsuvarus?\b/gi, 'Subaru')
  .replace(/\bcorola\b/gi, 'Corolla')
  .replace(/\bcivc\b/gi, 'Civic')
  .replace(/\btacomas?\b/gi, 'Tacoma')
  .replace(/\btacomos?\b/gi, 'Tacoma')
  .replace(/\btacmas?\b/gi, 'Tacoma')
  .replace(/\btecomas?\b/gi, 'Tacoma')
  .replace(/\brav\s*4\b/gi, 'RAV4')
  .replace(/\bfor\s+run(?:ner|er)\b/gi, '4Runner')
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
    if (lower === 'sti') return 'STI';
    if (lower === 'rav4') return 'RAV4';
    if (lower === '4runner') return '4Runner';
    if (lower === 'rlx') return 'RLX';
    if (lower === 'cr-v' || lower === 'hr-v') return lower.toLocaleUpperCase();
    if (/^f-?\d+$/.test(lower)) return `F-${lower.replace(/^f-?/, '')}`;
    return `${lower[0].toLocaleUpperCase()}${lower.slice(1)}`;
  }).join(' '));
const canonicalVehicleCategory = (value) => clean(value)
  .replace(/\bsuv\b/gi, 'SUV')
  .replace(/\bsedans\b/gi, 'Sedan')
  .replace(/\bturismos?\b/gi, 'Sedan')
  .replace(/\b(?:mid[- ]?size|medium[- ]?size|mediano|mediana)\b/gi, 'midsize')
  .replace(/\b(?:truk|troka|troca|trokita|troquita|troque|trokas|camioneta|camionetq|camion|camión)\b/gi, 'truck');
// Trade-in requires affirmative intent. A campaign CTA such as "Quiero mi
// Auto con Eastern" is not evidence that the buyer has a vehicle to trade.
const tradeInLanguage = /\btrade[- ]?in\b|\b(?:carro|auto|veh[ií]culo)\s+como\s+enganche\b|\b(?:cambiar|cambio)\s+(?:(?:mi|el|de)\s+)?(?:veh[ií]culo|carro|auto|van|troca|camioneta|camion)\b|\bchange\s+(?:my\s+)?(?:vehicle|car|van|truck)\b|\b(?:entregar|entrego|entregue|dar|doy)\s+(?:(?:mi|el|de)\s+)?(?:veh[ií]culo|carro|auto|van|troca|camioneta|camion)\b|\b(?:and|y)\s+(?:my|mi)\s+(?:car|vehicle|van|truck|carro|auto|veh[ií]culo|troca|camioneta|camion)\b|\b(?:my|mi)\s+(?:car|vehicle|van|truck|carro|auto|veh[ií]culo|troca|camioneta|camion)\s+(?:for|para)\s+(?:trade(?:[- ]?in)?|entregar|cambiar|dar)\b|\b(?:my|mi)\s+(?:car|vehicle|van|truck|carro|auto|veh[ií]culo|troca|camioneta|camion|ban)\b[\s\S]{0,24}\b(?:\d{3,5}\s*(?:dollars?|d[oó]lares?)|down|payment|enganche)\b|\b(?:\d{3,5}\s*(?:dollars?|d[oó]lares?)|down|payment|enganche)\b[\s\S]{0,24}\b(?:my|mi)\s+(?:car|vehicle|van|truck|carro|auto|veh[ií]culo|troca|camioneta|camion|ban)\b/i;
const vehicleLabel = (value) => {
  let source = normalizeWhisperVehicleAliases(value)
    .replace(/\b(?:19|20)\d{2}\b/g, ' ')
    .replace(/\b(?:tengo|tiene|tienen|have|has|need|needs|i have|my vehicle is|mi (?:carro|auto|veh[ií]culo) es|estoy buscando|ando buscando|looking for|busco|buscando|quiero|want|love|like|prefer|interested in|interesado en)\b/gi, ' ')
    .replace(/\b(?:a|an|un|una|my|mi|the|carro|auto|car|vehicle|veh[ií]culo)\b/gi, ' ')
    .replace(/[!?.,:;"“”]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!source) return '';
  const brandMatch = source.match(vehicleBrands);
  const modelMatch = source.match(vehicleModels);
  const categoryMatch = source.match(vehicleCategories);
  const categoryBeforeModel = categoryMatch && modelMatch
    && /\b(?:camioneta|camionetq|camion|camión|troca|troquita|troka|trokita|troque|pickup|pick-up)\b/i.test(categoryMatch[0])
    && (categoryMatch.index || 0) < (modelMatch.index || 0)
    && (modelMatch.index || 0) - (categoryMatch.index || 0) <= 40;
  const firstMatch = [
    brandMatch ? { kind: 'brand', match: brandMatch } : null,
    modelMatch ? { kind: 'model', match: modelMatch } : null,
    categoryMatch ? { kind: 'category', match: categoryMatch } : null,
  ].filter(Boolean).sort((left, right) => left.match.index - right.match.index)[0];
  const preferredMatch = categoryBeforeModel && modelMatch ? { kind: 'model', match: modelMatch } : firstMatch;
  if (!preferredMatch) return '';
  if (preferredMatch.kind === 'brand') {
    const brand = preferredMatch.match[0];
    const afterBrand = source.slice(source.toLocaleLowerCase().indexOf(brand.toLocaleLowerCase()) + brand.length).trim();
    const modelAfterBrand = afterBrand.match(vehicleModels);
    if (modelAfterBrand?.index !== undefined) {
      const model = modelAfterBrand[0];
      const afterModel = afterBrand.slice(modelAfterBrand.index + model.length);
      const trim = afterModel.match(/^\s+(?:(?:con|with)\s+(?:(?:el|la|the)\s+)?(?:(?:paquete|package)\s+)?)?(\d+\s*lt|lt|xle|le|se|sr5|limited|sport|touring|ex)\b/i)?.[1];
      const category = afterModel.match(vehicleCategories)?.[0];
      return canonicalVehicleLabel(`${brand} ${model}${trim ? ` ${trim}` : ''}${category ? ` ${category}` : ''}`);
    }
    const stopWords = new Set(['this', 'next', 'today', 'hoy', 'week', 'month', 'for', 'and', 'y', 'that', 'que', 'if', 'you', 'have', 'has', 'one', 'in', 'stock', 'available', 'at', 'me', 'do', 'offer', 'por', 'favor', 'modelos', 'modelo', 'disponibles', 'disponible', 'tengas', 'tienen', 'mostrar', 'muestra', 'mandar', 'fotos', 'puras', 'algunos', 'algunas']);
    const suffix = afterBrand.split(/\s+/).filter(Boolean).slice(0, 2).filter((token) => !stopWords.has(token.toLocaleLowerCase())).join(' ');
    return canonicalVehicleLabel(`${brand} ${suffix}`);
  }
  if (preferredMatch.kind === 'model') {
    const model = preferredMatch.match[0];
    const afterModel = source.slice((preferredMatch.match.index || 0) + model.length);
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
    .replace(/\b(?:tengo|tiene|tienen|have|has|need|needs|i have|my vehicle is|mi (?:carro|auto|veh[ií]culo) es|estoy buscando|ando buscando|looking for|busco|buscando|quiero|want|interested in|interesado en)\b/gi, ' ')
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
const locationSpellingVariants = /\b(?:baltimore|baltimor|baltmore|baltimroe|balitmore|baltimre|baltimorre|baltimoro|balitmor|baltimo|bomltimo)\b/i;
const editDistanceAtMost = (left, right, limit) => {
  if (Math.abs(left.length - right.length) > limit) return false;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    let minimum = current[0];
    for (let column = 1; column <= right.length; column += 1) {
      const value = Math.min(current[column - 1] + 1, previous[column] + 1, previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1));
      current[column] = value;
      minimum = Math.min(minimum, value);
    }
    if (minimum > limit) return false;
    previous = current;
  }
  return previous[right.length] <= limit;
};
const isBaltimoreVariant = (value) => {
  const candidate = clean(value).toLocaleLowerCase();
  if (locationSpellingVariants.test(candidate)) return true;
  return (candidate.match(/[a-z]+/g) || [])
    .filter((token) => token.length >= 6 && token.length <= 12 && token.startsWith('b'))
    .some((token) => editDistanceAtMost(token, 'baltimore', 3));
};
const nameDeclaration = /(?:me llamo|mi nombre es|soy|yo soy|my name is|my name['’]s|i am|i['’]m|this is|call me(?!\s+at\b)|ll[aá]mame)\s+([a-záéíóúüñ][a-záéíóúüñ' -]{1,80})/i;
const realNameToken = "[\\p{L}\\p{M}]+(?:[-'][\\p{L}\\p{M}]+)*";
const realNamePattern = new RegExp(`^${realNameToken}(?:\\s+${realNameToken})*$`, 'u');
const technicalNameLabel = /^(?:precio|price)\s+(?:de|of)\b/i;
const locationResponse = /^(?:estoy|vivo)\s+en\b/i;
const profileDisplayLabelMarkers = /\b(?:me\s+puede(?:s)?\s+(?:mandar|enviar)|(?:mandar|enviar)\s+(?:fotos?|informaci[oó]n)|fotos?\s+de|copiar)\b/i;
const nameSuffixPunctuation = /\b(jr|sr|ii|iii|iv|v)\.(?=\s|,|$)/gi;
const normalizeNameSuffixPunctuation = (value) => clean(value).replace(nameSuffixPunctuation, '$1').replace(/,\s*$/, '').trim();
for (const technicalName of ['location', 'información', 'informacion', 'más información', 'mas informacion', 'más info', 'mas info', 'more information', 'more info', 'details', 'detalles']) invalidRealNames.add(technicalName);
const isValidRealName = (value) => {
  const candidate = normalizeNameSuffixPunctuation(value);
  const tokens = candidate ? candidate.split(/\s+/) : [];
  return Boolean(candidate && realNamePattern.test(candidate) && tokens.some((token) => token.replace(/[-']/g, '').length >= 2) && tokens.every((token) => token.toLocaleLowerCase() === 'y'
    || token.replace(/[-']/g, '').length >= 2
    || /^[A-ZÁÉÍÓÚÜÑ]\.?$/u.test(token)));
};
const normalizeRealName = (value) => {
  const candidate = normalizeNameSuffixPunctuation(value);
  if (!candidate || invalidRealNames.has(candidate.toLowerCase()) || phoneLikeText(candidate) || !isValidRealName(candidate) || technicalNameLabel.test(candidate) || locationResponse.test(candidate) || profileDisplayLabelMarkers.test(candidate) || singleWordNameBlocklist.test(candidate) || isBaltimoreVariant(candidate) || qualificationResponseMarkers.test(candidate) || genericVehicleIntent.test(candidate) || inventoryIntent.test(candidate) || greetingOnly.test(candidate) || isVehicleStatement(candidate)) return '';
  if (candidate.length > 100 || candidate.split(/\s+/).length > 5) return '';
  return formatPersonalName(candidate);
};
const isMessengerChannel = (value) => /(?:^|[^a-z])(?:messenger|facebook)(?:$|[^a-z])/i.test(clean(value));
const isWhatsAppChannel = (value) => /(?:^|[^a-z])whats?app(?:$|[^a-z])/i.test(clean(value));
const isStaffordWhatsApp = (source, value) => clean(source).toLocaleLowerCase() === 'stafford' && isWhatsAppChannel(value);
const effectiveChannel = (input) => {
  const channel = clean(input.channel);
  if (channel) return channel;
  const source = clean(input.source);
  return /(?:^|[^a-z])(?:messenger|facebook|whats?app)(?:$|[^a-z])/i.test(source) ? source : '';
};
const isBusinessName = (value) => /\b(?:auto\s*sales|motors?|dealership|dealer|llc|inc(?:orporated)?|corp(?:oration)?|company|tatuajes?|tattoos?|operaciones?|operations?|transport(?:ation)?|logistics|construction|remodeling|roofing|realty|consulting|services?|servicios?|shop|tienda|salon|barbershop|restaurant)\b/i.test(clean(value));
const isProfileDisplayName = (value) => profileDisplayLabelMarkers.test(clean(value)) || nameDeclaration.test(clean(value)) || !isValidRealName(value);
const nameParticles = new Set(['da', 'de', 'del', 'der', 'di', 'la', 'las', 'los', 'van', 'von', 'y']);
const formatPersonalName = (value) => {
  if (isBusinessName(value) || !/^[a-záéíóúüñ][a-záéíóúüñ' -]*$/i.test(value)) return value;
  return value.split(/\s+/).map((part, index) => {
    const lower = part.toLocaleLowerCase();
    if (index > 0 && nameParticles.has(lower)) return lower;
    return lower.split(/([-'])/).map((piece) => /[-']/.test(piece) ? piece : piece ? `${piece[0].toLocaleUpperCase()}${piece.slice(1)}` : piece).join('');
  }).join(' ');
};
const nonConversationalMetadataLine = /(?:\b(?:headline|source\s+url|attribution|ad\s*(?:id|name))\b|https?:\/\/|fb\.me\/|\.post\b)/i;
const nameFromText = (value) => {
  const lines = String(value ?? '').replace(/\r\n?/g, '\n').split(/\n+/).map(clean).filter((line) => line && !nonConversationalMetadataLine.test(line));
  const segments = lines.flatMap((line) => line.split(/[.!?;]+/).map(clean).filter(Boolean));
  for (const segment of segments) {
    const named = normalizeRealName(segment.match(nameDeclaration)?.[1]);
    if (named) return named;
    const candidate = segment.replace(/[.!?,;:]+$/g, '');
    const isTitleCasedToken = candidate[0] === candidate[0].toLocaleUpperCase() || candidate === candidate.toLocaleUpperCase();
    const isOneWordName = /^[a-záéíóúüñ][a-záéíóúüñ'-]{1,39}$/i.test(candidate)
      && isTitleCasedToken
      && !singleWordNameBlocklist.test(candidate);
    const isFullName = /^[a-záéíóúüñ][a-záéíóúüñ'-]*(?:\s+[a-záéíóúüñ][a-záéíóúüñ'-]*){1,3}$/i.test(candidate);
    if (!isOneWordName && !isFullName) continue;
    if (genericVehicleIntent.test(candidate) || /\b(?:quiero|busco|necesito|tengo|carro|auto|veh[ií]culo|suv|sedan|truck|troca|camioneta|pickup|van|financiar|finance|down|payment|hoy|today|yes|no)\b/i.test(candidate)) continue;
    const name = normalizeRealName(candidate);
    if (name) return name;
  }
  return '';
};
const declaredNameFromText = (value) => {
  const lines = String(value ?? '').replace(/\r\n?/g, '\n').split(/\n+/).map(clean).filter((line) => line && !nonConversationalMetadataLine.test(line));
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const explicit = normalizeRealName(line.match(nameDeclaration)?.[1]);
    if (explicit) return explicit;
    if (!/(?:what(?:'s| is)?\s+(?:your|the)\s+name|full\s+name|what\s+should\s+i\s+call|cu[aá]l\s+es\s+tu\s+nombre|dime\s+tu\s+nombre)/i.test(line)) continue;
    const answer = normalizeRealName(lines[index + 1]);
    if (answer) return answer;
  }
  return '';
};
const normalizeProfileDisplayName = (value) => {
  const candidate = clean(value);
  if (!candidate || /[\p{N}]/u.test(candidate)) return '';
  // Messenger display names may carry decorative symbols/emojis (for example
  // "Andrea⚘️"). Remove only Unicode decoration, then run the strict name
  // validator on the resulting value. Digits and punctuation remain invalid.
  const withoutDecoration = candidate
    .normalize('NFC')
    .replace(/[\p{So}\p{Sk}\p{Cf}\uFE0F]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  return isProfileDisplayName(withoutDecoration) ? '' : normalizeRealName(withoutDecoration);
};
const suppliedName = normalizeRealName(inputData.real_name);
const profile = inputData.profile && typeof inputData.profile === 'object' ? inputData.profile : {};
const whatsappProfile = inputData.whatsapp && typeof inputData.whatsapp === 'object' && inputData.whatsapp.profile && typeof inputData.whatsapp.profile === 'object' ? inputData.whatsapp.profile : {};
const rawContactName = first(inputData.contact_name, inputData.contactName, profile.name, whatsappProfile.name, inputData.name);
const channel = effectiveChannel(inputData);
const staffordWhatsApp = isStaffordWhatsApp(inputData.source, channel);
const contactName = isMessengerChannel(channel)
  ? normalizeProfileDisplayName(rawContactName)
  : (isProfileDisplayName(rawContactName) ? '' : normalizeRealName(rawContactName));
// A fresh Messenger profile name must be allowed to repair a contaminated
// snapshot (for example "Me Pagan Cheque" from a prior answer).
const messengerProfileName = contactName || suppliedName;
const extractedNames = [
  memoryValue(['real_name', 'real name', 'customer_name', 'customer name', 'contact_name', 'contact name', 'full_name', 'full name', 'name', 'nombre_real', 'nombre real', 'nombre completo', 'nombre']),
  nameFromText(rawMessage),
  nameFromText(rawHistory),
];
const whatsappNames = [
  declaredNameFromText(rawMessage),
  declaredNameFromText(rawHistory),
  nameFromText(rawMessage),
  nameFromText(rawHistory),
  contactName,
  memoryValue(['real_name', 'real name', 'customer_name', 'customer name', 'contact_name', 'contact name', 'full_name', 'full name', 'name', 'nombre_real', 'nombre real', 'nombre completo', 'nombre']),
];
const normalizeWhatsAppCandidate = (value) => {
  const candidate = clean(value);
  // Stafford is WhatsApp-only. GHL sometimes exposes a vehicle/offer label as
  // the contact name (for example, "Un Ford Explorer Estoppel"). Do not let
  // that label become the buyer's real name; recover the name only from an
  // explicit declaration or a valid conversational answer.
  const startsWithVehicleArticle = /^(?:un|una|a|an|my|mi|the)\s+/i.test(candidate);
  const containsVehicleToken = vehicleBrands.test(candidate) || vehicleModels.test(candidate) || vehicleCategories.test(candidate);
  if (staffordWhatsApp && candidate && startsWithVehicleArticle && containsVehicleToken) return '';
  return normalizeRealName(candidate);
};
const realName = isMessengerChannel(channel)
  ? (messengerProfileName && !isBusinessName(messengerProfileName)
    ? messengerProfileName
    : declaredNameFromText(rawMessage) || declaredNameFromText(rawHistory) || extractedNames.map(normalizeRealName).find(Boolean) || messengerProfileName || '')
  : isWhatsAppChannel(channel)
    ? whatsappNames.map(normalizeWhatsAppCandidate).find(Boolean) || ''
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
const historyForExtraction = stripCampaignButtonPhrases(rawHistory);
const amountRangeToken = '(?:\\d{1,3}(?:[,.]\\d{3})+|\\d+(?:[,.]\\d+)?\\s*(?:k|mil|thousand)?|(?:un|one|a|dos|two|tres|three|cuatro|four|cinco|five|seis|six|siete|seven|ocho|eight|nueve|nine|diez|ten)\\s+(?:mil|thousand)(?:\\s+(?:quinientos|five hundred))?)';
const amountRangeParts = (start, end, assumeThousands = false) => {
  const unit = `${start} ${end}`.match(/\b(?:mil|thousand|k)\b/i)?.[0] || '';
  const applyContext = (value) => {
    const trimmed = String(value).trim();
    if (unit && /^\\d+(?:[.,]\\d+)?$/.test(trimmed)) return `${trimmed} ${unit}`;
    if (assumeThousands && /^\d{1,2}(?:[.,]\d+)?$/.test(trimmed)) return `${trimmed} mil`;
    return trimmed;
  };
  const normalized = [amount(applyContext(start)), amount(applyContext(end))]
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
  return normalized.length === 2 ? `${normalized[0]} - ${normalized[1]}` : '';
};
const amount = (value) => {
  const source = clean(value).toLowerCase();
  if (!source || emptyMarker(source)) return '';
  if (noDownPaymentResponse.test(source)) return 'No down payment';
  const rangeMatch = source.match(new RegExp(`^\\$?(${amountRangeToken})(?:\\s*(mil|thousand|k))?\\s*(?:a|to|[-–—])\\s*\\$?(${amountRangeToken})(?:\\s*(mil|thousand|k))?(?:\\s*(?:down|payment|enganche|inicial|d[oó]lares?|dollars?))?$`, 'i'));
  if (rangeMatch) {
    const start = `${rangeMatch[1]} ${rangeMatch[2] || ''}`.trim();
    const end = `${rangeMatch[3]} ${rangeMatch[4] || ''}`.trim();
    return amountRangeParts(start, end);
  }
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
const GENERAL_DOWN_PAYMENT_MINIMUM = 1000;
const OFFLEASE_DOWN_PAYMENT_MINIMUM = 1500;
const OFFLEASE_DEALER_IDS = new Set(['fredericksburg', 'fredericksburg-2', 'fredericksburg 2', 'stafford']);
const isOffleaseDealer = (value) => {
  const normalized = clean(value).toLocaleLowerCase();
  return OFFLEASE_DEALER_IDS.has(normalized) || /^offlease(?:\s+motors)?\s+(?:fredericksburg(?:\s*2)?|stafford)$/i.test(normalized);
};
const visibleDownPayment = (value, dealerOrSource) => {
  const normalized = validAmount(value);
  if (!normalized || /^no down payment$/i.test(normalized) || normalized === cashDownPayment) return normalized;
  const range = normalized.match(/^\s*\$?\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?\s*k?)\s*-\s*\$?\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?\s*k?)\s*$/i);
  const match = range ? [range[0], range[2]] : normalized.match(/\$?\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)/);
  if (!match) return normalized;
  const compact = match[1].replace(/,/g, '');
  const amountValue = /^\d{1,3}(?:\.\d{3})+$/.test(compact) ? Number(compact.replace(/\./g, '')) : Number.parseFloat(compact);
  if (!Number.isFinite(amountValue)) return normalized;
  const effectiveAmount = amountValue === 999 ? 1000 : amountValue;
  const rounded = amountValue === 999 ? '1000' : normalized;
  const minimum = isOffleaseDealer(dealerOrSource) ? OFFLEASE_DOWN_PAYMENT_MINIMUM : GENERAL_DOWN_PAYMENT_MINIMUM;
  return effectiveAmount < minimum ? '' : rounded;
};
const isVehicleYear = (value) => {
  const normalized = String(value ?? '').replace(/[$,\s]/g, '');
  const parsed = Number(normalized);
  return /^\d{4}$/.test(normalized) && Number.isInteger(parsed) && parsed >= 2006 && parsed <= 2026;
};
const isShortVehicleYear = (value) => {
  const normalized = String(value ?? '').replace(/[$,\s]/g, '');
  const parsed = Number(normalized);
  return /^(?:0[5-9]|1\d|2[0-6])$/.test(normalized) && Number.isInteger(parsed);
};
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
  const source = String(text ?? '')
    .replace(/\r\n?/g, '\n')
    // Dates such as "the 23rd" are not down-payment amounts.
    .replace(/\b\d+(?:st|nd|rd|th)\b/gi, ' ')
    .trim();
  if (!source || campaign) return '';
  if (noDownPaymentResponse.test(source)) return 'No down payment';
  const cashEvidenceSource = source.replace(/(?:bank account|cuenta bancaria|cuenta de banco|cheque|check)[^.!?\n]*(?:[.!?]|$)/gi, '');
  if (/\b(?:pay|pagar|pago|pagar[eé]|voy\s+a\s+pagar|purchase|buy|comprar|compra|hacer\s+la\s+compra|put|poner|down|enganche|inicial)[^.!?\n]{0,80}\b(?:cash|contado|efectivo|paid\s+in\s+full|paga(?:r)?\s+de\s+contado)\b/i.test(cashEvidenceSource)) return cashDownPayment;
  const token = `(${amountToken})`;
  const safeSource = source.split('\n').filter((line) => !isPhoneOnlyLine(line)).join('\n');
  const informalAmount = safeSource.match(new RegExp(`(?:tanda|cantidad|lo m[aá]ximo|lo m[aá]s que tengo|maximum|maximo|m[aá]ximo)[^\\n]{0,60}?\\$?(${amountToken})`, 'i'))?.[1];
  const rangeMatch = safeSource.match(new RegExp(`\\$?(${amountToken})(?:\\s*(mil|thousand|k))?\\s*(?:a|to|[-–—])\\s*\\$?(${amountToken})(?:\\s*(mil|thousand|k))?`, 'i'));
  const shortUnitRange = safeSource.match(/\$?(\d{1,2})\s*(?:a|to|[-–—/])\s*(\d{1,2})\s*(mil|thousand|k)\b/i);
  if (shortUnitRange) {
    const normalizedRange = amountRangeParts(`${shortUnitRange[1]} ${shortUnitRange[3]}`, `${shortUnitRange[2]} ${shortUnitRange[3]}`);
    if (normalizedRange) return normalizedRange;
  }
  if (rangeMatch) {
    const start = `${rangeMatch[1]} ${rangeMatch[2] || ''}`.trim();
    const end = `${rangeMatch[3]} ${rangeMatch[4] || ''}`.trim();
    if (isVehicleYear(start) || isVehicleYear(end)) return '';
    const assumeThousands = /\b(?:down|payment|enganche|inicial|deposit|dep[oó]sito)\b/i.test(source)
      && [start, end].every((value) => /^\d{1,2}$/.test(value.trim()));
    const normalizedRange = amountRangeParts(start, end, assumeThousands);
    if (normalizedRange) return normalizedRange;
  }
  const explicit = source.match(new RegExp(`(?:down|enganche|inicial|deposit|dep[oó]sito)[ \\t]*(?:payment|pago)?[ \\t]*(?:is|es|de|:)?[ \\t]*\\$?[ \\t]*${token}`, 'i'));
  const atLeast = source.match(new RegExp(`\\b(?:at least|minimum of)\\s+\\$?[ \\t]*${token}\\b`, 'i'))?.[1];
  const amountLeading = source.match(new RegExp(`(?:^|\\n)\\s*\\$?${token}\\b[^\\n]{0,100}\\b(?:down|payment|pago(?:\\s+inicial)?|enganche|inicial)\\b`, 'i'))?.[1];
  const contextualPromptLine = source
    .split('\n')
    .map((line, index, lines) => line.trim() === '__DOWN_PROMPT__' ? (lines[index + 1] || '').trim() : '')
    .find(Boolean) || '';
  const contextualPromptAmount = contextualPromptLine.match(new RegExp(`^(?:(?:quiz[aá]s|maybe|perhaps|aprox(?:imadamente)?|approximately|around|unos?)\\s+)?\\$?${token}\\b`, 'i'))?.[1];
  const withAmount = source.match(new RegExp(`\\b(?:puedo|puede|can|could|i can|i could)[ \\t]+(?:con|with)[ \\t]*\\$?[ \\t]*${token}\\b`, 'i'));
  const directCon = source.match(new RegExp(`(?:^|\\n)\\s*con[ \\t]+\\$?[ \\t]*${token}\\b`, 'i'));
  const declared = source.match(new RegExp(`\\b(?:i have|tengo|i can put|puedo poner)[ \\t]+\\$?[ \\t]*${token}[ \\t]*(?:down|payment|enganche|inicial)?\\b`, 'i'));
  const spanishDeclared = source.match(new RegExp(`\\b(?:doy|dar(?:e|é|ia|ía)?|pongo|poner|i(?:'|’)ll put|i put)[ \\t]+(?:down[ \\t]+)?(?:los|las|el|la|unos|unas|un|una)?[ \\t]*(?:at least[ \\t]+|de[ \\t]+|para[ \\t]+)?\\$?[ \\t]*${token}\\b`, 'i'));
  const noisyDeclared = source.match(new RegExp(`\\b(?:cuento|cuenta)\\b[^\\n]{0,80}?(?:y|and|plus)[ \\t.,;:]*\\$?[ \\t]*${token}\\b`, 'i'));
  const standalone = safeSource.match(new RegExp(`(?:^|\\n)\\$?[ \\t]*${token}[ \\t]*\\$?[ \\t]*(?:(?:tengo|have|available|disponible|i have|i can put|m[aá]ximo|maximum)[ \\t]*\\d{0,2})?[ \\t]*\\.?[ \\t]*(?=\\n|$)`, 'im'));
  const candidate = standalone?.[1]?.replace(/[$,\s]/g, '') || '';
  const value = explicit?.[1] || atLeast || amountLeading || contextualPromptAmount || withAmount?.[1] || directCon?.[1] || declared?.[1] || spanishDeclared?.[1] || noisyDeclared?.[1] || informalAmount || standalone?.[1];
  if (value && isShortVehicleYear(value) && (vehicleBrands.test(source) || vehicleModels.test(source) || vehicleCategories.test(source))) return '';
  if (!explicit && !spanishDeclared && isVehicleYear(candidate)
    && (vehicleYearFrom(source) !== null || /^20(?:1\d|2[0-6])$/.test(candidate))) return '';
  return validAmount(value);
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
// In Spanish, "van a llamar/hacer/comprar" is a verb phrase, not a vehicle
// answer. Only let `van` survive when the message presents it explicitly as a
// vehicle (for example "una van", "mi van", "van con rampa", or a standalone
// "van"). This prevents a later conversational sentence from overriding an
// earlier model such as Tacoma.
const isFalsePositiveVanVerb = (value) => {
  const candidate = clean(value);
  if (!/\bvan\s+a\s+[a-záéíóúüñ]+(?:ar|er|ir)\b/i.test(candidate)) return false;
  return !/(?:^|\b)(?:una?\s+|mi\s+|my\s+|tengo\s+|tiene\s+|busco\s+|buscando\s+|quiero\s+|looking\s+for\s+|need\s+|needs\s+|have\s+|has\s+)(?:van)\b|^van$|\bvan\s+(?:con|para|de)\b/i.test(candidate);
};
const vehicleFrom = (text) => {
  const source = String(text ?? '').replace(/\r\n?/g, '\n').trim();
  if (!source || campaign) return '';
  const candidates = [];
  const lines = source.split(/\n+/).map(clean).filter(Boolean);
  for (const [lineIndex, line] of lines.entries()) {
    const candidate = normalizeWhisperVehicleAliases(stripCampaignButtonPhrases(line));
    if (!candidate || isCampaignButton(candidate) || isNonVehicleIntent(candidate)) continue;
    if (isFalsePositiveVanVerb(candidate)) continue;
    // Internal structured fields can appear beside the buyer's evidence. They
    // describe a field, not a new vehicle answer, and must not override the
    // actual vehicle with a later `vehicle_type: SUV` marker.
    if (/^\s*(?:vehicle_type|vehicle_category)\s*[:=]/i.test(candidate)) continue;
    if (tradeInLanguage.test(candidate)
      && /\b(?:tengo|tiene|have|has|my|mi)\b/i.test(candidate)
      && !/\b(?:looking for|busco|quiero|want|interested in|interesado en)\b/i.test(candidate)) continue;
    const hasVehicleEvidence = (vehicleModels.test(candidate) || vehicleBrands.test(candidate) || vehicleCategories.test(candidate))
      && !/\b(?:passport|pasaporte|license|licencia|bank\s+account|bank\s+statements?|income|document(?:s|os)?|identification|id)\b/i.test(candidate);
    const candidateForVehicle = /\b(?:need|needs|looking for|busco|quiero|want|interested in|interesado en)\b/i.test(candidate) || hasVehicleEvidence
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
      if (requestedLabel) candidates.push({ label: requestedLabel, score: 100 + (vehicleModels.test(requested) ? 25 : 0) + lineIndex / 1000, lineIndex, hasModel: vehicleModels.test(requested), brand: requested.match(vehicleBrands)?.[0] || '', isColloquialTruck: false });
    }
    const category = cleaned.match(/\b(?:suv|sedans?|trucks?|troka|troca|trokita|troquita|troque|trokas|pickup|pick-up|van|minivan|crossover|coupe|coupé|hatchback|motorcycle|moto|camioneta|camionetq|camion|camión)\b/i);
    const hasModel = vehicleModels.test(cleaned);
    const brand = cleaned.match(vehicleBrands)?.[0] || '';
    const label = vehicleLabel(cleaned);
    const imageEvidence = /\b(?:image\s+(?:interpretation|description|decription)|\[image\s+interpretation\])\b/i.test(candidate);
    const followsVehicleQuestion = lineIndex > 0 && /\b(?:what|which)\s+(?:vehicles?|cars?|trucks?)|\b(?:qu[eé]|cu[aá]l)\s+(?:veh[ií]culos?|carros?|autos?)\b/i.test(lines[lineIndex - 1]);
    if (label && (category || vehicleContext.test(candidate) || followsVehicleQuestion || vehicleBrands.test(candidate) || hasModel || vehicleCategories.test(candidate))) {
      const lowQualityNarrative = /\b(?:seg[uú]n|anuncio|anuncios|variedad|maneja|manejan|opciones|informaci[oó]n)\b/i.test(candidate);
      const score = (hasModel ? 80 : category ? 25 : brand ? 15 : 0)
        + (vehicleContext.test(candidate) ? 10 : 0)
        + (followsVehicleQuestion ? 10 : 0)
        - (lowQualityNarrative && !hasModel ? 30 : 0)
        + lineIndex / 1000;
      candidates.push({ label, score, lineIndex, hasModel, brand, isColloquialTruck: /\b(?:troka|troca|trokita|troquita|troque|trokas)\b/i.test(candidate), isSyntheticEvidence: imageEvidence });
    }
  }
  // A buyer can change the vehicle during the same conversation. The last
  // explicit vehicle answer is the active choice, so the down payment must be
  // evaluated against that answer rather than an earlier, more specific model.
  const textualCandidates = candidates.filter((candidate) => !candidate.isSyntheticEvidence);
  const activeCandidates = textualCandidates.length > 0 ? textualCandidates : candidates;
  activeCandidates.sort((left, right) => right.lineIndex - left.lineIndex || right.score - left.score);
  const latest = activeCandidates[0];
  // Whisper can leave a standalone colloquial truck token after the requested
  // model. Preserve that specific model, while an explicit later category
  // such as Sedan/SUV remains the active buyer choice.
  const earlierModel = latest?.brand && !latest.hasModel
    ? activeCandidates.find((candidate) => candidate.hasModel && candidate.lineIndex < latest.lineIndex)
    : undefined;
  const best = earlierModel
    || (latest?.isColloquialTruck && !latest.hasModel
      ? activeCandidates.find((candidate) => candidate.hasModel && candidate.lineIndex < latest.lineIndex) || latest
      : latest);
  if (!best) return '';
  const brands = [...new Set(activeCandidates.map((candidate) => candidate.brand).filter(Boolean).map((brand) => brand.toLocaleLowerCase()))];
  if (!vehicleBrands.test(best.label) && brands.length === 1 && (best.hasModel || latest?.isColloquialTruck)) {
    const brand = activeCandidates.find((candidate) => candidate.brand && candidate.brand.toLocaleLowerCase() === brands[0])?.brand || brands[0];
    return clean(`${brand} ${best.label}`).replace(/\b([a-z]+)\b/gi, (token) => token[0].toLocaleUpperCase() + token.slice(1).toLocaleLowerCase()).replace(/\b(\d)\s*lt\b/gi, '$1LT');
  }
  return canonicalVehicleLabel(clean(best.label).replace(/\b(\d)\s*lt\b/gi, '$1LT'));
};
const cleanVehicleValue = (value) => {
  if (isCampaignButton(value) || isNonVehicleIntent(value)) return '';
  const candidate = clean(value).replace(/(?:19|20)\d{2}(?:\d{2})*$/i, '').trim();
  if (!candidate) return '';
  if (economicCarIntent.test(candidate)) return 'Sedan';
  // Do not allow arbitrary Custom Code/memory text to become vehicle_type.
  // Keep exact categories and recognized make/model labels only.
  const label = vehicleLabel(candidate);
  const categoryOnly = /^(?:suv|sedan|truck|troka|troca|pickup|pick-up|van|minivan|crossover|coupe|coupé|hatchback|motorcycle|moto|camioneta|camionetq|camion|camión|carro|auto|coche)$/i.test(candidate);
  return label || categoryOnly ? (label || candidate.replace(/^(?:troka|troca)$/i, 'truck').replace(/^camion(?:eta|etq)?$/i, 'truck').replace(/^camión(?:eta)?$/i, 'truck')) : '';
};
const isConcatenatedVehicleYearAmount = (value, vehicleYear) => {
  const normalized = validAmount(value);
  const yearPrefix = Number(normalized.slice(0, 4));
  return vehicleYear !== null && /^\d{5,6}$/.test(normalized) && yearPrefix >= 2006 && yearPrefix <= 2026;
};
const vehicleYearFrom = (value) => {
  const lines = String(value ?? '').replace(/\r\n?/g, '\n').split(/\n+/).map(clean).filter(Boolean);
  const years = /\b(20(?:0[6-9]|1\d|2[0-6])|0[5-9]|1\d|2[0-6])\b/g;
  const financialPrefix = /(?:\$|doy|dar(?:é|as|emos)?|pongo|poner|tengo|have|i have|i can put|puedo poner|down|payment|enganche|inicial|pago\s+inicial|cuota\s+inicial|deposit|dep[oó]sito)\s*(?:de|para|as|is|es|:)?\s*$/i;
  const financialSuffix = /^\s*(?:down|payment|enganche|inicial|pago\s+inicial|cuota\s+inicial|deposit|dep[oó]sito)\b/i;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const candidates = [];
    for (const match of line.matchAll(years)) {
      const rawYear = match[1];
      const year = rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear);
      const index = match.index || 0;
      const before = line.slice(Math.max(0, index - 60), index);
      const after = line.slice(index + match[0].length, index + match[0].length + 60);
      if (financialPrefix.test(before) || financialSuffix.test(after) || /\b(?:down|payment|enganche|inicial|pago\s+inicial|cuota\s+inicial|deposit|dep[oó]sito)\b[^\d]{0,40}$/i.test(before)) continue;
      const neighborhood = [lines[lineIndex - 1] || '', line, lines[lineIndex + 1] || ''].join(' ');
      const standaloneVehicleReply = rawYear.length === 2
        && (vehicleBrands.test(neighborhood) || vehicleModels.test(neighborhood) || vehicleCategories.test(neighborhood))
        && (/^\d{2}$/.test(line) || /^\s*(?:de|del|down|year|año|ano|model|modelo)\b/i.test(after));
      if (rawYear.length === 2 && !standaloneVehicleReply && !/(?:[-–—/]|\ba\b|\bto\b)\s*$/i.test(before) && !/^\s*(?:[-–—/]|\ba\b|\bto\b)/i.test(after)
        && !/\b(?:year|año|ano|model|modelo)\b/i.test(`${before} ${after}`)) continue;
      if (vehicleBrands.test(neighborhood) || vehicleModels.test(neighborhood) || vehicleCategories.test(neighborhood)
        || vehicleContext.test(neighborhood) || /\b(?:vehicle|car|auto|carro|coche|veh[ií]culo|model|modelo|year|año|ano)\b/i.test(neighborhood)) {
        candidates.push({ year, shorthand: rawYear.length === 2 });
      }
    }
    if (candidates.length > 0) {
      const shorthandYears = candidates.filter((candidate) => candidate.shorthand).map((candidate) => candidate.year);
      return shorthandYears.length > 0 ? Math.max(...shorthandYears) : candidates[0].year;
    }
  }
  return null;
};
const timelineMonths = {
  january: ['january', 'enero', 'jan(?:uary)?'], february: ['february', 'febrero', 'feb(?:ruary)?'],
  march: ['march', 'marzo', 'mar(?:ch)?'], april: ['april', 'abril', 'apr(?:il)?'],
  may: ['may', 'mayo', 'may'], june: ['june', 'junio', 'jun(?:e)?'],
  july: ['july', 'julio', 'jul(?:y)?'], august: ['august', 'agosto', 'aug(?:ust)?'],
  september: ['september', 'septiembre', 'sep(?:t(?:ember|iembre)?|tiembre)|setiembre'],
  october: ['october', 'octubre', 'oct(?:ober)?'], november: ['november', 'noviembre', 'nov(?:ember)?'],
  december: ['december', 'diciembre', 'dec(?:ember)?'],
};
const timelineMonthKey = (value) => Object.entries(timelineMonths).find(([, [, spanish, pattern]]) => new RegExp(`\\b(?:${pattern}|${spanish})\\b`, 'i').test(value))?.[0] || '';
const timelineDate = (value) => {
  const spanish = String(value).match(/\b(0?[1-9]|[12]\d|3[01])\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b/i);
  if (spanish) return `${Number(spanish[1])} de ${spanish[2].replace(/^setiembre$/i, 'septiembre')}`;
  const english = String(value).match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(0?[1-9]|[12]\d|3[01])(?:st|nd|rd|th)?\b/i);
  if (english) return `${english[1].toLowerCase()} ${Number(english[2])}`;
  const englishDayFirst = String(value).match(/\b(0?[1-9]|[12]\d|3[01])(?:st|nd|rd|th)?\s+(?:of\s+)?(january|february|march|april|may|june|july|august|september|october|november|december)\b/i);
  return englishDayFirst ? `${englishDayFirst[2].toLowerCase()} ${Number(englishDayFirst[1])}` : '';
};
const timelineFrom = (text) => {
  const dateText = clean(text).match(/\b(?:\d{1,2}\s+de\s+(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)|(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:st|nd|rd|th)?|\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?(?:january|february|march|april|may|june|july|august|september|october|november|december))\b/i)?.[0] || '';
  if (dateText) return timelineDate(dateText);
  const hit = clean(text).match(/\b(?:today|hoy|now if possible|if possible now|ahora si se puede|si es posible ahora|asap|as soon as possible|immediately|inmediato|para ya|ahora mismo|de inmediato|lo antes posible|this week|esta semana|this month|este mes|next week|pr[oó]xima? semana|next month|pr[oó]ximo mes|end of next month|a (?:fines?|finales?) del otro mes|a (?:fines?|finales?) del pr[oó]ximo mes|para (?:fines?|finales?) del (?:otro|pr[oó]ximo|siguiente) mes|within \d+ days?|en \d+ d[ií]as?|jan(?:uary)?|enero|feb(?:ruary)?|febrero|mar(?:ch)?|marzo|apr(?:il)?|abril|may|mayo|jun(?:e)?|junio|jul(?:y)?|julio|aug(?:ust)?|agosto|sep(?:t(?:ember|iembre)?|tiembre)|setiembre|septiembre|oct(?:ober)?|octubre|nov(?:ember)?|noviembre|dec(?:ember)?|diciembre)\b/i)?.[0] || '';
  const date = timelineDate(hit);
  if (date) return date;
  if (/today|hoy|now if possible|if possible now|ahora si se puede|si es posible ahora|asap|immediately|inmediato|para ya|ahora mismo|de inmediato|lo antes/i.test(hit)) return 'today';
  if (/this week|esta semana/i.test(hit)) return 'this week';
  if (/this month|este mes/i.test(hit)) return 'this month';
  if (/next week|pr[oó]xima? semana/i.test(hit)) return 'next week';
  if (/next month|pr[oó]ximo mes|end of next month|a (?:fines?|finales?) del (?:otro|pr[oó]ximo|siguiente) mes|para (?:fines?|finales?) del (?:otro|pr[oó]ximo|siguiente) mes/i.test(hit)) return 'next month';
  const month = timelineMonthKey(hit);
  if (month) return month;
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
const vehicleSource = [historyForExtraction, rawMessage].filter(Boolean).join('\n');
const transcriptVehicle = vehicleFrom(vehicleSource);
const phoneFromConversation = phoneFrom(message, history);
// Keep the WhatsApp/Messenger shorthand "carro económico" as the stable
// Sedan category.
const explicitVehicle = first(
  campaign ? '' : cleanVehicleValue(transcriptVehicle),
  cleanVehicleValue(memoryValue(['vehicle', 'vehicle_type'])),
  cleanVehicleValue(inputData.vehicle_type),
);
const extractedVehicle = familyPassengerVanIntent.test(vehicleSource)
  ? 'van'
  : economicSedanIntent.test(vehicleSource)
    ? 'Sedan'
    : genericSedanIntent.test(vehicleSource)
      ? 'Sedan'
      : /\b(?:four|4)[-\s]?door\s+sports?\s+cars?\b/i.test(vehicleSource)
        ? 'Sedan'
        : explicitVehicle || (indecisiveVehicleIntent.test(vehicleSource) ? 'Sedan' : '');
const existingAdvisorMarker = [memoryValue(['vehicle', 'vehicle_type']), inputData.vehicle_type].some(isAdvisorHandoffVehicle);
const phone = phoneFrom(message, history, inputData.phone);
  const transcriptVehicleYear = vehicleYearFrom(vehicleSource);
  const vehicleYear = [
    transcriptVehicleYear,
    ...(transcriptVehicle ? [] : [
      vehicleYearFrom(inputData.vehicle_type),
      vehicleYearFrom(memoryValue(['vehicle', 'vehicle_type'])),
    ]),
  ].find((value) => value !== null) ?? null;
const vehicleBase = extractedVehicle || (existingAdvisorMarker || phoneFromConversation || (isWhatsAppChannel(inputData.channel) && phone)
  ? advisorHandoffVehicle
  : '');
const vehicle = vehicleBase && vehicleYear !== null && vehicleBase !== advisorHandoffVehicle ? `${vehicleBase} ${vehicleYear}` : vehicleBase;
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
const recoveredStaffordPreviousFinancing = inputData.source === 'stafford' && isWhatsAppChannel(inputData.channel)
  && economicSedanIntent.test(rawHistory)
  && rawHistory.split(/\r?\n/).map(clean).some((line) => /^\$?1[,.]?000(?:\s+m[aá]xim(?:o|um))?$/i.test(line))
  ? (() => {
    const lines = rawHistory.split(/\r?\n/).map(clean).filter(Boolean);
    const timelineIndex = lines.findIndex((line) => /\b(?:today|hoy|this week|esta semana|this month|este mes|next week|pr[oó]xima? semana|next month|pr[oó]ximo mes)\b/i.test(line));
    const beforeTimeline = timelineIndex >= 0 ? lines.slice(0, timelineIndex) : lines;
    return beforeTimeline.some((line) => /^(?:yes|yeah|yep|si|sí|claro|correcto|tengo)$/i.test(line)) ? 'yes' : '';
  })()
  : '';
const effectivePreviousFinancing = previousFinancing || recoveredStaffordPreviousFinancing;
const confirmedQuestionDown = affirmativeDownConfirmation(latestInboundMessage)
  ? (questionedDownPayment(rawHistory) || questionedDownPayment(inputData.previous_predicted_bot_question || ''))
  : '';
const cashDownCandidate = campaign ? '' : first(
  downFrom(rawMessage),
  downFrom(rawHistory),
  confirmedQuestionDown,
  isPhoneAreaCodeAmount(memoryDown, phone) || (vehicleYear !== null && (validAmount(memoryDown) === String(vehicleYear) || isConcatenatedVehicleYearAmount(memoryDown, vehicleYear))) ? '' : memoryDown,
  isPhoneAreaCodeAmount(inputDown, phone) || (vehicleYear !== null && (validAmount(inputDown) === String(vehicleYear) || isConcatenatedVehicleYearAmount(inputDown, vehicleYear))) ? '' : validAmount(inputDown),
);
const cashDown = isConcatenatedVehicleYearAmount(cashDownCandidate, vehicleYear) ? '' : cashDownCandidate;
const tradeDown = campaign ? '' : first(tradeIn(message), tradeIn(historyForExtraction), tradeIn(memoryText(rawMemory)));
const downCandidate = cashDown || tradeDown;
const conversationalDownSource = `${message}; ${historyForExtraction}`;
const source = clean(inputData.source).toLocaleLowerCase();
let down = validAmount(cashDown && tradeInLanguage.test(conversationalDownSource) && !/trade[- ]?in/i.test(cashDown)
  ? `${cashDown} + trade-in`
  : downCandidate);
down = visibleDownPayment(down, source);
const sourceAware = Boolean(source);
const stafford = source === 'stafford';
const requiresLocation = ['easterns', 'easterns-millersville'].includes(source);
const allowFuzzyBaltimore = source === 'easterns';
const phoneSatisfiedByNative = stafford && isWhatsAppChannel(inputData.channel);
const customerLocationAliases = [
  ['Baltimore', /\bbaltimore\b/i],
  ['Laurel', /\blaurel\b/i],
  ['Sterling', /\bsterling\b/i],
  ['Millersville', /\bmillersville\b/i],
  ['Frederick', /\bfrederick\b/i],
  ['Fredericksburg', /\bfredericksburg\b/i],
  ['Woodbridge', /\bwoodbridge\b/i],
  ['Alexandria', /\balexandria\b/i],
  ['Culpeper', /\bculpeper\b/i],
  ['Stafford', /\bstafford\b/i],
];
const normalizeCustomerLocation = (value, allowFuzzyBaltimore) => {
  const candidate = clean(value);
  return allowFuzzyBaltimore && isBaltimoreVariant(candidate) ? 'Baltimore' : candidate;
};
const suppliedCustomerLocation = first(inputData.customer_location);
const transcriptText = `${history}; ${message}`;
const exactTranscriptAlias = customerLocationAliases.find(([, pattern]) => pattern.test(transcriptText));
const exactTranscriptLocation = exactTranscriptAlias ? transcriptText.match(exactTranscriptAlias[1])?.[0] || exactTranscriptAlias[0] : '';
const customerLocation = suppliedCustomerLocation
  ? normalizeCustomerLocation(suppliedCustomerLocation, allowFuzzyBaltimore)
  : exactTranscriptLocation || (allowFuzzyBaltimore && isBaltimoreVariant(`${history}; ${message}`) ? 'Baltimore' : '');
const vehicleCategory = /\b(?:truck|troka|troca|trokita|troquita|troque|trokas|pickup|pick[- ]?up|camioneta|camion|camión|tacoma|tundra|f[- ]?150|f[- ]?250|f[- ]?350|maverick|ranger|silverado|sierra|colorado|frontier|titan|ridgeline|gladiator|ram)\b/i.test(vehicle)
  ? 'truck'
  : /\b(?:suv|van|minivan|crossover|highlander|rav\s*4|4\s*runner|sienna|grand caravan|caravan|pacifica|odyssey|transit|promaster|pilot|passport|cr[- ]?v|hr[- ]?v|tahoe|suburban|traverse|equinox|blazer|yukon|acadia|terrain|wrangler|cherokee|compass|renegade|durango|explorer|expedition|escape|edge|armada|rogue|pathfinder|sportage|telluride|sorento|palisade|santa fe|tucson|forester|outback|ascent|atlas|tiguan|cayenne|range rover|defender)\b/i.test(vehicle)
    ? 'suv_or_van'
    : /\b(?:camaro|challenger|charger|mercedes(?:[- ]?benz)?|bmw|audi|lexus|acura|infiniti|genesis|cadillac|lincoln|volvo|tesla|porsche|jaguar)\b/i.test(vehicle)
      ? 'luxury_sedan'
      : /\b(?:sedan|midsize|mid[- ]?size|medium[- ]?size|mediano|mediana|civic|corolla|camry|accord|altima|sentra|versa|maxima|malibu|jetta|passat|sonata|elantra|optima|forte|rio|impala|avalon|prius|mustang|coupe|hatchback)\b/i.test(vehicle)
        ? 'sedan'
        : '';
const requiredDownPayment = ({ sedan: 1500, luxury_sedan: 2000, suv_or_van: 2000, truck: 3000 }[vehicleCategory] || null);
const tradeInDownPayment = tradeInLanguage.test(down);
const downPaymentRange = String(down).match(/^\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*$/);
const downPaymentAmount = downPaymentRange
  ? Number(downPaymentRange[2])
  : /^\d+(?:\.\d+)?$/.test(String(down).replace(/[$,\s]/g, '')) ? Number(String(down).replace(/[$,\s]/g, '')) : null;
const downPaymentSufficient = requiredDownPayment !== null && (tradeInDownPayment || down === cashDownPayment || down.toLocaleLowerCase().includes(cashDownPayment.toLocaleLowerCase()) || (downPaymentAmount !== null && downPaymentAmount >= requiredDownPayment));
const rawTimeline = first(timelineFrom(message), timelineFrom(history), memoryValue(['timeline', 'purchase timeline', 'purchase_timeline']), inputData.purchase_timeline);
const identification = documentStatus('id\\b|identification\\b|identificación\\b|driver.?s license\\b|license\\b|licencia\\b|itin\\b|passport\\b|pasaporte\\b', ['identification', 'id', 'itin', 'passport', 'pasaporte'], inputData.identification || inputData.documents);
const income = documentStatus('proof of income|income proof|prueba de ingresos|comprobante de ingresos|estados? de cuenta|account statements?|bank statements?|financial statements?|pay stubs?|check stubs?|talones? de pago|colillas? de cheques?|recibos? de n[oó]mina|bank account|cuenta bancaria|cuenta de banco', ['income', 'proof of income', 'estados de cuenta', 'account statements', 'bank statements', 'check stubs', 'bank account', 'cuenta bancaria', 'cuenta de banco'], inputData.documents);
const bankEvidenceSource = conversationalEvidence(rawMessage, rawHistory);
const bankAccountNegative = /\b(?:no|sin)\s+(?:tengo|have)\s+(?:una?\s+)?(?:bank account|cuenta bancaria|cuenta de banco)\b/i.test(bankEvidenceSource);
const bankAccountPositive = /\b(?:yes|sí|si|yeah|yep|correct|tengo|i\s+(?:have|do(?:\s+have)?))\b[^;!?]{0,50}\b(?:a\s+|an\s+|una?\s+)?(?:bank account|cuenta bancaria|cuenta de banco)\b/i.test(bankEvidenceSource);
const bankContext = bankAccountPositive ? 'yes' : bankEvidenceSource.match(/(?:bank account|cuenta bancaria|cuenta de banco)\s*(?:is|are|:|=)?\s*(yes|sí|si|yeah|yep|correct|tengo|have it|i do|i have|available|no|not|sin|dont|don't|no tengo|i do not|do not have|not available)\b/i)?.[1] || (bankAccountNegative ? 'no' : '');
const bankAccount = first(yesNo(inputData.bank_account), yesNo(bankContext), yesNo(memoryValue(['bank account', 'bank_account', 'cuenta bancaria', 'cuenta de banco'])));
const documents = first(memoryValue(['documents', 'docs', 'documentos']), inputData.documents, [identification === 'yes' ? 'identification: yes' : '', income === 'yes' ? 'proof of income: yes' : ''].filter(Boolean).join(', '));
const customPresent = [inputData.vehicle_type, inputData.down_payment, inputData.purchase_timeline, inputData.documents, inputData.identification, inputData.bank_account].some((value) => clean(value) && !emptyMarker(value));
const qualificationSource = rawMemory && customPresent ? 'both' : rawMemory ? 'qualification_memory' : customPresent ? 'custom_fields' : 'none';
// The queue handoff requires a phone and vehicle for every
// dealer. Down payment, timing, documents, and bank-account evidence remain
// visible but non-blocking for every dealer.
// Prefer a phone written in the inbound conversation, then a native GHL phone.
const languageText = `${message}; ${history}`;
const englishSignals = (languageText.match(/\b(?:i|i'm|im|my|want|wants|need|looking|have|yes|yeah|yep|what|when|where|how|this|next|today|week|month|do|does)\b/gi) || []).length;
const spanishSignals = (languageText.match(/\b(?:yo|mi|quiero|necesito|busco|tengo|sí|si|qué|cuando|donde|este|esta|hoy|semana|mes|tienes)\b/gi) || []).length;
const language = message || history ? (englishSignals > spanishSignals ? 'en' : 'es') : 'en';
const englishCalendarMonth = Object.entries(timelineMonths).some(([key, [english]]) => rawTimeline === key && new RegExp(`\\b${english}\\b`, 'i').test(`${message}; ${history}`));
const timeline = englishCalendarMonth ? rawTimeline : language === 'es'
  ? ({ today: 'hoy', 'this week': 'esta semana', 'this month': 'este mes', 'next week': 'próxima semana', 'next month': 'próximo mes', 'within 30 days': 'en 30 días', 'exploring options': 'explorando opciones', january: 'enero', february: 'febrero', march: 'marzo', april: 'abril', may: 'mayo', june: 'junio', july: 'julio', august: 'agosto', september: 'septiembre', october: 'octubre', november: 'noviembre', december: 'diciembre' }[rawTimeline] || rawTimeline)
  : rawTimeline;
const hasRealVehicle = Boolean(vehicle) && !isAdvisorHandoffVehicle(vehicle);
const coreMissing = (sourceAware
  ? [!phone && !phoneSatisfiedByNative ? 'phone' : '', !hasRealVehicle ? 'vehicle_type' : '']
  : [!phone ? 'phone' : '', !hasRealVehicle ? 'vehicle_type' : ''])
  .filter(Boolean);
const qualificationMissing = [
  ...coreMissing,
  requiresLocation && !customerLocation ? 'customer_location' : '',
].filter(Boolean);
const parts = memoryText(rawMemory).split(';').map((part) => clean(part).replace(/^\d+(?=(?:vehicle|vehicle[_ ]?type|down|down[_ ]?payment|documents?|timeline)\b)/i, '')).filter((part) => Boolean(part) && !/^\$?\d[\d,.]*$/.test(part));
const canonical = [['real_name', realName], ['vehicle', vehicle], ['down payment', down], ['previous financing', effectivePreviousFinancing], ['documents', documents], ['timeline', timeline]].filter(([, value]) => value).map(([key, value]) => `${key}: ${String(value).replace(/\s*;\s*/g, ', ')}`);
const qualificationMemory = [...new Set([...parts.filter((part) => !/^(?:real_name|real name|name|nombre|nombre real|nombre completo|vehicle|vehicle_type|down|down payment|down_payment|previous financing|previous_financing|financing history|historial de financiamiento|documents?|docs|timeline|purchase timeline|purchase_timeline)\s*(?::|=|-)/i.test(part)), ...canonical])].join('; ');
const qualificationStep = sourceAware
  ? (!hasRealVehicle
      ? 'vehicle_type'
      : requiresLocation && !customerLocation
        ? 'customer_location'
        : !phone && !phoneSatisfiedByNative
          ? 'phone'
          : 'complete')
  : (!hasRealVehicle
        ? 'vehicle_type'
      : !phone
        ? 'phone'
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
const predictedBotQuestion = questions[language][qualificationStep];
const lastAnsweredField = qualificationStep === 'complete'
  ? 'phone'
  : (sourceAware
    ? [['real_name', stafford && Boolean(realName)], ['vehicle_type', hasRealVehicle], ['customer_location', Boolean(customerLocation)], ['phone', Boolean(phone) || phoneSatisfiedByNative], ['purchase_timeline', timeline], ['documents', identification === 'yes' && income === 'yes'], ['bank_account', bankAccount === 'yes']]
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
  vehicle_year: vehicleYear,
  customer_location: customerLocation,
  vehicle_category: vehicleCategory || null,
  required_down_payment: requiredDownPayment,
  down_payment_amount: downPaymentAmount,
  down_payment_sufficient: downPaymentSufficient,
  down_payment: down,
  previous_financing: effectivePreviousFinancing,
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
