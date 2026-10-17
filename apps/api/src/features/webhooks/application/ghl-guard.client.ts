import { ghlGuardTimeoutMs } from './ghl-guard.config';

export type GhlGuardMessage = {
  id?: string;
  altId?: string;
  body?: unknown;
  direction?: unknown;
  dateAdded?: unknown;
  messageType?: unknown;
  source?: unknown;
  attachments?: unknown;
  [key: string]: unknown;
};

type GhlSearchResponse = {
  conversations?: Array<{ id?: string; locationId?: string; [key: string]: unknown }>;
  total?: number;
};

type GhlMessagesResponse = {
  messages?: {
    messages?: GhlGuardMessage[];
    nextPage?: boolean;
    lastMessageId?: string;
  } | GhlGuardMessage[];
};

export type GhlGuardConversation = {
  id: string;
  locationId?: string;
};

export type GhlGuardFetchResult<T> = {
  ok: boolean;
  status: number;
  data?: T;
  errorCode?: string;
  requestPath?: string;
  responsePayload?: unknown;
};

export type GhlGuardMessagesResult = {
  messages: GhlGuardMessage[];
  pages: number;
  truncated: boolean;
  responsePayload: unknown[];
};

const DEFAULT_BASE_URL = 'https://services.leadconnectorhq.com';
const DEFAULT_VERSION = '2021-07-28';
const DEFAULT_PAGE_LIMIT = 100;
const DEFAULT_MAX_PAGES = 2;

export type GhlGuardRequestOptions = {
  deadlineAt?: number;
};

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function safeErrorCode(status: number, error: unknown): string {
  if (status === 401) return 'GHL_UNAUTHORIZED';
  if (status === 403) return 'GHL_FORBIDDEN_SCOPE';
  if (status === 404) return 'GHL_NOT_FOUND';
  if (status === 429) return 'GHL_RATE_LIMITED';
  if (status >= 500) return `GHL_HTTP_${status}`;
  if (error instanceof Error && error.name === 'AbortError') return 'GHL_TIMEOUT';
  if (error instanceof Error && /authentication.*timed out|auth(?:entication)?[^\n]*timed out/i.test(error.message)) return 'GHL_AUTH_TIMEOUT';
  return status > 0 ? `GHL_HTTP_${status}` : 'GHL_NETWORK_ERROR';
}

function retryDelayMs(response: Response, attempt: number): number {
  const retryAfter = Number(response.headers.get('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter >= 0) return Math.min(retryAfter * 1000, 5_000);
  return Math.min(250 * (attempt + 1), 2_000);
}

function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

function isRetryableTransportError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === 'AbortError' || /timed out|timeout|temporarily unavailable|econnreset|socket hang up/i.test(error.message);
}

function shouldRetryThrownError(error: unknown): boolean {
  // Preserve the previous retry behavior for ordinary thrown errors while
  // adding retries for request-level aborts caused by transient timeouts.
  if (!(error instanceof Error)) return true;
  return error.name !== 'AbortError' || isRetryableTransportError(error);
}

export class GhlGuardClient {
  private readonly baseUrl = (process.env.GHL_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
  private readonly version = process.env.GHL_API_VERSION || DEFAULT_VERSION;
  private readonly timeoutMs = ghlGuardTimeoutMs();
  private readonly pageLimit = positiveInteger(process.env.GHL_GUARD_MESSAGE_PAGE_LIMIT, DEFAULT_PAGE_LIMIT);
  private readonly maxPages = positiveInteger(process.env.GHL_GUARD_MAX_PAGES, DEFAULT_MAX_PAGES);

  async searchLatestConversation(token: string, locationId: string, options?: GhlGuardRequestOptions): Promise<GhlGuardFetchResult<{ conversations: GhlGuardConversation[]; total: number }>> {
    const path = `/conversations/search?locationId=${encodeURIComponent(locationId)}&limit=1&sort=desc`;
    const response = await this.get<GhlSearchResponse>(path, token, options);
    if (!response.ok) return { ok: false, status: response.status, errorCode: response.errorCode, requestPath: path, responsePayload: response.responsePayload };
    const conversations = (response.data?.conversations ?? [])
      .filter((conversation): conversation is GhlGuardConversation => typeof conversation.id === 'string')
      .map((conversation) => ({ id: conversation.id, locationId: conversation.locationId }));
    return { ok: true, status: response.status, requestPath: path, data: { conversations, total: Number(response.data?.total ?? 0) } };
  }

  async searchConversationByContact(token: string, locationId: string, contactId: string, options?: GhlGuardRequestOptions): Promise<GhlGuardFetchResult<{ conversation: GhlGuardConversation | null; total: number }>> {
    const path = `/conversations/search?locationId=${encodeURIComponent(locationId)}&contactId=${encodeURIComponent(contactId)}&limit=20&sort=desc`;
    const response = await this.get<GhlSearchResponse>(path, token, options);
    if (!response.ok) return { ok: false, status: response.status, errorCode: response.errorCode, requestPath: path, responsePayload: response.responsePayload };
    const conversation = (response.data?.conversations ?? [])
      .find((candidate) => typeof candidate.id === 'string' && (!candidate.locationId || candidate.locationId === locationId));
    return {
      ok: true,
      status: response.status,
      requestPath: path,
      data: {
        conversation: conversation?.id ? { id: conversation.id, locationId: conversation.locationId } : null,
        total: Number(response.data?.total ?? 0),
      },
    };
  }

  async listMessages(token: string, conversationId: string, options?: GhlGuardRequestOptions): Promise<GhlGuardFetchResult<GhlGuardMessagesResult>> {
    const messages: GhlGuardMessage[] = [];
    let lastMessageId: string | undefined;
    let pages = 0;
    let nextPage = true;
    const responsePayload: unknown[] = [];
    const requestPath = `/conversations/${encodeURIComponent(conversationId)}/messages`;

    while (nextPage && pages < this.maxPages) {
      const query = new URLSearchParams({ limit: String(this.pageLimit) });
      if (lastMessageId) query.set('lastMessageId', lastMessageId);
      const path = `${requestPath}?${query.toString()}`;
      const response = await this.get<GhlMessagesResponse>(path, token, options);
      if (!response.ok) return { ok: false, status: response.status, errorCode: response.errorCode, requestPath, responsePayload: response.responsePayload };

      responsePayload.push(response.data);
      const payload = response.data?.messages;
      const pageMessages = Array.isArray(payload) ? payload : payload?.messages ?? [];
      messages.push(...pageMessages);
      pages += 1;
      nextPage = !Array.isArray(payload) && payload?.nextPage === true;
      const nextLastMessageId = !Array.isArray(payload) ? payload?.lastMessageId : undefined;
      if (!nextLastMessageId || nextLastMessageId === lastMessageId) nextPage = false;
      lastMessageId = nextLastMessageId;
    }

    return {
      ok: true,
      status: 200,
      requestPath,
      data: { messages, pages, truncated: nextPage, responsePayload },
    };
  }

  private async get<T>(path: string, token: string, options: GhlGuardRequestOptions = {}): Promise<GhlGuardFetchResult<T>> {
    const attempts = 3;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const remainingMs = options.deadlineAt === undefined ? Infinity : options.deadlineAt - Date.now();
      if (remainingMs <= 0) return { ok: false, status: 0, errorCode: 'GHL_TIMEOUT', requestPath: path };
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), Math.max(1, Math.min(this.timeoutMs, remainingMs)));
      try {
        const response = await fetch(`${this.baseUrl}${path}`, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${token}`,
            Version: this.version,
          },
          signal: controller.signal,
        });
        if (response.ok) {
          return { ok: true, status: response.status, data: await response.json() as T };
        }
        if (isRetryable(response.status) && attempt < attempts - 1) {
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs(response, attempt)));
          continue;
        }
        let responsePayload: unknown;
        try { responsePayload = await response.json(); } catch { /* Some gateway errors have no JSON body. */ }
        return { ok: false, status: response.status, errorCode: safeErrorCode(response.status, undefined), responsePayload };
      } catch (error) {
        if (attempt < attempts - 1 && shouldRetryThrownError(error)) {
          await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
          continue;
        }
        return { ok: false, status: 0, errorCode: safeErrorCode(0, error), requestPath: path };
      } finally {
        clearTimeout(timeout);
      }
    }
    return { ok: false, status: 0, errorCode: 'GHL_NETWORK_ERROR' };
  }
}
