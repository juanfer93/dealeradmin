import { z } from 'zod';
export { BulkLeadImportSchema, CreateManualLeadSchema, UpdateLeadSchema } from './leads/manual-lead.schema';
export type { BulkLeadImportDto, CreateManualLeadDto, UpdateLeadDto } from './leads/manual-lead.schema';

const EasternsDealerSelectedSchema = z.preprocess((value) => {
  if (value === null || value === undefined || typeof value === 'boolean') return value;

  const values = Array.isArray(value) ? value : [value];
  return values.some((item) => {
    if (typeof item !== 'string') return item === true;
    return ['true', '1', 'yes', 'selected', 'dealer seleccionado'].includes(item.trim().toLowerCase());
  });
}, z.boolean().nullable().optional());

export const LeadWebhookSchema = z.object({
  event_id: z.string().min(1),
  event_type: z.string().min(1),
  occurred_at: z.string().min(1),
  dealer_id: z.string().min(1),
  dealer_name: z.string().min(1),
  ghl_location_id: z.string().min(1),
  ghl_contact_id: z.string().min(1),
  lead: z.object({
    name: z.string().min(1),
    phone: z.string().min(1),
    vehicle_type: z.string().nullable().optional(),
    down_payment: z.string().nullable().optional(),
    identification: z.string().nullable().optional(),
    id_number: z.string().nullable().optional(),
    id: z.string().nullable().optional(),
    bank_account: z.string().nullable().optional(),
    purchase_timeline: z.string().nullable().optional(),
    documents: z.string().nullable().optional(),
    message: z.string().nullable().optional(),
    qualification_memory: z.string().nullable().optional(),
    qualification_source: z.enum(['custom_fields', 'qualification_memory', 'both', 'none']).nullable().optional(),
    qualification_complete: z.boolean().optional(),
    missing_qualification: z.array(z.string()).optional(),
    chat_history_log: z.string().nullable().optional(),
    easterns_zone: z.string().nullable().optional(),
    easterns_dealer_selected: EasternsDealerSelectedSchema,
    city: z.string().nullable().optional(),
    state: z.string().nullable().optional(),
    zip_code: z.string().nullable().optional(),
  }),
});

export type LeadWebhookDto = z.infer<typeof LeadWebhookSchema>;

export const LoginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export type LoginDto = z.infer<typeof LoginSchema>;
