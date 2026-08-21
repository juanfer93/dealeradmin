import { z } from 'zod';

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
    easterns_zone: z.string().nullable().optional(),
  }),
});

export type LeadWebhookDto = z.infer<typeof LeadWebhookSchema>;

export const LoginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export type LoginDto = z.infer<typeof LoginSchema>;
