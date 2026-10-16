import type { SourceKey } from './functions/conversation-webhook.types';

export const GHL_GUARD_LOCK_KEY = 'dealeradmin.ghl.guard.v1';
export const GHL_GUARD_DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
export const GHL_GUARD_DEFAULT_BATCH_SIZE = 5;
export const GHL_GUARD_MAX_BATCH_SIZE = 5;
export const GHL_GUARD_DEFAULT_CONCURRENCY = 4;
export const GHL_GUARD_DEFAULT_STALE_LOG_MS = 30 * 60 * 1000;
export const GHL_GUARD_DEFAULT_TIMEOUT_MS = 10_000;
export const GHL_GUARD_MAX_TIMEOUT_MS = 15_000;

export const GHL_GUARD_TOKEN_ENV_BY_SOURCE: Record<SourceKey, string> = {
  stafford: 'GHL_PRIVATE_TOKEN_STAFFORD',
  fredericksburg: 'GHL_PRIVATE_TOKEN_FREDERICKSBURG',
  'fredericksburg-2': 'GHL_PRIVATE_TOKEN_FREDERICKSBURG_2',
  easterns: 'GHL_PRIVATE_TOKEN_EASTERNS',
  arlington: 'GHL_PRIVATE_TOKEN_ARLINGTON',
  'koons-fred': 'GHL_PRIVATE_TOKEN_KOONS_FRED',
  'koons-fred-eng': 'GHL_PRIVATE_TOKEN_KOONS_FRED_ENG',
  'koons-culpeper': 'GHL_PRIVATE_TOKEN_KOONS_CULPEPER',
  'action-cars': 'GHL_PRIVATE_TOKEN_ACTION_CARS',
  'easterns-millersville': 'GHL_PRIVATE_TOKEN_EASTERNS_MILLERSVILLE',
  'easterns-frederick': 'GHL_PRIVATE_TOKEN_EASTERNS_FREDERICK',
};

export function ghlGuardEnabled(): boolean {
  const configured = process.env.GHL_GUARD_ENABLED?.trim().toLowerCase();
  if (configured === 'true') return true;
  if (configured === 'false') return false;
  return process.env.NODE_ENV === 'production';
}

export function ghlGuardIntervalMs(): number {
  const value = Number(process.env.GHL_GUARD_INTERVAL_MS ?? GHL_GUARD_DEFAULT_INTERVAL_MS);
  return Number.isInteger(value) && value > 0 ? value : GHL_GUARD_DEFAULT_INTERVAL_MS;
}

export function ghlGuardBatchSize(): number {
  const value = Number(process.env.GHL_GUARD_BATCH_SIZE ?? GHL_GUARD_DEFAULT_BATCH_SIZE);
  return Number.isInteger(value) && value > 0 ? Math.min(value, GHL_GUARD_MAX_BATCH_SIZE) : GHL_GUARD_DEFAULT_BATCH_SIZE;
}

export function ghlGuardConcurrency(): number {
  const value = Number(process.env.GHL_GUARD_CONCURRENCY ?? GHL_GUARD_DEFAULT_CONCURRENCY);
  return Number.isInteger(value) && value > 0 ? Math.min(value, ghlGuardBatchSize()) : GHL_GUARD_DEFAULT_CONCURRENCY;
}

export function ghlGuardTimeoutMs(): number {
  const value = Number(process.env.GHL_GUARD_TIMEOUT_MS ?? GHL_GUARD_DEFAULT_TIMEOUT_MS);
  return Number.isInteger(value) && value > 0 ? Math.min(value, GHL_GUARD_MAX_TIMEOUT_MS) : GHL_GUARD_DEFAULT_TIMEOUT_MS;
}

export function ghlGuardStaleLogMs(): number {
  const value = Number(process.env.GHL_GUARD_STALE_LOG_MS ?? GHL_GUARD_DEFAULT_STALE_LOG_MS);
  return Number.isInteger(value) && value > 0 ? value : GHL_GUARD_DEFAULT_STALE_LOG_MS;
}
