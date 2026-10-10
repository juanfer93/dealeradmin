import { describe, expect, it, vi } from 'vitest';
import { WebhookIngressAuditMiddleware } from '../../presentation/webhook-ingress-audit.middleware';

describe('WebhookIngressAuditMiddleware', () => {
  it('finalizes the audit row with the HTTP result when the response finishes', async () => {
    const audit = {
      begin: vi.fn().mockResolvedValue('audit-1'),
      complete: vi.fn(),
    };
    const middleware = new WebhookIngressAuditMiddleware(audit as never);
    const listeners = new Map<string, () => void>();
    const response = {
      statusCode: 422,
      writableFinished: true,
      once: (event: string, callback: () => void) => listeners.set(event, callback),
    };
    const next = vi.fn();

    await middleware.use({ body: { event_id: 'evt-audit-1' } } as never, response as never, next);
    listeners.get('finish')?.();
    await Promise.resolve();

    expect(next).toHaveBeenCalledOnce();
    expect(audit.complete).toHaveBeenCalledWith('audit-1', { statusCode: 422, connectionClosed: false });
  });
});
