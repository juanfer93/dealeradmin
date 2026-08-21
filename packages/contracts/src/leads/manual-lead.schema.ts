import { z } from 'zod';

export const CreateManualLeadSchema = z.object({
  name: z.string().min(1, 'El nombre es obligatorio'),
  phone: z.string().min(7, 'El teléfono es obligatorio'),
  vehicle_type: z.string().optional().default(''),
  down_payment: z.string().optional().default(''),
  purchase_timeline: z.string().optional().default(''),
  documents: z.string().optional().default(''),
  identification: z.string().optional().default(''),
  bank_account: z.string().optional().default(''),
});

export type CreateManualLeadDto = z.infer<typeof CreateManualLeadSchema>;
