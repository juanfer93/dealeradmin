import { z } from 'zod';

export const DEALERADMIN_CAPTURE_SCHEMA_VERSION = 'dealeradmin.capture.v1' as const;

export const CaptureEvidenceSourceSchema = z.enum([
  'message',
  'transcript',
  'contact.phone',
  'custom_field',
  'qualification_memory',
  'workflow',
  'whatsapp_native',
  'backend',
]);

export const CaptureFieldSchema = z.object({
  value: z.string().nullable(),
  source: CaptureEvidenceSourceSchema,
  evidence: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});

export const QualificationStepSchema = z.enum([
  'real_name',
  'vehicle_type',
  'down_payment',
  'purchase_timeline',
  'documents',
  'bank_account',
  'complete',
]);

export const QualificationProgressSchema = z.object({
  step: QualificationStepSchema,
  last_answered_field: z.string().nullable(),
  predicted_bot_question: z.string(),
  language: z.enum(['es', 'en']),
  confidence: z.number().min(0).max(1),
  evidence: z.enum(['transcript', 'normalized_fields', 'complete']),
});

export const RawCaptureEvidenceSchema = z.object({
  schema_version: z.literal(DEALERADMIN_CAPTURE_SCHEMA_VERSION),
  channel: z.string().min(1),
  transcript: z.string(),
  contact_id: z.string().nullable(),
  occurred_at: z.string().nullable(),
  append_only: z.literal(true),
});

export const TypedCaptureExtractionSchema = z.object({
  schema_version: z.literal(DEALERADMIN_CAPTURE_SCHEMA_VERSION),
  fields: z.object({
    phone: CaptureFieldSchema,
    real_name: CaptureFieldSchema,
    vehicle_type: CaptureFieldSchema,
    down_payment: CaptureFieldSchema,
    purchase_timeline: CaptureFieldSchema,
    identification: CaptureFieldSchema,
    proof_of_income: CaptureFieldSchema,
    bank_account: CaptureFieldSchema,
    city: CaptureFieldSchema,
    state: CaptureFieldSchema,
    zip_code: CaptureFieldSchema,
    easterns_zone: CaptureFieldSchema,
  }),
  completeness: z.object({
    status: z.enum(['complete', 'partial', 'blocked']),
    missing: z.array(z.string()),
  }),
  progress: QualificationProgressSchema.optional(),
});

export const DealeradminCaptureContractSchema = z.object({
  raw_evidence: RawCaptureEvidenceSchema,
  extraction: TypedCaptureExtractionSchema,
});

export type DealeradminCaptureContract = z.infer<typeof DealeradminCaptureContractSchema>;
