import type { SourceConfigMap } from './conversation-webhook.types';

export const CONVERSATION_STABILIZATION_MS = 15_000;
export const WAITING_WINDOW_RETRY_INTERVAL_MS = 5 * 60 * 1000;
export const WAITING_WINDOW_MAX_ATTEMPTS = 5;
export const PARTIAL_RECOVERY_INTERVAL_MS = 30 * 60 * 1000;
export const PARTIAL_RECOVERY_MAX_ATTEMPTS = 10;
export const INCOMPLETE_QUALIFICATION_WINDOW_HOURS = 0.5;
export const OUT_OF_WINDOW_QUALIFICATION_WINDOW_HOURS = 3;
export const QUALIFICATION_RULE_TIMEZONE = 'America/Bogota';
export const DUE_CONVERSATION_POLL_MS = 30_000;
export const DUE_CONVERSATION_BATCH_SIZE = 5;
export const ACTIVE_RECONCILIATION_BATCH_SIZE = 25;
export const STALE_PHONE_REENTRY_DAYS = 3;
// Historical rows remain queryable and can be repaired explicitly, but the
// unattended watchdog is intentionally bounded to contacts active in the
// last 24 hours. This prevents an old conversation from being reintroduced by
// the safety net while still allowing recent inbound activity to recover it.
export const RECENT_AUTOMATION_WINDOW_MS = 24 * 60 * 60 * 1000;

export const GHL_SOURCE_CONFIG: SourceConfigMap = {
  stafford: { locationId: 'LiaoSID3nvAhad49ZpNJ', defaultChannel: 'whatsapp', supportedChannels: ['whatsapp'] },
  fredericksburg: { locationId: 'MyxWNKacThim798E8KC6', defaultChannel: 'messenger', supportedChannels: ['messenger'] },
  'fredericksburg-2': { locationId: 'bAuMEQeH48xAtu9tAMFf', defaultChannel: 'messenger', supportedChannels: ['messenger'] },
  easterns: { locationId: 'xN2LSSl62okzv9GnOJPU', defaultChannel: 'messenger', supportedChannels: ['messenger'] },
  arlington: { locationId: '9v8zH9Y5eLiiJwZTZDci', defaultChannel: 'messenger', supportedChannels: ['messenger'] },
  'koons-fred': { locationId: 'xuHo0opTO2g5edIuPJRl', defaultChannel: 'messenger', supportedChannels: ['messenger'] },
  'koons-fred-eng': { locationId: 'ozAIEblxTjrh0PfoaHge', defaultChannel: 'messenger', supportedChannels: ['messenger'] },
  'koons-culpeper': { locationId: 'bTNJHpNZ8FaS1PUHkuUq', defaultChannel: 'messenger', supportedChannels: ['messenger'] },
  'action-cars': { locationId: 'ZxadcudjvBz7KFCB1od4', defaultChannel: 'messenger', supportedChannels: ['messenger'], splitByLanguage: true },
  'easterns-millersville': { locationId: '113zMWQlhKKBUu5wOYtR', defaultChannel: 'messenger', supportedChannels: ['messenger'], alternatingGroup: 'easterns-millersville' },
  'easterns-frederick': { locationId: 'MRHcOwdTqaN5cug3eSWW', defaultChannel: 'messenger', supportedChannels: ['messenger'] },
};

export const RECONCILIATION_LOCATION_IDS = [...new Set(Object.values(GHL_SOURCE_CONFIG).map((config) => config.locationId))];
