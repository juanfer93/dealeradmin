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

export const BulkLeadImportSchema = z.object({
  text: z.string().min(1, 'Pega al menos un lead').max(100_000, 'El texto es demasiado grande'),
});

export type BulkLeadImportDto = z.infer<typeof BulkLeadImportSchema>;
