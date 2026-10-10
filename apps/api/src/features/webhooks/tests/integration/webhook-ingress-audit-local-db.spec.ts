import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebhookIngressAuditService } from '../../application/webhook-ingress-audit.service';

const databaseUrl = process.env.WEBHOOK_INGRESS_AUDIT_LOCAL_DATABASE_URL || process.env.DATABASE_URL;
const describeDatabase = databaseUrl && /(localhost|127\.0\.0\.1)/i.test(databaseUrl) ? describe : describe.skip;

describeDatabase('webhook ingress audit against local PostgreSQL', () => {
  let dataSource: DataSource;
  const requestIds: string[] = [];

  beforeAll(async () => {
    if (!databaseUrl) throw new Error('WEBHOOK_INGRESS_AUDIT_LOCAL_DATABASE_URL is required');
    dataSource = new DataSource({ type: 'postgres', url: databaseUrl, entities: [] });
    await dataSource.initialize();
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    if (requestIds.length > 0) {
      await dataSource.query('DELETE FROM webhook_ingress_logs WHERE request_id = ANY($1::uuid[])', [requestIds]);
    }
    await dataSource.destroy();
  });

  function makeRequest(eventId: string) {
    const rawBody = JSON.stringify({
      event_id: eventId,
      event_type: 'customer.replied',
      ghl_location_id: 'bAuMEQeH48xAtu9tAMFf',
      ghl_contact_id: `local-audit-${eventId}`,
      ghl_conversation_id: `local-conversation-${eventId}`,
      message_body: 'Emmanuel audit evidence',
      contact_phone: '+15402870414',
    });
    return {
      method: 'POST',
      originalUrl: '/api/webhooks/ghl/customer-replied/fredericksburg-2',
      rawBody: Buffer.from(rawBody),
      header: (name: string) => ({
        'content-type': 'application/json',
        'X-GHL-Signature': 'sha256=present',
        'X-GHL-Timestamp': '1760090000',
        'X-DealerADMIN-Contact-ID': `local-audit-${eventId}`,
      }[name]),
    };
  }

  it('persists accepted ingress and processing milestones', async () => {
    const service = new WebhookIngressAuditService(dataSource);
    const auditRequest = makeRequest(`local-audit-accepted-${Date.now()}`);
    const requestId = await service.begin(auditRequest as never, undefined);
    if (!requestId) throw new Error('Expected a durable audit request id');
    requestIds.push(requestId);

    await service.markAuth(auditRequest as never, 'accepted', 'shared_secret');
    await service.markHandlerStarted(auditRequest as never);
    await service.complete(requestId, { statusCode: 200 });

    const rows = await dataSource.query(
      `SELECT event_id, source, auth_status, handler_started_at, status_code, outcome,
              payload_hash, raw_body, safe_headers, duration_ms
       FROM webhook_ingress_logs WHERE request_id = $1`,
      [requestId],
    ) as Array<Record<string, unknown>>;

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source: 'fredericksburg-2',
      auth_status: 'accepted',
      status_code: 200,
      outcome: 'accepted',
      raw_body: expect.stringContaining('Emmanuel audit evidence'),
    });
    expect(rows[0].event_id).toBe(auditRequest.rawBody && JSON.parse(auditRequest.rawBody.toString()).event_id);
    expect(rows[0].handler_started_at).toBeTruthy();
    expect(rows[0].payload_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].duration_ms).toEqual(expect.any(Number));
    expect(JSON.stringify(rows[0].safe_headers)).not.toContain('do-not-store-this-secret');
  });

  it('persists rejected ingress even when the route handler is never reached', async () => {
    const service = new WebhookIngressAuditService(dataSource);
    const auditRequest = makeRequest(`local-audit-rejected-${Date.now()}`);
    const requestId = await service.begin(auditRequest as never, undefined);
    if (!requestId) throw new Error('Expected a durable audit request id');
    requestIds.push(requestId);

    await service.markAuth(auditRequest as never, 'rejected', 'invalid_signature');
    await service.complete(requestId, { statusCode: 401 });

    const rows = await dataSource.query(
      `SELECT auth_status, auth_reason, handler_started_at, status_code, outcome
       FROM webhook_ingress_logs WHERE request_id = $1`,
      [requestId],
    ) as Array<Record<string, unknown>>;

    expect(rows).toEqual([expect.objectContaining({
      auth_status: 'rejected',
      auth_reason: 'invalid_signature',
      handler_started_at: null,
      status_code: 401,
      outcome: 'rejected',
    })]);
  });
});
