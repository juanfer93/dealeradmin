import { clean, lastMeaningfulLine, memoryValue } from './text-cleaner';
import { extractTimeline } from './qualification-normalizer';
import { isWhatsAppChannel, collectorFlowPolicy } from './flow-policy';
import type { CollectorFlowPolicy, CollectorInput } from './types';
import {
  ECONOMIC_SEDAN_INTENT,
} from './collector-intents';

const PREVIOUS_FINANCING_QUESTION = /\b(?:has\s+financiado|han?\s+financiado|have\s+you\s+financed|did\s+you\s+finance|financ(?:ed|ing)\s+before|financiamiento\s+(?:de autos?|de un veh[ií]culo)|(?:ya|antes|anteriormente|previously|before)[^?\n]{0,80}(?:financ(?:e|ed|ing)|financiad[oa]))\b/i;
const PREVIOUS_FINANCING_YES = /(?:ya\s+he\s+financiad[oa]|he\s+financiad[oa]\s+antes|financi[eé]\s+antes|(?:ya|anteriormente)\s+financi[eé](?=\s|$|[,.;!?])|i\s+have\s+financed\s+before|i\s+financed\s+(?:a|an|the)\s+(?:vehicle|car)|financed\s+before|previous(?:ly)?\s+financ(?:ed|ing))/i;
const PREVIOUS_FINANCING_NO = /^(?:no(?=[\s,.;!?]|$)|nope|nah|nunca|jam[aá]s|never|not\s+before|no\s+(?:he\s+)?financiad[oa]|no\s+tengo\s+(?:historial|experiencia|financiamiento))/i;
const PREVIOUS_FINANCING_AFFIRMATIVE = /^(?:yes|yeah|yep|si|sí|sim|claro|correcto|tengo|have it|i do|i have|i can|i could|could|can|puedo|podr[ií]a|es posible|possible|con (?:este|ese) monto|(?:este|ese) monto|con (?:esta|esa) cantidad|(?:esta|esa) cantidad)(?=[\s,.;!?]|$)/i;

export function previousFinancingStatus(input: CollectorInput, rawHistory: string, rawMessage: string, memory: string): 'yes' | 'no' | '' {
  const predictorQuestion = clean(input.previous_predicted_bot_question ?? '');
  const historyQuestions = rawHistory.match(/[^?\n]*\?/g) ?? [];
  const latestTranscriptQuestion = clean(historyQuestions.at(-1) ?? '');
  const questionAsked = PREVIOUS_FINANCING_QUESTION.test(predictorQuestion || latestTranscriptQuestion);
  const latest = lastMeaningfulLine(rawMessage);
  if (questionAsked && PREVIOUS_FINANCING_NO.test(latest)) return 'no';
  if (questionAsked && PREVIOUS_FINANCING_AFFIRMATIVE.test(latest)) return 'yes';

  // Reconciliation only has inbound GHL messages; recover a standalone answer
  // from the transcript so an earlier answer is not lost during replay.
  if (questionAsked) {
    const historicalAnswers = rawHistory
      .replace(/\r\n?/g, '\n')
      .split(/\n+/)
      .map(clean)
      .filter((line) => line && !line.includes('?') && (PREVIOUS_FINANCING_NO.test(line) || PREVIOUS_FINANCING_AFFIRMATIVE.test(line)));
    const historicalAnswer = historicalAnswers.at(-1) ?? '';
    if (PREVIOUS_FINANCING_NO.test(historicalAnswer)) return 'no';
    if (PREVIOUS_FINANCING_AFFIRMATIVE.test(historicalAnswer)) return 'yes';
  }

  const historyLines = rawHistory.replace(/\r\n?/g, '\n').split(/\n+/).filter(Boolean);
  const priorHistory = historyLines.slice(0, -1).join('\n');
  const evidenceInput = predictorQuestion && !questionAsked ? priorHistory : rawMessage;
  const evidence = [evidenceInput, memory]
    .map((value) => String(value ?? '').replace(/\r\n?/g, '\n'))
    .flatMap((value) => value.split(/\n+/))
    .map(clean)
    .filter((line) => line && !line.includes('?'))
    .join('; ');
  if (PREVIOUS_FINANCING_NO.test(evidence) && !PREVIOUS_FINANCING_YES.test(evidence)) return 'no';
  if (PREVIOUS_FINANCING_YES.test(evidence)) return 'yes';
  const memoryAnswer = memoryValue(memory, ['previous_financing', 'previous financing', 'financing history', 'historial de financiamiento', 'has financed before']);
  if (/^(?:yes|si|sí|true)$/i.test(memoryAnswer)) return 'yes';
  if (/^(?:no|false)$/i.test(memoryAnswer)) return 'no';
  return '';
}

/** Recover Stafford's outbound financing answer from inbound-only history. */
export function recoverStaffordPreviousFinancing(rawHistory: string, policy: CollectorFlowPolicy, channel: string | null | undefined): 'yes' | '' {
  if (!policy.stafford || !isWhatsAppChannel(channel)) return '';
  const lines = rawHistory.replace(/\r\n?/g, '\n').split(/\n+/).map(clean).filter(Boolean);
  if (!ECONOMIC_SEDAN_INTENT.test(rawHistory) || !lines.some((line) => /^\$?1[,.]?000(?:\s+m[aá]xim(?:o|um))?$/i.test(line))) return '';
  const timelineIndex = lines.findIndex((line) => Boolean(extractTimeline(line)));
  const beforeTimeline = timelineIndex >= 0 ? lines.slice(0, timelineIndex) : lines;
  return beforeTimeline.some((line) => /^(?:yes|yeah|yep|si|sí|claro|correcto|tengo)$/i.test(line)) ? 'yes' : '';
}

export function recoverPreviousFinancing(input: CollectorInput, rawHistory: string, rawMessage: string, memory: string): 'yes' | 'no' | '' {
  const policy = collectorFlowPolicy(input);
  return previousFinancingStatus(input, rawHistory, rawMessage, memory)
    || recoverStaffordPreviousFinancing(rawHistory, policy, input.channel);
}
