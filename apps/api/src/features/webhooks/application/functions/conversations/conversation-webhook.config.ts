import type { SourceConfigMap } from './conversation-webhook.types';

export const CONVERSATION_STABILIZATION_MS = 15_000;
export const WAITING_WINDOW_RETRY_INTERVAL_MS = 5 * 60 * 1000;
export const WAITING_WINDOW_MAX_ATTEMPTS = 5;
export const INCOMPLETE_QUALIFICATION_WINDOW_HOURS = 0.5;
export const OUT_OF_WINDOW_QUALIFICATION_WINDOW_HOURS = 3;
export const QUALIFICATION_RULE_TIMEZONE = 'America/Bogota';
export const DUE_CONVERSATION_POLL_MS = 30_000;
export const DUE_CONVERSATION_BATCH_SIZE = 5;
export const ACTIVE_RECONCILIATION_BATCH_SIZE = 25;
export const STALE_PHONE_REENTRY_DAYS = 3;

export const GHL_SOURCE_CONFIG: SourceConfigMap = {
  stafford: { locationId: 'LiaoSID3nvAhad49ZpNJ', defaultChannel: 'whatsapp', supportedChannels: ['whatsapp', 'messenger'] },
  fredericksburg: { locationId: 'MyxWNKacThim798E8KC6', defaultChannel: 'messenger' },
  'fredericksburg-2': { locationId: 'bAuMEQeH48xAtu9tAMFf', defaultChannel: 'messenger' },
  easterns: { locationId: 'xN2LSSl62okzv9GnOJPU', defaultChannel: 'messenger' },
  arlington: { locationId: '9v8zH9Y5eLiiJwZTZDci', defaultChannel: 'messenger' },
  'koons-fred': { locationId: 'xuHo0opTO2g5edIuPJRl', defaultChannel: 'messenger' },
  'koons-fred-eng': { locationId: 'ozAIEblxTjrh0PfoaHge', defaultChannel: 'messenger' },
  'koons-culpeper': { locationId: 'bTNJHpNZ8FaS1PUHkuUq', defaultChannel: 'messenger' },
  'action-cars': { locationId: 'ZxadcudjvBz7KFCB1od4', defaultChannel: 'messenger', splitByLanguage: true },
  'easterns-millersville': { locationId: '113zMWQlhKKBUu5wOYtR', defaultChannel: 'messenger', alternatingGroup: 'easterns-millersville' },
  'easterns-frederick': { locationId: 'MRHcOwdTqaN5cug3eSWW', defaultChannel: 'messenger' },
};

export const RECONCILIATION_LOCATION_IDS = [...new Set(Object.values(GHL_SOURCE_CONFIG).map((config) => config.locationId))];
