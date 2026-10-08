  const candidate = clean(value);
  const digits = candidate.replace(/\D/g, '');
  return /\b(?:mi|my)\s+(?:n[uú]mero|number|phone|tel[eé]fono|telephone|contact)\b/i.test(candidate)
    || digits.length >= 7;
};
const nameDeclaration = /(?:me llamo|mi nombre es|soy|yo soy|my name is|my name['’]s|i am|i['’]m|this is|call me(?!\s+at\b)|ll[aá]mame)\s+([a-záéíóúüñ][a-záéíóúüñ' -]{1,80})/i;
const realNameToken = "[\\p{L}\\p{M}]+(?:[-'][\\p{L}\\p{M}]+)*";
const realNamePattern = new RegExp(`^${realNameToken}(?:\\s+${realNameToken})*$`, 'u');
const technicalNameLabel = /^(?:precio|price)\s+(?:de|of)\b/i;
const locationResponse = /^(?:estoy|vivo)\s+en\b/i;
const nameSuffixPunctuation = /\b(jr|sr|ii|iii|iv|v)\.(?=\s|,|$)/gi;
const normalizeNameSuffixPunctuation = (value) => clean(value).replace(nameSuffixPunctuation, '$1').replace(/,\s*$/, '').trim();
for (const technicalName of ['location', 'información', 'informacion', 'más información', 'mas informacion', 'más info', 'mas info', 'more information', 'more info', 'details', 'detalles']) invalidRealNames.add(technicalName);
const isValidRealName = (value) => {
  const candidate = normalizeNameSuffixPunctuation(value);
  return Boolean(candidate && realNamePattern.test(candidate) && candidate.split(/\s+/).every((token) => token.toLocaleLowerCase() === 'y' || token.replace(/[-']/g, '').length >= 2));
};
const normalizeRealName = (value) => {
  const candidate = normalizeNameSuffixPunctuation(value);
  if (!candidate || invalidRealNames.has(candidate.toLowerCase()) || phoneLikeText(candidate) || !isValidRealName(candidate) || technicalNameLabel.test(candidate) || locationResponse.test(candidate) || singleWordNameBlocklist.test(candidate) || qualificationResponseMarkers.test(candidate) || genericVehicleIntent.test(candidate) || inventoryIntent.test(candidate) || greetingOnly.test(candidate) || isVehicleStatement(candidate)) return '';
  if (candidate.length > 100 || candidate.split(/\s+/).length > 5) return '';
  return formatPersonalName(candidate);
};
const isMessengerChannel = (value) => /(?:^|[^a-z])(?:messenger|facebook)(?:$|[^a-z])/i.test(clean(value));
const isWhatsAppChannel = (value) => /(?:^|[^a-z])whats?app(?:$|[^a-z])/i.test(clean(value));
const effectiveChannel = (input) => {
  const channel = clean(input.channel);
  if (channel) return channel;
  const source = clean(input.source);
  return /(?:^|[^a-z])(?:messenger|facebook|whats?app)(?:$|[^a-z])/i.test(source) ? source : '';
};
const isBusinessName = (value) => /\b(?:auto\s*sales|motors?|dealership|dealer|llc|inc(?:orporated)?|corp(?:oration)?|company|tatuajes?|tattoos?|operaciones?|operations?|transport(?:ation)?|logistics|construction|remodeling|roofing|realty|consulting|services?|servicios?|shop|tienda|salon|barbershop|restaurant)\b/i.test(clean(value));
const isProfileDisplayName = (value) => nameDeclaration.test(clean(value)) || !isValidRealName(value);
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
  nameFromText(rawMessage),
  nameFromText(rawHistory),
  contactName,
  memoryValue(['real_name', 'real name', 'customer_name', 'customer name', 'contact_name', 'contact name', 'full_name', 'full name', 'name', 'nombre_real', 'nombre real', 'nombre completo', 'nombre']),
];
const realName = isMessengerChannel(channel)
  ? (messengerProfileName && !isBusinessName(messengerProfileName)
    ? messengerProfileName
    : declaredNameFromText(rawMessage) || declaredNameFromText(rawHistory) || extractedNames.map(normalizeRealName).find(Boolean) || messengerProfileName || '')
  : isWhatsAppChannel(channel)
    ? whatsappNames.map(normalizeRealName).find(Boolean) || ''
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
