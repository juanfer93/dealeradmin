import { z } from 'zod';

const GhlAttachmentObjectSchema = z.object({
  url: z.string().trim().min(1).optional(),
  href: z.string().trim().min(1).optional(),
  download_url: z.string().trim().min(1).optional(),
  downloadUrl: z.string().trim().min(1).optional(),
  file_url: z.string().trim().min(1).optional(),
  fileUrl: z.string().trim().min(1).optional(),
  media_url: z.string().trim().min(1).optional(),
  mediaUrl: z.string().trim().min(1).optional(),
  source_url: z.string().trim().min(1).optional(),
  sourceUrl: z.string().trim().min(1).optional(),
  id: z.union([z.string().trim().min(1), z.number().int().nonnegative()]).optional(),
  attachment_id: z.string().trim().min(1).optional(),
  attachmentId: z.string().trim().min(1).optional(),
  content_type: z.string().trim().min(1).optional(),
  contentType: z.string().trim().min(1).optional(),
  mime_type: z.string().trim().min(1).optional(),
  mimeType: z.string().trim().min(1).optional(),
  mime: z.string().trim().min(1).optional(),
  type: z.string().trim().min(1).optional(),
  kind: z.string().trim().min(1).optional(),
  filename: z.string().trim().min(1).optional(),
  file_name: z.string().trim().min(1).optional(),
  fileName: z.string().trim().min(1).optional(),
  size: z.union([z.number().int().nonnegative(), z.string().trim().min(1)]).optional(),
  byte_size: z.union([z.number().int().nonnegative(), z.string().trim().min(1)]).optional(),
  expires_at: z.string().trim().min(1).optional(),
  expiresAt: z.string().trim().min(1).optional(),
}).passthrough();

export const GhlAttachmentSchema = z.union([
  z.string().trim().min(1),
  GhlAttachmentObjectSchema,
]);

export const GhlAttachmentsSchema = z.union([
  GhlAttachmentSchema,
  z.array(GhlAttachmentSchema),
  z.null(),
]);

const OptionalGhlAttachmentsSchema = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  GhlAttachmentsSchema.optional(),
);

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
  message_attachments: OptionalGhlAttachmentsSchema,
  raw_payload: z.record(z.unknown()).optional(),
});

export type GhlCustomerRepliedDto = z.infer<typeof GhlCustomerRepliedSchema>;
