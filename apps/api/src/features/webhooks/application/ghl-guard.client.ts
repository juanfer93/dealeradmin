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
  attemptCount?: number;
  elapsedMs?: number;
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
const CONVERSATION_SEARCH_LIMIT = 1;

export type GhlGuardRequestOptions = {
  deadlineAt?: number;
  maxAttempts?: number;
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
  const retryAfterHeader = response.headers.get('retry-after');
  const retryAfter = retryAfterHeader === null ? Number.NaN : Number(retryAfterHeader);
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
    // Contact lookup is only a discovery step. Retrying it inside the same
    // conversation budget can consume the time needed to fetch messages and
    // leave the Guard as GHL_TIMEOUT. The next scheduled cycle is the durable
    // retry for this lookup.
    const response = await this.get<GhlSearchResponse>(path, token, { ...options, maxAttempts: 1 });
    if (!response.ok) return { ok: false, status: response.status, errorCode: response.errorCode, requestPath: path, responsePayload: response.responsePayload, attemptCount: response.attemptCount, elapsedMs: response.elapsedMs };
    const conversations = (response.data?.conversations ?? [])
      .filter((conversation): conversation is GhlGuardConversation => typeof conversation.id === 'string')
      .map((conversation) => ({ id: conversation.id, locationId: conversation.locationId }));
    return { ok: true, status: response.status, requestPath: path, data: { conversations, total: Number(response.data?.total ?? 0) }, attemptCount: response.attemptCount, elapsedMs: response.elapsedMs };
  }

  async searchConversationByContact(token: string, locationId: string, contactId: string, options?: GhlGuardRequestOptions): Promise<GhlGuardFetchResult<{ conversation: GhlGuardConversation | null; total: number }>> {
    // The guard only needs the newest conversation. Keeping the response small
    // reduces latency and avoids making GHL scan/serialize unrelated history.
    const path = `/conversations/search?locationId=${encodeURIComponent(locationId)}&contactId=${encodeURIComponent(contactId)}&limit=${CONVERSATION_SEARCH_LIMIT}&sort=desc`;
    const response = await this.get<GhlSearchResponse>(path, token, options);
    if (!response.ok) return { ok: false, status: response.status, errorCode: response.errorCode, requestPath: path, responsePayload: response.responsePayload, attemptCount: response.attemptCount, elapsedMs: response.elapsedMs };
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
      attemptCount: response.attemptCount,
      elapsedMs: response.elapsedMs,
    };
  }

  async listMessages(token: string, conversationId: string, options?: GhlGuardRequestOptions): Promise<GhlGuardFetchResult<GhlGuardMessagesResult>> {
    const messages: GhlGuardMessage[] = [];
    let lastMessageId: string | undefined;
    let pages = 0;
    let nextPage = true;
    let requestAttempts = 0;
    const startedAt = Date.now();
    const responsePayload: unknown[] = [];
    const requestPath = `/conversations/${encodeURIComponent(conversationId)}/messages`;

    while (nextPage && pages < this.maxPages) {
      const query = new URLSearchParams({ limit: String(this.pageLimit) });
      if (lastMessageId) query.set('lastMessageId', lastMessageId);
      const path = `${requestPath}?${query.toString()}`;
      const response = await this.get<GhlMessagesResponse>(path, token, options);
      requestAttempts += response.attemptCount ?? 0;
      if (!response.ok) return { ok: false, status: response.status, errorCode: response.errorCode, requestPath, responsePayload: response.responsePayload, attemptCount: requestAttempts, elapsedMs: Date.now() - startedAt };

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
      attemptCount: requestAttempts,
      elapsedMs: Date.now() - startedAt,
    };
  }

  private async get<T>(path: string, token: string, options: GhlGuardRequestOptions = {}): Promise<GhlGuardFetchResult<T>> {
    const attempts = Math.max(1, Math.min(3, options.maxAttempts ?? 3));
    const startedAt = Date.now();
    const telemetry = (attemptCount: number) => ({ attemptCount, elapsedMs: Date.now() - startedAt });
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const remainingMs = options.deadlineAt === undefined ? Infinity : options.deadlineAt - Date.now();
      if (remainingMs <= 0) return { ok: false, status: 0, errorCode: 'GHL_TIMEOUT', requestPath: path, ...telemetry(attempt) };
      const controller = new AbortController();
      const requestTimeoutMs = Math.max(1, Math.min(this.timeoutMs, remainingMs));
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const request = (async (): Promise<GhlGuardFetchResult<T>> => {
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
            return { ok: true, status: response.status, data: await response.json() as T, ...telemetry(attempt + 1) };
          }
          if (isRetryable(response.status) && attempt < attempts - 1) {
            const retryable = await this.waitForRetry(retryDelayMs(response, attempt), options.deadlineAt);
            if (!retryable) return { ok: false, status: 0, errorCode: 'GHL_TIMEOUT', requestPath: path, ...telemetry(attempt + 1) };
            return { ok: false, status: response.status, errorCode: 'GHL_RETRY', ...telemetry(attempt + 1) };
          }
          let responsePayload: unknown;
          try { responsePayload = await response.json(); } catch { /* Some gateway errors have no JSON body. */ }
          return { ok: false, status: response.status, errorCode: safeErrorCode(response.status, undefined), responsePayload, ...telemetry(attempt + 1) };
        })();
        const timedOut = new Promise<GhlGuardFetchResult<T>>((resolve) => {
          timeout = setTimeout(() => {
            controller.abort();
            resolve({
              ok: false,
              status: 0,
              errorCode: 'GHL_TIMEOUT',
              requestPath: path,
              ...telemetry(attempt + 1),
            });
          }, requestTimeoutMs);
        });
        const result = await Promise.race([request, timedOut]);
        if (result.errorCode === 'GHL_RETRY' && attempt < attempts - 1) continue;
        return result;
      } catch (error) {
        if (attempt < attempts - 1 && shouldRetryThrownError(error)) {
          const retryable = await this.waitForRetry(250 * (attempt + 1), options.deadlineAt);
          if (!retryable) return { ok: false, status: 0, errorCode: 'GHL_TIMEOUT', requestPath: path, ...telemetry(attempt + 1) };
          continue;
        }
        return { ok: false, status: 0, errorCode: safeErrorCode(0, error), requestPath: path, ...telemetry(attempt + 1) };
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    }
    return { ok: false, status: 0, errorCode: 'GHL_NETWORK_ERROR', requestPath: path, ...telemetry(attempts) };
  }

  private async waitForRetry(delayMs: number, deadlineAt?: number): Promise<boolean> {
    if (deadlineAt !== undefined && deadlineAt - Date.now() <= delayMs) return false;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return deadlineAt === undefined || deadlineAt > Date.now();
  }
}
