import { ConflictException } from '@nestjs/common';
import type { QueryRunner } from 'typeorm';
import { normalizePhone } from '../domain/phone-normalizer';

type LeadTargetRow = {
  id: string;
  ghl_contact_id: string;
  ghl_location_id: string;
  canonical_phone: string | null;
};

type ConversationTargetRow = { id: string };

export type LeadPurgeResult = {
  deletedLead: boolean;
  deletedRelationship: boolean;
  deletedConversationCount: number;
  suppressed: boolean;
};

export function canonicalSuppressionPhone(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    return normalizePhone(value);
  } catch {
    return null;
  }
}

function suppressionLockKey(locationId: string, contactId: string): string {
  return `lead-deletion:${locationId}:${contactId}`;
}

export async function acquireLeadSuppressionLock(
  runner: QueryRunner,
  locationId: string,
  contactId: string,
): Promise<void> {
  await runner.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [suppressionLockKey(locationId, contactId)]);
}

export async function isLeadDeletionSuppressed(
  runner: QueryRunner,
  locationId: string,
  contactId: string,
  canonicalPhone: string | null,
): Promise<boolean> {
  const rows = await runner.query(
    `SELECT 1
     FROM lead_deletion_suppressions
     WHERE ghl_location_id = $1
       AND (ghl_contact_id = $2 OR ($3::varchar IS NOT NULL AND canonical_phone = $3))
     LIMIT 1`,
    [locationId, contactId, canonicalPhone],
  ) as Array<{ '?column?': number }>;
  return rows.length > 0;
}

export async function purgeLeadForDealer(
  runner: QueryRunner,
  leadId: string,
  dealerId: string,
): Promise<LeadPurgeResult> {
  const targets = await runner.query(
    `SELECT id, ghl_contact_id, ghl_location_id, canonical_phone
     FROM leads
     WHERE id = $1
     FOR UPDATE`,
    [leadId],
  ) as LeadTargetRow[];
  if (targets.length === 0) {
    return { deletedLead: false, deletedRelationship: false, deletedConversationCount: 0, suppressed: false };
  }

  const target = targets[0];
  const scopedRelationship = await runner.query(
    `SELECT lead_id
     FROM lead_dealers
     WHERE lead_id = $1
       AND COALESCE(assigned_dealer_id, dealer_id) = $2
     FOR UPDATE`,
    [leadId, dealerId],
  ) as Array<{ lead_id: string }>;
  if (scopedRelationship.length === 0) {
    return { deletedLead: false, deletedRelationship: false, deletedConversationCount: 0, suppressed: false };
  }

  const relationshipCountRows = await runner.query(
    `SELECT COUNT(*)::int AS count
     FROM lead_dealers
     WHERE lead_id = $1`,
    [leadId],
  ) as Array<{ count: number }>;
  if (Number(relationshipCountRows[0]?.count ?? 0) > 1) {
    throw new ConflictException('El lead está vinculado a más de un dealer; se requiere una purga explícita global');
  }

  await acquireLeadSuppressionLock(runner, target.ghl_location_id, target.ghl_contact_id);
  await runner.query(
    `INSERT INTO lead_deletion_suppressions
       (ghl_location_id, ghl_contact_id, canonical_phone, reason)
     VALUES ($1, $2, $3, 'operator_delete')
     ON CONFLICT (ghl_location_id, ghl_contact_id) DO UPDATE SET
       canonical_phone = COALESCE(EXCLUDED.canonical_phone, lead_deletion_suppressions.canonical_phone),
       reason = EXCLUDED.reason,
       deleted_at = CURRENT_TIMESTAMP`,
    [target.ghl_location_id, target.ghl_contact_id, canonicalSuppressionPhone(target.canonical_phone)],
  );

  const conversations = await runner.query(
    `SELECT id
     FROM conversations
     WHERE lead_id = $1
     FOR UPDATE`,
    [leadId],
  ) as ConversationTargetRow[];
  const conversationIds = conversations.map((conversation) => conversation.id);

  // Keep this cleanup scoped to the deleted GHL identity. The event tables do
  // not have foreign keys to leads, so remove their related traces explicitly
  // before deleting the conversation and lead rows.
  await runner.query(
    `DELETE FROM webhook_events
     WHERE event_id IN (
       SELECT event_id
       FROM webhook_ingress_logs
       WHERE ghl_location_id = $1 AND ghl_contact_id = $2 AND event_id IS NOT NULL
       UNION
       SELECT event_id
       FROM webhook_processing_attempts
       WHERE ghl_location_id = $1 AND ghl_contact_id = $2 AND event_id IS NOT NULL
     )`,
    [target.ghl_location_id, target.ghl_contact_id],
  );
  await runner.query(
    `DELETE FROM ghl_guard_logs
     WHERE (ghl_location_id = $1 AND ghl_contact_id = $2)
        OR conversation_id = ANY($3::uuid[])`,
    [target.ghl_location_id, target.ghl_contact_id, conversationIds],
  );
  await runner.query(
    `DELETE FROM webhook_processing_attempts
     WHERE ghl_location_id = $1 AND ghl_contact_id = $2`,
    [target.ghl_location_id, target.ghl_contact_id],
  );
  await runner.query(
    `DELETE FROM webhook_ingress_logs
     WHERE ghl_location_id = $1 AND ghl_contact_id = $2`,
    [target.ghl_location_id, target.ghl_contact_id],
  );

  if (conversationIds.length > 0) {
    await runner.query(
      `DELETE FROM conversation_attachments
       WHERE conversation_id = ANY($1::uuid[])`,
      [conversationIds],
    );
    await runner.query(
      `DELETE FROM conversation_messages
       WHERE conversation_id = ANY($1::uuid[])`,
      [conversationIds],
    );
    await runner.query(
      `DELETE FROM conversation_bot_pause_events
       WHERE lead_id = $1 OR conversation_id = ANY($2::uuid[])`,
      [leadId, conversationIds],
    );
    await runner.query(
      `DELETE FROM conversations
       WHERE id = ANY($1::uuid[])`,
      [conversationIds],
    );
  }

  await runner.query(`DELETE FROM lead_ingestion_rows WHERE lead_id = $1`, [leadId]);
  await runner.query(`DELETE FROM lead_dealers WHERE lead_id = $1`, [leadId]);
  await runner.query(`DELETE FROM leads WHERE id = $1`, [leadId]);

  return {
    deletedLead: true,
    deletedRelationship: true,
    deletedConversationCount: conversationIds.length,
    suppressed: true,
  };
}
