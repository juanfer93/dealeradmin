const invalidRealNames = new Set(['.', '..', '...', 'unknown', 'n/a', 'na', 'lead', 'whatsapp', 'facebook', 'saludos', 'hello', 'hi', 'hey', 'hola', 'greetings', 'buenos dias', 'buenas tardes', 'buenas noches', 'bendiciones', 'buenos dias bendiciones', 'buenas tardes bendiciones', 'buenas noches bendiciones', 'thu chikitha linda']);
const qualificationResponseMarkers = /\b(?:today|hoy|asap|as soon as possible|immediately|inmediato|para ya|ahora mismo|now if possible|if possible now|ahora si se puede|si es posible ahora|lo m[aá]s pronto posible|lo antes posible|lo antes que pueda|this week|esta semana|this month|este mes|next week|pr[oó]xima? semana|next month|pr[oó]ximo mes|baltimore|maryland|where are you located|where are you|d[oó]nde est[aá]n ubicad[oa]s?|d[oó]nde est[aá]n|ubicaci[oó]n|ubicados?|vehicle|car|auto|carro|coche|veh[ií]culo|suv|sedan|truck|troca|pickup|pick-up|van|minivan|crossover|coupe|coupé|hatchback|motorcycle|moto|requirements?|requisitos?|yes|yeah|yep|correct|tengo|tiene|have it|i have|i'm looking|im looking|looking for|busco|buscando|quiero|want|interested|si|sí|no|no tengo|papeles?|cheques?|checks?|aplicar|apply|perfecto|perfect|claro|bien|bueno)\b/i;
const genericVehicleIntent = /\b(?:need|needs|looking\s+for|want|wants|seeking|shopping\s+for|trying\s+to\s+find|necesito|busco|buscando|quiero|me\s+interesa)\b[\s\S]*\b(?:vehicle|car|auto|carro|coche|veh[ií]culo|truck|suv|sedan|van|camioneta|pickup|pick-up)\b/i;
const inventoryIntent = /\b(?:inventory|inventario|see\s+(?:the\s+)?inventory|can\s+i\s+see|show\s+me|mu[eé]strame|ver\s+(?:el\s+)?inventario)\b/i;
const greetingOnly = /^(?:buenos\s+d[ií]as|buenas\s+tardes|buenas\s+noches|saludos|hello|hi|hey|hola|ola|greetings)(?:[,.!?\s]+bendiciones)?[,.!?\s]*$/i;
const singleWordNameBlocklist = /^(?:ok(?:ay)?|si|s[ií]|yes|no|yeah|yep|correct|cash|today|hoy|now|ahora|asap|inmediato|requirements?|requisitos?|information|informaci[oó]n|details?|detalles?|baltimore|maryland|virginia|laurel|rosedale|sterling|elkton|manda|nada|bale|vale|ubicaci[oó]n|ubicasion|tacoma|toyota|hummer|honda|ford|nissan|chevrolet|chevy|hyundai|kia|mazda|subaru|volkswagen|vw|jeep|ram|gmc|bmw|mercedes|audi|lexus|acura|volvo|tesla|dodge|chrysler|buick|cadillac|lincoln|infiniti|genesis|mini|porsche|jaguar|rivian|lucid|mitsubishi|pontiac|saturn|oldsmobile|fiat|suzuki|isuzu|scion|mustang|rav4|civic|accord|camry|corolla|highlander|sienna|4runner|tundra|sequoia|prius|avalon|maverick|ranger|bronco|explorer|expedition|escape|edge|pilot|passport|ridgeline|odyssey|sierra|silverado|tahoe|suburban|traverse|equinox|camaro|malibu|blazer|colorado|yukon|acadia|terrain|wrangler|gladiator|cherokee|compass|renegade|charger|challenger|durango|journey|caravan|pacifica|frontier|titan|rogue|pathfinder|altima|sentra|versa|maxima|armada|sportage|telluride|sorento|soul|rio|palisade|santa fe|tucson|elantra|sonata|veloster|wrx|forester|outback|ascent|impreza|atlas|tiguan|jetta|passat|cayenne|range rover|defender|suv|sedan|truck|troca|pickup|pick-up|van|minivan|crossover|coupe|coupé|hatchback|motorcycle|moto|camioneta|financiar|finance|financing|down|payment|enganche|documents?|documentos?|identificaci[oó]n|income|ingresos|proof|prueba|phone|tel[eé]fono|number|n[uú]mero)$/i;
const vehicleBrands = /\b(?:toyotas?|hummer|honda|ford|nissan|chevrolet|chevy|hyundai|kia|mazda|subarus?|suvarus?|volkswagen|vw|jeep|ram|gmc|bmw|mercedes|audi|lexus|acura|volvo|tesla|dodge|chrysler|buick|cadillac|lincoln|infiniti|genesis|mini|porsche|jaguar|land rover|rivian|lucid|mitsubishi|pontiac|saturn|oldsmobile|fiat|suzuki|isuzu|scion)\b/i;
const vehicleModels = /\b(?:grand caravan|grand cherokee|transit connect|promaster city|mustang|tacomas?|tacomos?|tacmas?|tecomas?|sti|rav\s*4|civic|civc|accord|camry|coroll?a|highlander|hilander|sienna|4\s*runner|for\s+runner|for\s+runer|tundra|sequoia|prius|avalon|f-?150|f-?250|f-?350|maverick|ranger|bronco|explorer|expedition|escape|edge|cr-?v|hr-?v|pilot|passport|ridgeline|odyssey|sierra|silverado|tahoe|suburban|traverse|equinox|camaro|malibu|blazer|colorado|yukon|acadia|terrain|wrangler|gladiator|cherokee|compass|renegade|charger|challenger|durango|journey|caravan|pacifica|frontier|titan|rogue|pathfinder|altima|sentra|versa|maxima|armada|sportage|telluride|sorento|soul|rio|palisade|santa fe|tucson|elantra|sonata|veloster|wrx|forester|outback|ascent|impreza|atlas|tiguan|jetta|passat|cayenne|rlx|model [3syx]|f-?type|range rover|defender|wrx|highlander)\b/i;
const vehicleCategories = /\b(?:suv|sedan|truck|truk|troca|trokita|troquita|troque|trokas|pickup|pick-up|van|minivan|crossover|coupe|coupé|hatchback|motorcycle|moto|camioneta|camionetq|camion|camión)\b/i;
const vehicleContext = /\b(?:tengo|tiene|tienen|have|has|i have|my vehicle is|mi (?:carro|auto|veh[ií]culo) es|estoy buscando|ando buscando|looking for|busco|buscando|quiero|want|interested in|interesado en)\b/i;
// Messenger may insert an emoji/punctuation into a compact-car answer, and
// Spanish speech-to-text commonly produces phonetic spellings such as
// "pek[e]no" or "chico". Keep these answers in the Sedan category.
const genericSedanIntent = /\b(?:small|compact|affordable|budget|economical)\s+(?:car|auto|coche|carro|vehicle)\b|\b(?:carro|auto|coche|veh[ií]culo)[\s\W_]{1,8}(?:pequeñ[oa]|pequen[oa]|peken[oa]|chic[oa])\b/i;
const economicCarIntent = /\b(?:carro|auto|coche|veh[ií]culo)\s+econ[oó]mic[oa]s?\b/i;
// Stafford's WhatsApp flow commonly answers the vehicle-type prompt with
// "Algo económico" followed by "Normal". Keep it as a sedan category during
// late GHL reconciliation instead of falling back to advisor handoff.
const economicSedanIntent = /\b(?:carro|auto|coche|veh[ií]culo|algo)\s+econ[oó]mic[oa]s?\b/i;
const familyPassengerVanIntent = /\b(?:algo\s+)?familiar\b[\s\S]{0,80}\bpasajeros?\b/i;
const noDownPaymentResponse = /\b(?:no(?:\s+\w+){0,3}\s+(?:down(?:\s+payment)?|enganche|pago\s+inicial|dinero)|sin\s+(?:down|enganche|pago\s+inicial)|zero\s+down|\$?0\s*(?:down|enganche|pago\s+inicial)?)\b/i;
const canonicalVehicleLabel = (value) => clean(value)
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
    if (/^f-?\d+$/.test(lower)) return lower.replace(/^f/, 'F-');
    return `${lower[0].toLocaleUpperCase()}${lower.slice(1)}`;
  }).join(' '));
const canonicalVehicleCategory = (value) => clean(value).replace(/\b(?:truk|troca|trokita|troquita|troque|trokas|camioneta|camionetq|camion|camión)\b/gi, 'truck');
// Trade-in requires affirmative intent. A campaign CTA such as "Quiero mi
// Auto con Eastern" is not evidence that the buyer has a vehicle to trade.
const tradeInLanguage = /\btrade[- ]?in\b|\b(?:carro|auto|veh[ií]culo)\s+como\s+enganche\b|\b(?:cambiar|cambio)\s+(?:(?:mi|el|de)\s+)?(?:veh[ií]culo|carro|auto|van|troca|camioneta|camion)\b|\bchange\s+(?:my\s+)?(?:vehicle|car|van|truck)\b|\b(?:entregar|entrego|entregue|dar|doy)\s+(?:(?:mi|el|de)\s+)?(?:veh[ií]culo|carro|auto|van|troca|camioneta|camion)\b|\b(?:and|y)\s+(?:my|mi)\s+(?:car|vehicle|van|truck|carro|auto|veh[ií]culo|troca|camioneta|camion)\b|\b(?:my|mi)\s+(?:car|vehicle|van|truck|carro|auto|veh[ií]culo|troca|camioneta|camion)\s+(?:for|para)\s+(?:trade(?:[- ]?in)?|entregar|cambiar|dar)\b|\b(?:my|mi)\s+(?:car|vehicle|van|truck|carro|auto|veh[ií]culo|troca|camioneta|camion|ban)\b[\s\S]{0,24}\b(?:\d{3,5}\s*(?:dollars?|d[oó]lares?)|down|payment|enganche)\b|\b(?:\d{3,5}\s*(?:dollars?|d[oó]lares?)|down|payment|enganche)\b[\s\S]{0,24}\b(?:my|mi)\s+(?:car|vehicle|van|truck|carro|auto|veh[ií]culo|troca|camioneta|camion|ban)\b/i;
const vehicleLabel = (value) => {
  let source = clean(value)
    .replace(/\b(?:19|20)\d{2}\b/g, ' ')
    .replace(/\b(?:tengo|tiene|tienen|have|has|i have|my vehicle is|mi (?:carro|auto|veh[ií]culo) es|estoy buscando|ando buscando|looking for|busco|buscando|quiero|want|interested in|interesado en)\b/gi, ' ')
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
    .replace(/\b(?:tengo|tiene|tienen|have|has|i have|my vehicle is|mi (?:carro|auto|veh[ií]culo) es|estoy buscando|ando buscando|looking for|busco|buscando|quiero|want|interested in|interesado en)\b/gi, ' ')
    .replace(/\b(?:a|an|un|una|my|mi|the|carro|auto|car|vehicle|veh[ií]culo)\b/gi, ' ')
    .replace(/[!?.,:;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return vehicleContext.test(candidate) || withoutContext.toLocaleLowerCase() === label.toLocaleLowerCase();
};
const phoneLikeText = (value) => {
