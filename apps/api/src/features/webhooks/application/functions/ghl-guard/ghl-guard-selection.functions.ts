import type { QueryRunner } from 'typeorm';
import { ghlGuardBatchSize, ghlGuardIntervalMs, ghlGuardQueuedRefreshWindowMs, ghlGuardStaleLogMs } from '../../ghl-guard.config';
import { RECONCILIATION_LOCATION_IDS } from '../conversations/conversation-webhook.config';
import { canonicalConversationExclusionSql, queuedSiblingExclusionSql } from '../conversations/queued-sibling.sql';
import type { GuardConversationRow } from './ghl-guard.types';

type GuardSelectionOptions = {
  targeted: boolean;
  contactIds: string[];
  allowSentRepair: boolean;
  recentOnly: boolean;
  recentCutoff: string;
  queuedOnly: boolean;
};

/** Selects the next GHL conversations for a Guard cycle without changing its selection rules. */
export async function selectGuardConversations(
  lockRunner: QueryRunner,
  { targeted, contactIds, allowSentRepair, recentOnly, recentCutoff, queuedOnly }: GuardSelectionOptions,
): Promise<GuardConversationRow[]> {
  const recentPredicate = recentOnly
    ? `AND COALESCE(c.last_message_at, c.ready_at, c.created_at) >= ${queuedOnly && !targeted ? '$6' : '$4'}::timestamptz`
    : '';
  const queuedRefreshPredicate = queuedOnly && !targeted
    ? `AND (
             c.queued_guard_replay_count = 0
             OR (
               c.last_message_at >= CURRENT_TIMESTAMP - ($4::integer * INTERVAL '1 millisecond')
               AND (last_guard.created_at IS NULL
                 OR last_guard.created_at <= CURRENT_TIMESTAMP - ($5::integer * INTERVAL '1 millisecond'))
             )
           )
           AND (c.queued_guard_replay_count > 0
             OR c.queued_guard_replay_claimed_at IS NULL
             OR c.queued_guard_replay_claimed_at <= CURRENT_TIMESTAMP - ($3::integer * INTERVAL '1 millisecond'))`
    : '';
  return await lockRunner.query(
        targeted
          ? `SELECT id, ghl_location_id, ghl_contact_id, ghl_conversation_id, status,
                    qualification_snapshot->>'assigned_dealer_id' AS assigned_dealer_id
         FROM conversations c
         LEFT JOIN LATERAL (
           SELECT latest_guard.created_at
           FROM ghl_guard_logs latest_guard
           WHERE latest_guard.conversation_id = c.id
           ORDER BY latest_guard.created_at DESC
           LIMIT 1
         ) last_guard ON TRUE
         LEFT JOIN LATERAL (
           SELECT retry_guard.next_retry_at
           FROM ghl_guard_logs retry_guard
           WHERE retry_guard.conversation_id = c.id
             AND retry_guard.status = 'failed'
             AND retry_guard.next_retry_at IS NOT NULL
             AND retry_guard.next_retry_at <= CURRENT_TIMESTAMP
           ORDER BY retry_guard.next_retry_at ASC, retry_guard.created_at ASC
           LIMIT 1
         ) due_retry ON TRUE
         WHERE status NOT IN ('sent', 'ignored_channel', 'stale_phone_ignored')
           AND ghl_location_id = ANY($2::text[])
           AND ghl_contact_id = ANY($3::text[])
           ${targeted ? "AND status <> 'duplicate_ignored'" : ''}
           ${allowSentRepair ? '' : `AND NOT EXISTS (
             SELECT 1 FROM lead_dealers sent_ld
             WHERE sent_ld.lead_id = c.lead_id AND sent_ld.status = 'sent'
           )`}
           ${recentPredicate}
           ${queuedOnly ? "AND status = 'queued' AND queued_guard_replay_count = 0" : ''}
           ${targeted ? '' : queuedSiblingExclusionSql('c')}
           ${targeted ? '' : canonicalConversationExclusionSql('c')}
           AND NOT EXISTS (
             SELECT 1 FROM ghl_guard_logs active_guard
             WHERE active_guard.conversation_id = c.id
               AND active_guard.status IN ('pending', 'running')
               AND COALESCE(active_guard.lease_expires_at, active_guard.started_at, active_guard.scheduled_at) > CURRENT_TIMESTAMP
           )
         ORDER BY CASE WHEN status = 'queued' AND queued_guard_replay_count = 0 THEN 0 ELSE 1 END,
                  CASE WHEN due_retry.next_retry_at IS NOT NULL THEN 0 ELSE 1 END,
                  due_retry.next_retry_at ASC NULLS LAST,
                  CASE status WHEN 'duplicate_ignored' THEN 0 WHEN 'partial' THEN 1 WHEN 'waiting_window' THEN 2 WHEN 'stale_phone_ignored' THEN 3 WHEN 'queued' THEN 4 ELSE 5 END,
                  last_guard.created_at NULLS FIRST,
                  last_message_at DESC NULLS LAST,
                  updated_at DESC
         LIMIT $1`
          : queuedOnly
          ? `SELECT id, ghl_location_id, ghl_contact_id, ghl_conversation_id, status,
                    qualification_snapshot->>'assigned_dealer_id' AS assigned_dealer_id
         FROM conversations c
         LEFT JOIN LATERAL (
           SELECT latest_guard.created_at
           FROM ghl_guard_logs latest_guard
           WHERE latest_guard.conversation_id = c.id
           ORDER BY latest_guard.created_at DESC
           LIMIT 1
         ) last_guard ON TRUE
         LEFT JOIN LATERAL (
           SELECT retry_guard.next_retry_at
           FROM ghl_guard_logs retry_guard
           WHERE retry_guard.conversation_id = c.id
             AND retry_guard.status = 'failed'
             AND retry_guard.next_retry_at IS NOT NULL
             AND retry_guard.next_retry_at <= CURRENT_TIMESTAMP
           ORDER BY retry_guard.next_retry_at ASC, retry_guard.created_at ASC
           LIMIT 1
         ) due_retry ON TRUE
         WHERE status = 'queued'
           ${queuedRefreshPredicate}
           ${allowSentRepair ? '' : `AND NOT EXISTS (
             SELECT 1 FROM lead_dealers sent_ld
             WHERE sent_ld.lead_id = c.lead_id AND sent_ld.status = 'sent'
           )`}
           AND ghl_location_id = ANY($2::text[])
           ${recentPredicate}
           ${queuedSiblingExclusionSql('c')}
           ${canonicalConversationExclusionSql('c')}
           AND NOT EXISTS (
             SELECT 1 FROM ghl_guard_logs active_guard
             WHERE active_guard.conversation_id = c.id
               AND active_guard.status IN ('pending', 'running')
               AND COALESCE(active_guard.lease_expires_at, active_guard.started_at, active_guard.scheduled_at) > CURRENT_TIMESTAMP
           )
           AND NOT EXISTS (
             SELECT 1 FROM ghl_guard_logs retry_guard
             WHERE retry_guard.conversation_id = c.id
               AND retry_guard.status = 'failed'
               AND retry_guard.next_retry_at > CURRENT_TIMESTAMP
               -- Recovery of an abandoned Guard run must not defer the
               -- one-time queued replay. The stale row is already terminal
               -- and the queued backup must be able to claim the conversation
               -- in this same scheduler pass.
               AND retry_guard.error_code IS DISTINCT FROM 'GHL_GUARD_STALE_RUN'
               AND COALESCE(retry_guard.metadata->>'recoveryReason', '') <> 'stale_guard_log'
           )
         -- Freshly queued contacts must not wait behind the historical backlog.
         -- A failed contact is temporarily skipped by the retry backoff above,
         -- allowing the same backup cycle to make progress on the next row.
         ORDER BY CASE WHEN c.queued_guard_replay_count = 0 THEN 0 ELSE 1 END,
                  CASE WHEN c.queued_guard_replay_count = 0 THEN c.updated_at END DESC NULLS LAST,
                  last_guard.created_at ASC NULLS FIRST,
                  CASE WHEN due_retry.next_retry_at IS NOT NULL THEN 0 ELSE 1 END,
                  due_retry.next_retry_at ASC NULLS LAST,
                  c.updated_at DESC NULLS LAST
         LIMIT $1`
          : `SELECT id, ghl_location_id, ghl_contact_id, ghl_conversation_id, status,
                    qualification_snapshot->>'assigned_dealer_id' AS assigned_dealer_id
         FROM conversations c
         LEFT JOIN LATERAL (
           SELECT latest_guard.created_at
           FROM ghl_guard_logs latest_guard
           WHERE latest_guard.conversation_id = c.id
           ORDER BY latest_guard.created_at DESC
           LIMIT 1
         ) last_guard ON TRUE
         LEFT JOIN LATERAL (
           SELECT retry_guard.next_retry_at
           FROM ghl_guard_logs retry_guard
           WHERE retry_guard.conversation_id = c.id
             AND retry_guard.status = 'failed'
             AND retry_guard.next_retry_at IS NOT NULL
             AND retry_guard.next_retry_at <= CURRENT_TIMESTAMP
           ORDER BY retry_guard.next_retry_at ASC, retry_guard.created_at ASC
           LIMIT 1
         ) due_retry ON TRUE
         WHERE (status NOT IN ('queued', 'sent', 'duplicate_ignored', 'ignored_channel', 'stale_phone_ignored')
            OR (status = 'queued' AND queued_guard_replay_count = 0
              AND (queued_guard_replay_claimed_at IS NULL
                OR queued_guard_replay_claimed_at <= CURRENT_TIMESTAMP - ($3::integer * INTERVAL '1 millisecond'))))
           ${allowSentRepair ? '' : `AND NOT EXISTS (
             SELECT 1 FROM lead_dealers sent_ld
             WHERE sent_ld.lead_id = c.lead_id AND sent_ld.status = 'sent'
           )`}
           AND ghl_location_id = ANY($2::text[])
           ${recentPredicate}
           ${queuedSiblingExclusionSql('c')}
           ${canonicalConversationExclusionSql('c')}
           AND NOT EXISTS (
             SELECT 1 FROM ghl_guard_logs active_guard
             WHERE active_guard.conversation_id = c.id
               AND active_guard.status IN ('pending', 'running')
               AND COALESCE(active_guard.lease_expires_at, active_guard.started_at, active_guard.scheduled_at) > CURRENT_TIMESTAMP
           )
           AND NOT EXISTS (
             SELECT 1 FROM ghl_guard_logs retry_guard
               WHERE retry_guard.conversation_id = c.id
               AND retry_guard.status = 'failed'
               AND retry_guard.next_retry_at > CURRENT_TIMESTAMP
           )
           AND (status <> 'partial'
             OR (partial_recovery_enabled = true
               AND partial_recovery_next_attempt_at IS NOT NULL
               AND partial_recovery_next_attempt_at <= CURRENT_TIMESTAMP))
         ORDER BY CASE WHEN due_retry.next_retry_at IS NOT NULL THEN 0 ELSE 1 END,
                  due_retry.next_retry_at ASC NULLS LAST,
                  last_guard.created_at NULLS FIRST,
                  last_message_at ASC NULLS FIRST,
                  updated_at ASC NULLS FIRST
         LIMIT $1`,
        targeted
          ? (recentOnly
            ? [Math.max(ghlGuardBatchSize(), Math.min(contactIds.length * 3, 10)), RECONCILIATION_LOCATION_IDS, contactIds, recentCutoff]
            : [Math.max(ghlGuardBatchSize(), Math.min(contactIds.length * 3, 10)), RECONCILIATION_LOCATION_IDS, contactIds])
          : queuedOnly
            ? (recentOnly
              ? [ghlGuardBatchSize(), RECONCILIATION_LOCATION_IDS, ghlGuardStaleLogMs(), ghlGuardQueuedRefreshWindowMs(), ghlGuardIntervalMs(), recentCutoff]
              : [ghlGuardBatchSize(), RECONCILIATION_LOCATION_IDS, ghlGuardStaleLogMs(), ghlGuardQueuedRefreshWindowMs(), ghlGuardIntervalMs()])
            : (recentOnly
              ? [ghlGuardBatchSize(), RECONCILIATION_LOCATION_IDS, ghlGuardStaleLogMs(), recentCutoff]
              : [ghlGuardBatchSize(), RECONCILIATION_LOCATION_IDS, ghlGuardStaleLogMs()]),
  ) as GuardConversationRow[];
}
