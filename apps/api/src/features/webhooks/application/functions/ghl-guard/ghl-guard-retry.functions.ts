import { Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import {
  ghlGuardCircuitCooldownMs,
  ghlGuardCircuitFailureThreshold,
} from '../../ghl-guard.config';
import type { SourceConfigMap, SourceKey } from '../conversations/conversation-webhook.types';
import { isRetryableGuardFailure } from './ghl-guard.helpers';
import type { GuardConversationRow } from './ghl-guard.types';

type SourceCircuitState = {
  consecutiveFailures: number;
  openedUntil: number;
};

export class GhlGuardRetryFunctions {
  private readonly logger = new Logger(GhlGuardRetryFunctions.name);
  private readonly sourceCircuits = new Map<SourceKey, SourceCircuitState>();

  constructor(
    private readonly dataSource: DataSource | undefined,
    private readonly sourceConfig: SourceConfigMap,
    private readonly enqueuePendingContactIds: (contactIds: string[]) => void,
  ) {}

  scheduleTransientRetry(row: GuardConversationRow, errorCode: string, source?: SourceKey, errorMessage?: string): void {
    if (!isRetryableGuardFailure(errorCode, errorMessage)) {
      if (source) this.sourceCircuits.delete(source);
      return;
    }
    // Only remote GHL failures should open the source circuit. A transient
    // Neon/TypeORM connection failure should retry the contact without
    // suppressing healthy GHL reads for the entire source.
    if (source && errorCode.startsWith('GHL_')) {
      const previous = this.sourceCircuits.get(source);
      const consecutiveFailures = (previous?.consecutiveFailures ?? 0) + 1;
      const openedUntil = consecutiveFailures >= ghlGuardCircuitFailureThreshold()
        ? Date.now() + ghlGuardCircuitCooldownMs()
        : previous?.openedUntil ?? 0;
      this.sourceCircuits.set(source, { consecutiveFailures, openedUntil });
      if (openedUntil > Date.now()) {
        this.logger.warn(`GHL guard circuit opened source=${source} cooldown_ms=${ghlGuardCircuitCooldownMs()}`);
      }
    }
    // Keep the retry contact-scoped so a transient GHL/Neon failure cannot
    // strand the conversation or replay unrelated contacts.
    this.enqueuePendingContactIds([row.ghl_contact_id]);
  }

  async isSourceCircuitOpen(source: SourceKey): Promise<boolean> {
    const state = this.sourceCircuits.get(source);
    if (state?.openedUntil && state.openedUntil > Date.now()) return true;
    if (state) this.sourceCircuits.delete(source);
    if (!this.dataSource) return false;

    try {
      const rows = await this.dataSource.query(
        `WITH recent AS (
           SELECT status, error_code, created_at
           FROM ghl_guard_logs
           WHERE ghl_location_id = $1
             AND status IN ('failed', 'succeeded')
           ORDER BY created_at DESC
           LIMIT $2
         )
         SELECT COUNT(*)::integer AS observed_count,
           BOOL_AND(
             status = 'failed'
             AND (
               error_code IN ('GHL_TIMEOUT', 'GHL_NETWORK_ERROR', 'GHL_AUTH_TIMEOUT', 'GHL_RATE_LIMITED')
               OR error_code ~ '^GHL_HTTP_5[0-9][0-9]$'
             )
           ) AS all_transient,
                MAX(created_at) AS latest_created_at
         FROM recent`,
        [this.sourceConfig[source].locationId, ghlGuardCircuitFailureThreshold()],
      ) as Array<{ observed_count: number; all_transient: boolean | null; latest_created_at: string | null }>;
      const row = rows[0];
      const latestCreatedAt = row?.latest_created_at ? new Date(row.latest_created_at).getTime() : 0;
      const open = Number(row?.observed_count ?? 0) >= ghlGuardCircuitFailureThreshold()
        && row?.all_transient === true
        && latestCreatedAt > Date.now() - ghlGuardCircuitCooldownMs();
      if (open) {
        this.sourceCircuits.set(source, {
          consecutiveFailures: ghlGuardCircuitFailureThreshold(),
          openedUntil: latestCreatedAt + ghlGuardCircuitCooldownMs(),
        });
      }
      return open;
    } catch (error) {
      this.logger.warn(`GHL guard circuit health check failed source=${source}: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  resetSourceCircuit(source: SourceKey): void {
    this.sourceCircuits.delete(source);
  }

  circuitState(source: SourceKey): 'closed' | 'open' {
    const state = this.sourceCircuits.get(source);
    return state?.openedUntil != null && state.openedUntil > Date.now() ? 'open' : 'closed';
  }
}
