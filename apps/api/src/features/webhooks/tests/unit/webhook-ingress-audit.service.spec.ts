import { describe, expect, it, vi } from 'vitest';
import { WebhookIngressAuditService } from '../../application/webhook-ingress-audit.service';

function request(overrides: Record<string, unknown> = {}) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'user-agent': 'GHL-Test',
    'X-GHL-Signature': 'sha256=redacted',
    'X-GHL-Timestamp': '1720000000',
    'X-DealerADMIN-Webhook-Secret': 'do-not-store-this-secret',
    'X-DealerADMIN-Contact-ID': 'header-contact',
    'X-DealerADMIN-Conversation-ID': 'header-conversation',
    'X-DealerADMIN-Message-ID': 'header-message',
  };
  return {
    method: 'POST',
    originalUrl: '/api/webhooks/ghl/customer-replied/fredericksburg-2',
    rawBody: Buffer.from(JSON.stringify({
      event_id: 'evt-audit-1',
      event_type: 'customer.replied',
      ghl_location_id: 'location-audit',
      ghl_contact_id: 'body-contact',
      ghl_conversation_id: 'body-conversation',
      lead: { message: 'Busco una SUV' },
    })),
    header: (name: string) => headers[name] ?? headers[Object.keys(headers).find((key) => key.toLowerCase() === name.toLowerCase()) ?? ''],
    ...overrides,
  };
}

describe('WebhookIngressAuditService', () => {
  it('persists a safe ingress snapshot before processing without storing secrets', async () => {
    const query = vi.fn().mockResolvedValue([]);
    const service = new WebhookIngressAuditService({ query } as never);
    const auditRequest = request();

    const requestId = await service.begin(auditRequest as never, undefined);

    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    const [sql, values] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO webhook_ingress_logs');
    expect(values).toContain('evt-audit-1');
    expect(values).toContain('location-audit');
    expect(values).toContain('body-contact');
    expect(values).toContain('body-conversation');
    expect(JSON.stringify(values)).toContain('Busco una SUV');
    expect(JSON.stringify(values)).not.toContain('do-not-store-this-secret');

    await service.markAuth(auditRequest as never, 'accepted', 'shared_secret');
    await service.markHandlerStarted(auditRequest as never);
    await service.markError(auditRequest as never, new Error('invalid payload for audit test'));
    await service.complete(requestId, { statusCode: 200 });

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('auth_status = $2'),
      [requestId, 'accepted', 'shared_secret'],
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('handler_started_at = CURRENT_TIMESTAMP'),
      [requestId],
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('error_code = $2'),
      [requestId, 'invalid payload for audit test'],
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('status_code = $2'),
      [requestId, 200, 'accepted'],
    );
  });

  it('does not break the webhook when the audit database write fails', async () => {
    const service = new WebhookIngressAuditService({ query: vi.fn().mockRejectedValue(new Error('db unavailable')) } as never);

    await expect(service.begin(request() as never, undefined)).resolves.toBeUndefined();
    await expect(service.markAuth({} as never, 'rejected', 'invalid_signature')).resolves.toBeUndefined();
    await expect(service.complete(undefined, { statusCode: 500 })).resolves.toBeUndefined();
  });
});
