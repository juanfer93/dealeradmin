import { z } from 'zod';

export const GhlCustomerRepliedSchema = z.object({
  event_id: z.string().trim().min(1).optional(),
  event_type: z.string().trim().min(1).default('customer.replied'),
  ghl_message_id: z.string().trim().min(1).optional(),
  ghl_contact_id: z.string().trim().min(1).optional(),
  ghl_conversation_id: z.string().trim().min(1).optional(),
  message_body: z.string().nullable().optional(),
  contact_phone: z.string().nullable().optional(),
  contact_name: z.string().nullable().optional(),
  channel: z.string().trim().min(1).default('unknown'),
  occurred_at: z.string().trim().min(1).optional(),
  raw_payload: z.record(z.unknown()).optional(),
});

export type GhlCustomerRepliedDto = z.infer<typeof GhlCustomerRepliedSchema>;
