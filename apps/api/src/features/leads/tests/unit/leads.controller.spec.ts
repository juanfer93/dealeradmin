import { describe, expect, it, vi, afterEach } from 'vitest';
import { LeadsController } from '../../presentation/leads.controller';

const originalNodeEnv = process.env.NODE_ENV;

function createRunner(results: unknown[][]) {
  let active = false;
  const runner = {
    connect: vi.fn(async () => undefined),
    startTransaction: vi.fn(async () => { active = true; }),
    query: vi.fn(async () => results.shift() ?? []),
    commitTransaction: vi.fn(async () => { active = false; }),
    rollbackTransaction: vi.fn(async () => { active = false; }),
    release: vi.fn(async () => undefined),
    get isTransactionActive() { return active; },
  };
  return runner;
}

function createController(runner: ReturnType<typeof createRunner>) {
  const dataSource = { createQueryRunner: vi.fn(() => runner) };
  const authService = { verifySession: vi.fn(() => true) };
  const copyLeadService = { execute: vi.fn() };
  const conversationWebhookService = { queueLeadForBotSilence: vi.fn(async () => ({ queued: true })) };
  return new LeadsController(dataSource as never, authService as never, copyLeadService as never, conversationWebhookService as never);
}

describe('LeadsController deletion', () => {
  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  it('treats a stale queue delete as an idempotent success when the lead is absent', async () => {
    process.env.NODE_ENV = 'production';
    const runner = createRunner([[]]);
    const controller = createController(runner);

    await expect(controller.delete({ cookies: {} } as never, 'missing-lead', 'dealer-source'))
      .resolves.toEqual({ success: true, deletedLead: false, deletedRelationship: false });
    expect(runner.commitTransaction).toHaveBeenCalledOnce();
    expect(runner.rollbackTransaction).not.toHaveBeenCalled();
  });

  it('removes a dealer relationship even when it is already sent', async () => {
    process.env.NODE_ENV = 'production';
    const runner = createRunner([
      [{ id: 'lead-sent' }],
      [{ lead_id: 'lead-sent' }],
    ]);
    const controller = createController(runner);

    await expect(controller.delete({ cookies: {} } as never, 'lead-sent', 'dealer-source'))
      .resolves.toEqual({ success: true, deletedLead: false, deletedRelationship: true });
    const calls = runner.query.mock.calls as unknown[][];
    expect(calls[1]?.[0]).not.toContain("status <> 'sent'");
    expect(calls).toHaveLength(2);
    expect(runner.commitTransaction).toHaveBeenCalledOnce();
  });

  it('removes only the dealer queue relationship and preserves ingestion history', async () => {
    process.env.NODE_ENV = 'production';
    const runner = createRunner([
      [{ id: 'lead-1' }],
      [{ lead_id: 'lead-1' }],
      [{ count: '0' }],
      [{ id: 'ingestion-row-1' }],
    ]);
    const controller = createController(runner);

    await expect(controller.delete({ cookies: {} } as never, 'lead-1', 'dealer-source'))
      .resolves.toEqual({ success: true, deletedLead: false, deletedRelationship: true });
    const calls = runner.query.mock.calls as unknown[][];
    expect(calls[1]?.[0]).toContain('DELETE FROM lead_dealers');
    expect(calls).toHaveLength(2);
    expect(runner.commitTransaction).toHaveBeenCalledOnce();
  });

  it('preserves the lead record when its last dealer relationship is removed', async () => {
    process.env.NODE_ENV = 'production';
    const runner = createRunner([
      [{ id: 'lead-1' }],
      [{ lead_id: 'lead-1' }],
    ]);
    const controller = createController(runner);

    await expect(controller.delete({ cookies: {} } as never, 'lead-1', 'dealer-source'))
      .resolves.toEqual({ success: true, deletedLead: false, deletedRelationship: true });
    const calls = runner.query.mock.calls as unknown[][];
    expect(calls).toHaveLength(2);
    expect(runner.commitTransaction).toHaveBeenCalledOnce();
  });

  it('does not delete the conversation when its last dealer relationship is removed', async () => {
    process.env.NODE_ENV = 'production';
    const runner = createRunner([
      [{ id: 'lead-1' }],
      [{ lead_id: 'lead-1' }],
    ]);
    const controller = createController(runner);

    await expect(controller.delete({ cookies: {} } as never, 'lead-1', 'dealer-source'))
      .resolves.toEqual({ success: true, deletedLead: false, deletedRelationship: true });
    const calls = runner.query.mock.calls as unknown[][];
    expect(calls).toHaveLength(2);
    expect(runner.commitTransaction).toHaveBeenCalledOnce();
  });

  it('purges only the selected dealer lead, its conversation traces, and creates a re-entry suppression', async () => {
    process.env.NODE_ENV = 'production';
    const runner = createRunner([
      [{ id: 'lead-purge', ghl_contact_id: 'ghl-purge', ghl_location_id: 'loc-purge', canonical_phone: '+18046503373' }],
      [{ lead_id: 'lead-purge' }],
      [{ count: 1 }],
      [],
      [],
      [{ id: 'conversation-purge' }],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
    ]);
    const controller = createController(runner);

    await expect(controller.purge({ cookies: {} } as never, 'lead-purge', 'dealer-purge'))
      .resolves.toEqual({
        success: true,
        deletedLead: true,
        deletedRelationship: true,
        deletedConversationCount: 1,
        suppressed: true,
      });

    const calls = runner.query.mock.calls as unknown[][];
    expect(calls.some(([sql]) => String(sql).includes('INSERT INTO lead_deletion_suppressions'))).toBe(true);
    expect(calls.some(([sql]) => String(sql).includes('DELETE FROM conversations'))).toBe(true);
    expect(calls.some(([sql]) => String(sql).includes('DELETE FROM leads'))).toBe(true);
    expect(runner.commitTransaction).toHaveBeenCalledOnce();
    expect(runner.release).toHaveBeenCalledOnce();
  });

  it('purges only the selected dealer relationship when the lead is shared', async () => {
    process.env.NODE_ENV = 'production';
    const runner = createRunner([
      [{ id: 'lead-shared', ghl_contact_id: 'ghl-shared', ghl_location_id: 'loc-shared', canonical_phone: '+18046503373' }],
      [{ lead_id: 'lead-shared' }],
      [{ count: 2 }],
      [{ lead_id: 'lead-shared' }],
    ]);
    const controller = createController(runner);

    await expect(controller.purge({ cookies: {} } as never, 'lead-shared', 'dealer-spanish'))
      .resolves.toEqual({
        success: true,
        deletedLead: false,
        deletedRelationship: true,
        deletedConversationCount: 0,
        suppressed: false,
      });

    const calls = runner.query.mock.calls as unknown[][];
    expect(calls[3]?.[0]).toContain('DELETE FROM lead_dealers');
    expect(calls[3]?.[1]).toEqual(['lead-shared', 'dealer-spanish']);
    expect(calls.some(([sql]) => String(sql).includes('DELETE FROM conversations'))).toBe(false);
    expect(calls.some(([sql]) => String(sql).includes('DELETE FROM leads'))).toBe(false);
    expect(calls.some(([sql]) => String(sql).includes('INSERT INTO lead_deletion_suppressions'))).toBe(false);
    expect(runner.commitTransaction).toHaveBeenCalledOnce();
    expect(runner.release).toHaveBeenCalledOnce();
  });
});

describe('LeadsController queue read', () => {
  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  it('does not reconcile conversations synchronously before reading the queue', async () => {
    process.env.NODE_ENV = 'production';
    const dataSource = {
      query: vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ count: 0 }]),
    };
    const authService = { verifySession: vi.fn(() => true) };
    const copyLeadService = { execute: vi.fn() };
    const controller = new LeadsController(
      dataSource as never,
      authService as never,
      copyLeadService as never,
      { queueLeadForBotSilence: vi.fn(async () => ({ queued: true })) } as never,
    );

    await expect(controller.list({ cookies: {} } as never, 'pending')).resolves.toEqual({ dealers: [], leads: [], wroteAgainCount: 0 });
    expect(dataSource.query).toHaveBeenCalledTimes(3);
    expect(dataSource.query.mock.calls[0]?.[0]).toContain("$1 <> 'pending' OR COALESCE(ld.routing_status, 'resolved') <> 'not_qualified'");
    expect(dataSource.query.mock.calls[0]?.[0]).toContain("COALESCE(NULLIF(l.canonical_phone, ''),");
    expect(dataSource.query.mock.calls[1]?.[0]).toContain("ld.status = 'pending' AND COALESCE(ld.routing_status, 'resolved') <> 'not_qualified'");
    expect(dataSource.query.mock.calls[2]?.[0]).toContain('has_unhandled_reengagement');
  });

  it('keeps the sent view clean after monthly report archival without deleting rows', async () => {
    process.env.NODE_ENV = 'production';
    const dataSource = {
      query: vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ count: 0 }]),
    };
    const authService = { verifySession: vi.fn(() => true) };
    const copyLeadService = { execute: vi.fn() };
    const controller = new LeadsController(dataSource as never, authService as never, copyLeadService as never, { queueLeadForBotSilence: vi.fn(async () => ({ queued: true })) } as never);

    await controller.list({ cookies: {} } as never, 'sent');
    expect(dataSource.query.mock.calls[0]?.[0]).toContain("$1 <> 'sent' OR ld.queue_archived_at IS NULL");
    expect(dataSource.query.mock.calls[0]?.[0]).not.toContain('DELETE FROM');
  });
});

describe('LeadsController lead editing', () => {
  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  it('updates the lead and its dealer relationship in one transaction', async () => {
    process.env.NODE_ENV = 'production';
    const runner = createRunner([
      [],
      [],
      [{ id: 'lead-1' }],
      [{ lead_id: 'lead-1' }],
      [{ id: 'lead-1', dealerId: 'dealer-1', name: 'Ana Corregida', phone: '+13019876543' }],
    ]);
    const controller = createController(runner);

    await expect(controller.updateLead({ cookies: {} } as never, 'lead-1', {
      dealerId: 'dealer-1',
      name: 'Ana Corregida',
      phone: '3019876543',
      vehicle_type: 'Honda Civic',
      down_payment: '1500',
      identification: 'yes',
      bank_account: 'yes',
      documents: 'proof of income',
      purchase_timeline: 'this week',
    })).resolves.toEqual({
      success: true,
      lead: { id: 'lead-1', dealerId: 'dealer-1', name: 'Ana Corregida', phone: '+13019876543' },
    });

    const calls = runner.query.mock.calls as unknown[][];
    expect(calls[1]?.[0]).toContain('FROM leads l');
    expect(calls[2]?.[0]).toContain('UPDATE leads');
    expect(calls[3]?.[0]).toContain('UPDATE lead_dealers');
    expect(runner.commitTransaction).toHaveBeenCalledOnce();
    expect(runner.release).toHaveBeenCalledOnce();
  });
});

describe('LeadsController queue status synchronization', () => {
  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  it('marks the queued conversation sent after its last pending dealer relation is sent', async () => {
    process.env.NODE_ENV = 'production';
    const dataSource = {
      query: vi.fn()
        .mockResolvedValueOnce([{ lead_id: 'lead-1' }])
        .mockResolvedValueOnce([]),
    };
    const authService = { verifySession: vi.fn(() => true) };
    const copyLeadService = { execute: vi.fn() };
    const conversationWebhookService = { queueLeadForBotSilence: vi.fn(async () => ({ queued: true })) };
    const controller = new LeadsController(dataSource as never, authService as never, copyLeadService as never, conversationWebhookService as never);

    await expect(controller.updateStatus({ cookies: {} } as never, 'lead-1', {
      status: 'sent',
      dealerId: 'dealer-1',
    })).resolves.toEqual({ success: true });

    expect(dataSource.query).toHaveBeenCalledTimes(1);
    expect(conversationWebhookService.queueLeadForBotSilence).toHaveBeenCalledWith('lead-1');
  });
});

describe('LeadsController conversation history', () => {
  it('returns the dealer-scoped channel, queued state, and ordered message rows', async () => {
    process.env.NODE_ENV = 'production';
    const dataSource = {
      query: vi.fn(async () => [
        { conversationId: 'conversation-1', channel: 'whatsapp', conversationStatus: 'queued', firstMessageAt: '2026-11-01T10:00:00Z', lastMessageAt: '2026-11-01T10:02:00Z', messageId: 'message-1', direction: 'inbound', body: 'Hola', occurredAt: '2026-11-01T10:00:00Z' },
        { conversationId: 'conversation-1', channel: 'whatsapp', conversationStatus: 'queued', firstMessageAt: '2026-11-01T10:00:00Z', lastMessageAt: '2026-11-01T10:02:00Z', messageId: 'message-2', direction: 'outbound', body: '¿En qué puedo ayudarte?', occurredAt: '2026-11-01T10:02:00Z' },
      ]),
    };
    const controller = new LeadsController(
      dataSource as never,
      { verifySession: vi.fn(() => true) } as never,
      { execute: vi.fn() } as never,
      { queueLeadForBotSilence: vi.fn() } as never,
    );

    await expect(controller.conversation({ cookies: { dealeradmin_session: 'session' } } as never, 'lead-1', 'dealer-1'))
      .resolves.toEqual({ conversations: [{
        id: 'conversation-1', channel: 'whatsapp', status: 'queued',
        firstMessageAt: '2026-11-01T10:00:00Z', lastMessageAt: '2026-11-01T10:02:00Z',
        messages: [
          { id: 'message-1', direction: 'inbound', body: 'Hola', occurredAt: '2026-11-01T10:00:00Z' },
          { id: 'message-2', direction: 'outbound', body: '¿En qué puedo ayudarte?', occurredAt: '2026-11-01T10:02:00Z' },
        ],
      }] });
    expect(dataSource.query).toHaveBeenCalledWith(expect.stringContaining('COALESCE(ld.assigned_dealer_id, ld.dealer_id) = $2'), ['lead-1', 'dealer-1']);
  });
});
