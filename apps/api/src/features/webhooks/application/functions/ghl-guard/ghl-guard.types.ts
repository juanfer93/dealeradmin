import type { GhlGuardClient } from '../../ghl-guard.client';

export type GuardConversationRow = {
  id: string;
  ghl_location_id: string;
  ghl_contact_id: string;
  ghl_conversation_id: string | null;
  status: string;
};

export type PersistResult = {
  skipped: boolean;
  inserted: number;
  repaired: number;
};

export type LeadMetadataRow = {
  lead_id: string;
  ghl_contact_id: string;
  ghl_location_id: string;
  first_name: string | null;
  last_name: string | null;
  canonical_phone: string | null;
  email: string | null;
  source: string | null;
  qualification_snapshot: Record<string, unknown> | null;
  location_snapshot: Record<string, unknown> | null;
  dealer_relations: Array<Record<string, unknown>> | null;
};

export type GuardAuditRow = {
  id: string;
  status: string;
};

export type GhlGuardRunResult = {
  enabled: boolean;
  skipped: boolean;
  skipReason?: GhlGuardSkipReason;
  selected: number;
  fetched: number;
  inserted: number;
  repaired: number;
  failed: number;
  queuedReplaySelected?: number;
  queuedReplayCompleted?: number;
  queuedReplayFailed?: number;
  pendingQueuedReplayCount?: number;
  errors?: GhlGuardFailure[];
};

export type GhlGuardSkipReason =
  | 'disabled'
  | 'no_database'
  | 'already_running'
  | 'in_memory_interval'
  | 'advisory_lock';

export type GhlGuardFailure = {
  conversationId: string | null;
  ghlLocationId: string | null;
  ghlContactId: string | null;
  errorCode: string;
  errorMessage?: string;
};

export type GhlGuardClientPort = Pick<GhlGuardClient, 'listMessages'> & Partial<Pick<GhlGuardClient, 'searchConversationByContact'>>;

