import { evaluateDownPayment, visibleDownPayment } from '../down-payment';
import { ADVISOR_HANDOFF_VEHICLE, EMPTY } from './constants';
import { extractPhone, extractRealNameFromText, extractDeclaredRealNameFromText, isLikelyBusinessName, isLikelyProfileDisplayName, isPhoneAreaCodeAmount, normalizeNativeWhatsappName, normalizeRealName, profileDisplayNameFromInput, profileNameFromInput, realNameFromQualificationMemory, whatsappProfileNameFallback } from './contact-normalizer';
import { detectLeadLanguage } from './language-normalizer';
import { collectorFlowPolicy, effectiveChannel, extractCustomerLocation, isAdvisorHandoffVehicle, isMessengerChannel, isWhatsAppChannel } from './flow-policy';
import { clean, conversationalEvidence, firstNonEmpty, lastMeaningfulLine, memoryText, memoryValue } from './text-cleaner';
import type { CollectorInput, CollectorLanguage, CollectorOutput, QualificationProgress, QualificationStep } from './types';
import { extractVehicleYear, isPossessiveVehicleStatement, normalizeVehicle } from './vehicle-normalizer';
import { extractTimeline, mergeDocuments, normalizeTimeline, yesNo } from './qualification-normalizer';
import { mergeMemory, normalizeMemoryDownPayment } from './qualification-memory';
import { isQualificationComplete, missingQualification as getMissingQualification, qualificationStep } from './reconciliation';
import { isCampaignButton, isNonVehicleIntent, stripCampaignButtonPhrases, TRADE_IN_INTENT } from './collector-intents';
import { recoverPreviousFinancing } from './financing-normalizer';
import { extractVehicle, inferVehicleIntent, isStaffordWhatsAppVehicleLabel } from './vehicle-extractor';
import { affirmativeDownConfirmation, extractDownPayment, extractLatestDownPayment, extractQuestionedDownPayment, extractStandaloneDownPayment, extractTradeInDownPayment, firstValidAmount, isConcatenatedVehicleYearAmount, normalizeAmount } from './down-payment-extractor';
import { extractLeadFormContext } from './form-normalizer';
import { inferVehicleIntent as inferConversationVehicleIntent } from './vehicle-intent';

export { hasMinimumRoutingQualification, isQualificationComplete } from './reconciliation';
export type { CollectorInput, CollectorLanguage, CollectorOutput, QualificationProgress, QualificationStep } from './types';
export { ADVISOR_HANDOFF_VEHICLE } from './constants';
export { RECENT_PHONE_EVIDENCE_DAYS } from './constants';
export { extractDeclaredRealNameFromText, extractRealNameFromText, extractRecentMessagePhone, isInvalidRealName, isValidRealName, normalizeRealName, realNameFromQualificationMemory, profileDisplayNameFromInput, whatsappProfileNameFallback } from './contact-normalizer';
export { detectLeadLanguage } from './language-normalizer';
export { isAdvisorHandoffVehicle } from './flow-policy';
export { isStaffordWhatsAppVehicleLabel } from './vehicle-extractor';
export { extractLeadFormContext } from './form-normalizer';
export type { LeadFormContext } from './form-normalizer';

export function normalizeCollectorInput(input: CollectorInput): CollectorOutput {
  const message = clean(input.message);
  const history = clean(input.chat_history_log);
  const memory = input.qualification_memory?.trim() ?? EMPTY;
  const rawMessage = String(input.message ?? '').replace(/\r\n?/g, '\n').trim();
  const rawHistory = String(input.chat_history_log ?? '').replace(/\r\n?/g, '\n').trim();
  const hasMemory = Boolean(memory);
  const hasCustomFields = [input.vehicle_type, input.down_payment, input.purchase_timeline, input.documents, input.identification, input.bank_account, input.real_name]
    .some((value) => Boolean(firstNonEmpty(value)));
  const qualificationSource = hasMemory && hasCustomFields ? 'both' : hasMemory ? 'qualification_memory' : hasCustomFields ? 'custom_fields' : 'none';
  const languageText = [history, message].filter(Boolean).join('\n');
  const language = languageText ? detectLeadLanguage(languageText) : 'en';
  const policy = collectorFlowPolicy(input);
  const customerLocation = extractCustomerLocation(input, languageText);
  const campaignReply = isCampaignButton(message);
  const messageForExtraction = stripCampaignButtonPhrases(rawMessage);
  const historyForExtraction = stripCampaignButtonPhrases(rawHistory);
  const channel = effectiveChannel(input);
  const formContext = String(input.source ?? '').toLowerCase() === 'carhub'
    ? extractLeadFormContext([rawHistory, rawMessage].filter(Boolean).join('\n'))
    : null;

  const invalidRealNames = input.invalid_real_names ?? [];
  const suppliedName = normalizeRealName(input.real_name, invalidRealNames);
  const profileDisplayName = profileDisplayNameFromInput(input, invalidRealNames);
  const profileName = profileNameFromInput(input, isMessengerChannel(channel), invalidRealNames);
  const whatsappProfileName = firstNonEmpty(input.profile?.name);
  const whatsappProfileFallback = isWhatsAppChannel(channel) ? whatsappProfileNameFallback(whatsappProfileName, invalidRealNames) : EMPTY;
  const whatsappContactFallback = !isWhatsAppChannel(channel)
    || /^lead$/i.test(firstNonEmpty(input.contact_name, input.contactName, input.profile?.name, input.name))
    ? EMPTY
    : firstNonEmpty(whatsappProfileName, input.contact_name, input.contactName, input.name);
  const extractedNames = [realNameFromQualificationMemory(memory, invalidRealNames), extractRealNameFromText(rawMessage, { invalidRealNames }), extractRealNameFromText(rawHistory, { invalidRealNames })];
  const nativeWhatsappName = isStaffordWhatsAppVehicleLabel(whatsappContactFallback, input.source, channel)
    ? EMPTY
    : normalizeNativeWhatsappName(whatsappContactFallback, invalidRealNames);
  const whatsappNames = [
    extractRealNameFromText(rawMessage, { onlyAfterNameQuestion: true, invalidRealNames }),
    extractRealNameFromText(rawHistory, { onlyAfterNameQuestion: true, invalidRealNames }),
    nativeWhatsappName,
    whatsappProfileFallback,
    profileName,
  ];
  const messengerNameAnswers = [rawMessage, rawHistory].flatMap((transcript) => {
    const lines = transcript.split(/\n+/).map((line) => line.trim());
    const answers: string[] = [];
    let promptWindow = 0;
    for (const line of lines) {
      if (/__NAME_PROMPT__|(?:what(?:'s| is)?\s+(?:your|the)\s+name|full\s+name|what\s+should\s+i\s+call|how\s+do\s+you\s+(?:call|go by)|c[oó]mo\s+te\s+llamas|cu[aá]l\s+es\s+tu\s+nombre|dime\s+tu\s+nombre)/i.test(line)) {
        promptWindow = 8;
        continue;
      }
      if (promptWindow > 0) {
        promptWindow -= 1;
        if (/\b(?:i(?:'m| am)|soy|estoy)\s+(?:retired|working|looking|busy|interested|available|ready|fine|good|okay|ok|between|single|married)\b/i.test(line)) continue;
        const declared = extractDeclaredRealNameFromText(line);
        if (declared) answers.push(declared);
        else if (/^[\p{L}][\p{L}'’-]*(?:\s+[\p{L}][\p{L}'’-]*){1,3}$/u.test(line)) answers.push(line);
      }
    }
    return answers;
  });
  const messengerDeclaredName = messengerNameAnswers.map((candidate) => normalizeRealName(candidate)).find(Boolean) ?? EMPTY;
  const realName = isMessengerChannel(channel)
    ? formContext?.full_name || messengerDeclaredName || profileDisplayName || suppliedName
    : isWhatsAppChannel(channel)
      ? whatsappNames.map((candidate) => candidate === whatsappProfileFallback && whatsappProfileFallback
        ? whatsappProfileFallback
        : candidate === nativeWhatsappName && nativeWhatsappName
        ? nativeWhatsappName
        : isStaffordWhatsAppVehicleLabel(candidate, input.source, channel) ? EMPTY : normalizeRealName(candidate, invalidRealNames)).find(Boolean) ?? EMPTY
      : (isLikelyBusinessName(suppliedName) || isLikelyProfileDisplayName(suppliedName) ? [...extractedNames, suppliedName] : [suppliedName, ...extractedNames]).map((candidate) => normalizeRealName(candidate)).find(Boolean) ?? EMPTY;

  const chatPhone = extractPhone(input.chat_history_log) || extractPhone(input.message) || extractPhone(input.phone);
  const phoneFromConversation = extractPhone(input.chat_history_log) || extractPhone(input.message);
  const memoryDown = normalizeMemoryDownPayment(memoryValue(memory, ['down payment', 'down_payment', 'downpayment']), normalizeAmount, TRADE_IN_INTENT);
  const inputDown = clean(input.down_payment ?? EMPTY);
  const vehicleSource = [historyForExtraction, messageForExtraction].filter(Boolean).join('\n');
  const vehicleIntent = inferConversationVehicleIntent(historyForExtraction, messageForExtraction);
  const transcriptVehicle = extractVehicle(vehicleSource);
  const vehicleOwnedWithoutPurchaseIntent = !transcriptVehicle
    && vehicleSource.split(/\n+/).some((line) => isPossessiveVehicleStatement(line));
  const explicitVehicle = normalizeVehicle(firstNonEmpty(
    formContext?.vehicle,
    transcriptVehicle,
    vehicleOwnedWithoutPurchaseIntent ? EMPTY : [memoryValue(memory, ['vehicle_type', 'vehicle', 'type']), [memoryValue(memory, ['make', 'brand', 'marca']), memoryValue(memory, ['model', 'vehicle_model', 'modelo'])].filter(Boolean).join(' ')].filter(Boolean).join(' — '),
    vehicleOwnedWithoutPurchaseIntent ? EMPTY : memoryValue(memory, ['vehicle', 'vehicle_type']),
    vehicleOwnedWithoutPurchaseIntent ? EMPTY : input.vehicle_type,
  ), isCampaignButton, isNonVehicleIntent);
  const extractedVehicle = inferVehicleIntent(vehicleSource, explicitVehicle);
  const hasExistingAdvisorMarker = [memoryValue(memory, ['vehicle_type', 'vehicle', 'type']), input.vehicle_type].some((value) => isAdvisorHandoffVehicle(value));
  const transcriptVehicleYear = extractVehicleYear(vehicleSource);
  const formVehicleYear = extractVehicleYear(formContext?.vehicle ?? EMPTY);
  const vehicleYear = formContext?.vehicle
    ? formVehicleYear
    : [transcriptVehicleYear, ...(transcriptVehicle || vehicleOwnedWithoutPurchaseIntent ? [] : [extractVehicleYear(input.vehicle_type), extractVehicleYear(memoryValue(memory, ['vehicle_type', 'vehicle', 'type']))])].find((value): value is number => value !== null) ?? null;
  const vehicleBase = extractedVehicle || (hasExistingAdvisorMarker || phoneFromConversation || (isWhatsAppChannel(input.channel) && chatPhone) ? ADVISOR_HANDOFF_VEHICLE : EMPTY);
  const vehicle = vehicleBase && vehicleYear !== null && !isAdvisorHandoffVehicle(vehicleBase) ? `${vehicleBase} ${vehicleYear}` : vehicleBase;
  const hasRealVehicle = Boolean(vehicle) && !isAdvisorHandoffVehicle(vehicle);

  const explicitCashDown = firstValidAmount(extractLatestDownPayment(rawMessage), extractDownPayment(messageForExtraction), rawHistory.includes('__DOWN_PROMPT__') ? extractDownPayment(historyForExtraction) : EMPTY, extractLatestDownPayment(rawHistory));
  const latestInboundMessage = lastMeaningfulLine(messageForExtraction);
  const previousFinancing = recoverPreviousFinancing(input, rawHistory, rawMessage, memory);
  const confirmedQuestionDown = affirmativeDownConfirmation(latestInboundMessage) ? firstNonEmpty(extractQuestionedDownPayment(rawHistory), extractQuestionedDownPayment(input.previous_predicted_bot_question ?? EMPTY)) : EMPTY;
  const cashDownCandidate = firstValidAmount(
    explicitCashDown,
    confirmedQuestionDown,
    extractStandaloneDownPayment(rawMessage),
    extractStandaloneDownPayment(rawHistory),
    isPhoneAreaCodeAmount(memoryDown, chatPhone) || (vehicleYear !== null && (normalizeAmount(memoryDown) === String(vehicleYear) || isConcatenatedVehicleYearAmount(normalizeAmount(memoryDown), vehicleYear))) ? EMPTY : memoryDown,
    campaignReply || isPhoneAreaCodeAmount(inputDown, chatPhone) || (vehicleYear !== null && (normalizeAmount(inputDown) === String(vehicleYear) || isConcatenatedVehicleYearAmount(normalizeAmount(inputDown), vehicleYear))) ? EMPTY : inputDown,
  );
  const cashDown = isPhoneAreaCodeAmount(cashDownCandidate, chatPhone) && !explicitCashDown
    ? EMPTY
    : isConcatenatedVehicleYearAmount(normalizeAmount(cashDownCandidate), vehicleYear)
      ? EMPTY
      : cashDownCandidate;
  const tradeDown = firstValidAmount(extractTradeInDownPayment(messageForExtraction), extractTradeInDownPayment(historyForExtraction), extractTradeInDownPayment(memoryText(memory)));
  const baseDown = cashDown || tradeDown;
  const conversationalSource = [clean(historyForExtraction), messageForExtraction].filter(Boolean).join('; ');
  let down = baseDown && TRADE_IN_INTENT.test(conversationalSource) && !/trade[- ]?in/i.test(baseDown) ? `${baseDown} + trade-in` : baseDown;
  down = visibleDownPayment(down, input.source);
  const downPaymentRule = evaluateDownPayment(vehicle, down);

  const transcriptTimeline = firstNonEmpty(extractTimeline(messageForExtraction), extractTimeline(history));
  const normalizedTimeline = normalizeTimeline(firstNonEmpty(formContext?.purchase_timeline, transcriptTimeline, extractTimeline(memoryText(memory)), memoryValue(memory, ['timeline', 'purchase timeline', 'purchase_timeline']), input.purchase_timeline), language);
  const timelineValue = language === 'es' && normalizedTimeline === 'today' ? 'hoy' : normalizedTimeline || clean(formContext?.purchase_timeline);
  const nameMonthCollision = !formContext?.purchase_timeline
    && !transcriptTimeline
    && Boolean(realName)
    && realName.trim().toLocaleLowerCase() === timelineValue.trim().toLocaleLowerCase()
    && normalizeTimeline(realName, language).toLocaleLowerCase() === timelineValue.trim().toLocaleLowerCase();
  const timeline = nameMonthCollision ? EMPTY : timelineValue;
  const memoryDocumentFacts = [memoryValue(memory, ['documents']), memoryValue(memory, ['identification', 'id', 'itin', 'passport', 'pasaporte']) ? `identification: ${memoryValue(memory, ['identification', 'id', 'itin', 'passport', 'pasaporte'])}` : EMPTY, memoryValue(memory, ['proof of income', 'income proof', 'prueba de ingresos', 'comprobante de ingresos']) ? `proof of income: ${memoryValue(memory, ['proof of income', 'income proof', 'prueba de ingresos', 'comprobante de ingresos'])}` : EMPTY].filter(Boolean).join('; ');
  const docs = mergeDocuments(firstNonEmpty(memoryDocumentFacts, input.documents), [rawHistory, rawMessage].filter(Boolean).join('\n'));
  const identification = firstNonEmpty(docs.id, memoryValue(memory, ['identification', 'id']), input.identification);
  const bankEvidenceSource = conversationalEvidence(rawHistory, rawMessage);
  const bankAccountNegative = /\b(?:no|sin)\s+(?:tengo|have)\s+(?:una?\s+)?(?:bank account|cuenta bancaria|cuenta de banco)\b/i.test(bankEvidenceSource);
  const bankAccountPositive = /\b(?:yes|sí|si|yeah|yep|correct|tengo|i\s+(?:have|do(?:\s+have)?))\b[^;!?]{0,50}\b(?:a\s+|an\s+|una?\s+)?(?:bank account|cuenta bancaria|cuenta de banco)\b/i.test(bankEvidenceSource);
  const bankAccountEvidence = bankAccountPositive ? 'yes' : bankEvidenceSource.match(/(?:bank account|cuenta bancaria|cuenta de banco)\s*(?:is|are|:|=)?\s*(yes|sí|si|yeah|yep|correct|tengo|have it|i do|i have|available|no|not|sin|dont|don't|no tengo|i do not|do not have|not available)\b/i)?.[1] ?? (bankAccountNegative ? 'no' : '');
  const bankAccount = yesNo(firstNonEmpty(input.bank_account, bankAccountEvidence, memoryValue(memory, ['bank account', 'bank_account', 'cuenta bancaria', 'cuenta de banco'])));
  const mergedMemory = mergeMemory(memory, { real_name: realName, vehicle: vehicleOwnedWithoutPurchaseIntent ? EMPTY : vehicle, 'down payment': down, previous_financing: previousFinancing, documents: docs.value, timeline });

  const step: QualificationStep = qualificationStep(hasRealVehicle, policy.requiresLocation, customerLocation, policy.phoneSatisfiedByNative || Boolean(chatPhone));
  const questions: Record<CollectorLanguage, Record<QualificationStep, string>> = {
    en: { real_name: 'What is your full name?', vehicle_type: 'What vehicle are you looking for?', customer_location: 'What city are you located in?', phone: "What's the best phone number to reach you?", down_payment: 'How much do you have for the down payment?', purchase_timeline: 'When are you planning to buy?', documents: 'Do you have identification and proof of income?', bank_account: 'Do you have a bank account?', complete: EMPTY },
    es: { real_name: '¿Cuál es tu nombre completo?', vehicle_type: '¿Qué vehículo estás buscando?', customer_location: '¿En qué ciudad te encuentras?', phone: '¿Cuál es el mejor número para contactarte?', down_payment: '¿Cuánto tienes para el enganche?', purchase_timeline: '¿Cuándo planeas comprar?', documents: '¿Tienes identificación y comprobante de ingresos?', bank_account: '¿Tienes una cuenta bancaria?', complete: EMPTY },
  };
  const nextQuestion = questions[language][step];
  const completedOrder: Array<[string, boolean]> = policy.sourceAware ? [['real_name', Boolean(realName)], ['vehicle_type', hasRealVehicle], ['customer_location', Boolean(customerLocation)], ['phone', Boolean(chatPhone) || policy.phoneSatisfiedByNative]] : [['real_name', Boolean(realName)], ['phone', Boolean(chatPhone)], ['vehicle_type', hasRealVehicle]];
  const lastAnsweredField = [...completedOrder].reverse().find(([, complete]) => complete)?.[0] ?? null;
  const qualificationProgress: QualificationProgress = { step, last_answered_field: step === 'complete' ? 'phone' : lastAnsweredField, predicted_bot_question: nextQuestion, language, confidence: step === 'complete' ? 1 : 0.95, evidence: step === 'complete' ? 'complete' : 'normalized_fields' };
  const qualificationComplete = isQualificationComplete({ real_name: realName, phone: chatPhone || (policy.phoneSatisfiedByNative ? 'native-whatsapp' : EMPTY), vehicle_type: vehicle, down_payment: down, purchase_timeline: timeline, has_identification: docs.id, has_income_proof: docs.income, bank_account: bankAccount }) && (!policy.requiresLocation || Boolean(customerLocation));
  const missingQualification = getMissingQualification(policy.phoneSatisfiedByNative || Boolean(chatPhone) ? 'provided' : EMPTY, hasRealVehicle, policy.requiresLocation, customerLocation);
  return {
    real_name: realName, vehicle_type: vehicle, vehicle_intent: vehicleIntent, vehicle_owned_without_purchase_intent: vehicleOwnedWithoutPurchaseIntent, vehicle_year: vehicleYear, customer_location: customerLocation,
    vehicle_category: downPaymentRule.category, required_down_payment: downPaymentRule.minimum, down_payment_amount: downPaymentRule.amount, down_payment_sufficient: downPaymentRule.meetsMinimum,
    down_payment: down, previous_financing: previousFinancing, purchase_timeline: timeline, documents: docs.value, identification, bank_account: bankAccount,
    qualification_memory: mergedMemory, has_identification: docs.id, has_income_proof: docs.income, next_question: nextQuestion, qualification_step: step,
    qualification_progress: qualificationProgress, qualification_complete: qualificationComplete, missing_qualification: missingQualification, qualification_source: qualificationSource, form_context: formContext,
    phone: chatPhone,
    chat_history_log: [clean(input.chat_history_log), clean(input.message)].filter((value, index, values) => value && values.findIndex((item) => item.toLowerCase() === value.toLowerCase()) === index).join('\n'),
    dealeradmin_send_now: qualificationComplete && Boolean(chatPhone),
  };
}
