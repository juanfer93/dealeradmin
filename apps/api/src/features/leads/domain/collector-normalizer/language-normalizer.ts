import type { CollectorLanguage } from './types';
import { clean } from './text-cleaner';

const ENGLISH_LANGUAGE_SIGNALS = [
  /\b(?:i|i'm|im|my|want|wants|need|looking|have|this|next|today|where|what|can|with|and|the|yes|yeah|yep|do|does|when|how)\b/gi,
  /\b(?:proof of income|bank account|driver(?:'s)? license|this month|next month|more information|requirements?)\b/gi,
];

const SPANISH_LANGUAGE_SIGNALS = [
  /\b(?:yo|mi|quiero|quiere|necesito|busco|tengo|este|esta|hoy|donde|qué|que|con|y|el|la|los|las)\b/gi,
  /\b(?:prueba de ingresos|cuenta bancaria|licencia de conducir|este mes|pr[oó]ximo mes|más información|requisitos?)\b/gi,
];

function languageScore(source: string, signals: RegExp[]): number {
  return signals.reduce((score, signal) => score + (source.match(signal)?.length ?? 0), 0);
}

/** Detect the language of a conversation without treating a vehicle label as language evidence. */
export function detectLeadLanguage(value: string | null | undefined): CollectorLanguage {
  const source = clean(value).toLocaleLowerCase();
  if (!source) return 'es';
  const englishScore = languageScore(source, ENGLISH_LANGUAGE_SIGNALS);
  const spanishScore = languageScore(source, SPANISH_LANGUAGE_SIGNALS);
  return englishScore > spanishScore ? 'en' : 'es';
}
