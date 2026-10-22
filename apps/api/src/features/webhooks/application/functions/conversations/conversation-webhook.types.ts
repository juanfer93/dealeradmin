import type { GhlCustomerRepliedDto } from '@dealeradmin/contracts';
import type { CollectorLanguage, QualificationProgress } from '../../../../leads/domain/collector-normalizer';

export type SourceKey = 'stafford' | 'fredericksburg' | 'fredericksburg-2' | 'easterns' | 'arlington' | 'koons-fred' | 'koons-fred-eng' | 'koons-culpeper' | 'action-cars' | 'easterns-millersville' | 'easterns-frederick';
export type SourceConfig = {
  locationId: string;
  defaultChannel: 'whatsapp' | 'messenger';
  supportedChannels?: readonly ('whatsapp' | 'messenger')[];
  splitByLanguage?: boolean;
  alternatingGroup?: string;
};
export type SourceConfigMap = Record<SourceKey, SourceConfig>;

export type LeadRow = { id: string; canonical_phone: string | null; first_name: string | null; last_name: string | null };
export type DealerRow = { id: string; code: string; name: string; timezone: string; routing_config: { group?: string; language?: CollectorLanguage; allocation_key?: string; allocation_order?: number } | null };
export type ConversationRow = {
  id: string;
  status: string;
  qualification_snapshot: Record<string, unknown>;
  location_snapshot: Record<string, unknown>;
  created_at?: string | Date;
  first_message_at?: string | Date;
  ready_at?: string | null;
  next_attempt_at?: string | null;
  waiting_window_attempts?: number;
  waiting_window_started_at?: string | null;
  isExisting?: boolean;
  hasPreviousMessage?: boolean;
};
export type ConversationMessageRow = {
  body: string;
  direction: string;
  occurred_at: string;
  raw_payload?: unknown;
  attachment_extracted_text?: string | null;
};

export type ExistingDealerLead = {
  status: string;
  routing_status: string;
  assigned_dealer_id: string | null;
  routing_override: boolean;
  routing_reason: string | null;
  vehicle_type: string | null;
  down_payment: string | null;
  identification: string | null;
  bank_account: string | null;
  purchase_timeline: string | null;
  documents: string | null;
  has_unhandled_reengagement?: boolean;
  reengagement_count?: number;
};

export type ConversationSnapshot = {
  real_name: string;
  phone: string;
  vehicle_type: string;
  vehicle_year?: number | null;
  customer_location?: string;
  vehicle_category?: string | null;
  required_down_payment?: number | null;
  down_payment_amount?: number | null;
  down_payment_sufficient?: boolean;
  down_payment: string;
  previous_financing?: 'yes' | 'no' | '';
  purchase_timeline: string;
  documents: string;
  identification: string;
  bank_account: string;
  qualification_memory: string;
  qualification_complete: boolean;
  missing_qualification: string[];
  message_count: number;
  language?: CollectorLanguage;
  qualification_progress?: QualificationProgress;
  assigned_dealer_id?: string;
};

export type LocationSnapshot = {
  city: string | null;
  state: string | null;
  zip_code: string | null;
  easterns_zone: string | null;
};

export type ConversationWebhookResponse = {
  accepted: true;
  eventId: string;
  conversationId: string;
  source: SourceKey;
  status: 'processed' | 'duplicate_ignored' | 'stale_phone_ignored' | 'ignored_channel';
};

export type DueConversationResponse = {
  accepted: true;
  processed: number;
  guard?: {
    enabled: boolean;
    skipped: boolean;
    selected: number;
    fetched: number;
    inserted: number;
    repaired: number;
    failed: number;
  };
  guardError?: string;
};
export type MediaReconciliationResponse = {
  accepted: true;
  conversationId: string;
  status: string;
  qualificationSnapshot: ConversationSnapshot | null;
};

export type PersistedWebhookEvent = GhlCustomerRepliedDto & {
  ghl_location_id: string;
  ghl_contact_id: string;
  ghl_conversation_id: string;
  event_id: string;
};
