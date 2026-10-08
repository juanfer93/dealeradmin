import type { VehicleCategory } from '../down-payment';

export type CollectorInput = {
  source?: string | null;
  channel?: string | null;
  real_name?: string | null;
  contact_name?: string | null;
  contactName?: string | null;
  name?: string | null;
  profile?: { name?: string | null } | null;
  message?: string | null;
  phone?: string | null;
  vehicle_type?: string | null;
  down_payment?: string | null;
  purchase_timeline?: string | null;
  documents?: string | null;
  identification?: string | null;
  bank_account?: string | null;
  qualification_memory?: string | null;
  chat_history_log?: string | null;
  customer_location?: string | null;
  previous_predicted_bot_question?: string | null;
};

export type CollectorLanguage = 'es' | 'en';

export type QualificationStep =
  | 'real_name'
  | 'vehicle_type'
  | 'customer_location'
  | 'phone'
  | 'down_payment'
  | 'purchase_timeline'
  | 'documents'
  | 'bank_account'
  | 'complete';

export type QualificationProgress = {
  step: QualificationStep;
  last_answered_field: string | null;
  predicted_bot_question: string;
  language: CollectorLanguage;
  confidence: number;
  evidence: 'transcript' | 'normalized_fields' | 'complete';
};

export type CollectorOutput = {
  real_name: string;
  vehicle_type: string;
  vehicle_year: number | null;
  customer_location: string;
  vehicle_category: VehicleCategory | null;
  required_down_payment: number | null;
  down_payment_amount: number | null;
  down_payment_sufficient: boolean;
  down_payment: string;
  previous_financing: 'yes' | 'no' | '';
  purchase_timeline: string;
  documents: string;
  identification: string;
  bank_account: string;
  qualification_memory: string;
  has_identification: string;
  has_income_proof: string;
  next_question: string;
  qualification_step: QualificationStep;
  qualification_progress: QualificationProgress;
  qualification_complete: boolean;
  missing_qualification: string[];
  qualification_source: 'custom_fields' | 'qualification_memory' | 'both' | 'none';
  phone: string;
  chat_history_log: string;
  dealeradmin_send_now: boolean;
};

export type CollectorFlowPolicy = {
  sourceAware: boolean;
  stafford: boolean;
  requiresLocation: boolean;
  phoneSatisfiedByNative: boolean;
};
