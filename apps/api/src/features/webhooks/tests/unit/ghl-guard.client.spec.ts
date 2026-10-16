import { afterEach, describe, expect, it, vi } from 'vitest';
import { GhlGuardClient } from '../../application/ghl-guard.client';

describe('GhlGuardClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('paginates GHL messages and sends the PIT-compatible headers', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ messages: { messages: [{ id: 'm-1', body: 'SUV', direction: 'inbound' }], nextPage: true, lastMessageId: 'm-1' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ messages: { messages: [{ id: 'm-2', body: '2018', direction: 'inbound' }], nextPage: false } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await new GhlGuardClient().listMessages('pit-test-token', 'conversation/1');

    expect(result).toEqual({
      ok: true,
      status: 200,
      requestPath: '/conversations/conversation%2F1/messages',
      data: {
        messages: [
          { id: 'm-1', body: 'SUV', direction: 'inbound' },
          { id: 'm-2', body: '2018', direction: 'inbound' },
        ],
        pages: 2,
        truncated: false,
        responsePayload: [
          { messages: { messages: [{ id: 'm-1', body: 'SUV', direction: 'inbound' }], nextPage: true, lastMessageId: 'm-1' } },
          { messages: { messages: [{ id: 'm-2', body: '2018', direction: 'inbound' }], nextPage: false } },
        ],
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstRequest = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((firstRequest.headers as Record<string, string>).Authorization).toBe('Bearer pit-test-token');
    expect((firstRequest.headers as Record<string, string>).Version).toBe('2021-07-28');
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('lastMessageId=m-1');
  });

  it('classifies a forbidden private-integration scope without leaking the token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 403 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await new GhlGuardClient().listMessages('pit-secret', 'conversation-1');

    expect(result).toMatchObject({ ok: false, status: 403, errorCode: 'GHL_FORBIDDEN_SCOPE' });
    expect(JSON.stringify(result)).not.toContain('pit-secret');
  });

  it('retries transient GHL failures and returns the successful page', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ messages: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await new GhlGuardClient().listMessages('pit-test-token', 'conversation-1');

    expect(result.ok).toBe(true);
    expect(result.data?.pages).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
