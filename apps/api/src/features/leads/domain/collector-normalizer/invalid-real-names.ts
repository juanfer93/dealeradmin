/**
 * Conversation/profile values that must never become a buyer's real name.
 *
 * Keep this catalog declarative: adding a new production false-positive should
 * require one entry here, not another mutation inside the normalizer flow.
 */
const INVALID_REAL_NAME_VALUES = [
  // GHL/system placeholders.
  '.', '..', '...', 'unknown', 'n/a', 'na', 'lead', 'location', 'whatsapp', 'facebook',
  'opportunity created', 'employee action log created', 'dnd enabled by customer',

  // Greetings and conversational acknowledgements.
  'for sure', 'sorry', 'hola le saluda', 'le saluda', 'les saluda', 'mañana', 'manana', 'mkt',
  'saludos', 'hello', 'hi', 'hey', 'hola', 'ola', 'greetings', 'buen dia', 'buen día',
  'buen dis', 'buenos dias', 'buenos días', 'buenas tardes', 'buenas noches',
  'bendiciones', 'buenos dias bendiciones', 'buenas tardes bendiciones',
  'buenas noches bendiciones', 'solo whatsapp', 'solo whasap', 'thu chikitha linda',
  'primera vez', 'exacto', 'exactamente', 'stop', 'estaré pendiente', 'estare pendiente',

  // Qualification answers and prompts.
  'in pa', 'in messenger', 'tienes tacomas', 'información', 'informacion', 'más información',
  'mas informacion', 'más info', 'mas info', 'more information', 'more info', 'details',
  'detalles', 'como asi', 'como así', 'cómo asi', 'cómo así', 'how so',
  'what do you mean', 'me lo puede explicar', 'me puede explicar', 'me lo puedes explicar',
  'me puedes explicar', 'mes', 'estoy', 'estoy trabajando luego chat', 'trabajando luego chat',
  'usada', 'usado', 'usadas', 'usados', 'disculpe son un dealer', 'para aprobar', 'precio',
  'nose depende cuánto pidan', 'nose depende cuanto pidan', 'no sé depende cuánto pidan',
  'no se depende cuanto pidan', 'español', 'espanol', 'inglés', 'ingles', 'itin',
  'excelente señorita', 'licencia y social', 'licencia y tax id', 'licencia y taxid',
  'pero madame fotos', 'madame fotos',
] as const;

export const INVALID_REAL_NAMES = new Set<string>(INVALID_REAL_NAME_VALUES);

export function isInvalidRealName(value: string | null | undefined): boolean {
  return INVALID_REAL_NAMES.has(value?.trim().toLowerCase() ?? '');
}
