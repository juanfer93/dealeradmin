import { Injectable } from '@nestjs/common';

export const QUEUED_PAUSE_HOURS = 24;
export const QUEUED_PAUSE_TIMEOUT_MS = 5_000;

export type QueuedPauseSource = string;

export type QueuedPausePayload = {
  event: 'dealeradmin.conversation_queued';
  eventId: string;
  queued: true;
  status: 'queued';
  conversationId: string;
  contactId: string;
  locationId: string;
  leadId: string;
  pauseHours: 24;
  emittedAt: string;
};

export type QueuedPauseDeliveryResult = {
  delivered: boolean;
  reason?: string;
};

export interface QueuedPauseNotifier {
  send(source: QueuedPauseSource, payload: QueuedPausePayload): Promise<QueuedPauseDeliveryResult>;
}

export function isQueuedTransition(previousStatus: string | null | undefined, nextStatus: string): boolean {
  return previousStatus !== 'queued' && nextStatus === 'queued';
}

export function isQueuedPauseSourceEnabled(source: string): boolean {
  // Stafford is WhatsApp and is intentionally out of this rollout. The
  // Conversation AI pause workflow currently covers Messenger sources only.
  return source !== 'stafford';
}

export function queuedPauseWebhookEnvName(source: string): string {
  return `GHL_QUEUED_PAUSE_WEBHOOK_URL_${source.replace(/[^a-z0-9]+/gi, '_').toUpperCase()}`;
}

export class QueuedPauseDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QueuedPauseDeliveryError';
  }
}

@Injectable()
export class GhlQueuedPauseNotifier implements QueuedPauseNotifier {
  async send(source: QueuedPauseSource, payload: QueuedPausePayload): Promise<QueuedPauseDeliveryResult> {
    if (!isQueuedPauseSourceEnabled(source)) return { delivered: false, reason: 'source_disabled' };
    const webhookUrl = process.env[queuedPauseWebhookEnvName(source)];
    if (!webhookUrl) return { delivered: false, reason: 'webhook_not_configured' };

    let url: URL;
    try {
      url = new URL(webhookUrl);
    } catch {
      throw new QueuedPauseDeliveryError('Configured queued pause webhook URL is invalid');
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new QueuedPauseDeliveryError('Configured queued pause webhook URL must use HTTP or HTTPS');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), QUEUED_PAUSE_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!response.ok) throw new QueuedPauseDeliveryError(`Queued pause webhook returned HTTP ${response.status}`);
      return { delivered: true };
    } catch (error) {
      if (error instanceof QueuedPauseDeliveryError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new QueuedPauseDeliveryError(`Queued pause webhook timed out after ${QUEUED_PAUSE_TIMEOUT_MS}ms`);
      }
      throw new QueuedPauseDeliveryError('Queued pause webhook request failed');
    } finally {
      clearTimeout(timeout);
    }
  }
}
