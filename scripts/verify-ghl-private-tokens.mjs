#!/usr/bin/env node

/**
 * Read-only smoke test for HighLevel Private Integration Tokens.
 *
 * The script never prints token values or message bodies. It checks:
 *   1. conversations.readonly by searching one conversation in each location;
 *   2. conversations/message.readonly by reading one page of messages when a
 *      conversation exists; and
 *   3. that the returned locationId matches the configured location.
 *
 * Required environment variables are intentionally kept outside the repo.
 */

const DEFAULT_BASE_URL = 'https://services.leadconnectorhq.com';
const DEFAULT_API_VERSION = '2021-07-28';
const DEFAULT_TIMEOUT_MS = 15_000;

const LOCATIONS = [
  ['STAFFORD', 'LiaoSID3nvAhad49ZpNJ'],
  ['FREDERICKSBURG', 'MyxWNKacThim798E8KC6'],
  ['FREDERICKSBURG_2', 'bAuMEQeH48xAtu9tAMFf'],
  ['EASTERNS', 'xN2LSSl62okzv9GnOJPU'],
  ['ARLINGTON', '9v8zH9Y5eLiiJwZTZDci'],
  ['KOONS_FRED', 'xuHo0opTO2g5edIuPJRl'],
  ['KOONS_FRED_ENG', 'ozAIEblxTjrh0PfoaHge'],
  ['KOONS_CULPEPER', 'bTNJHpNZ8FaS1PUHkuUq'],
  ['ACTION_CARS', 'ZxadcudjvBz7KFCB1od4'],
  ['EASTERNS_MILLERSVILLE', '113zMWQlhKKBUu5wOYtR'],
  ['EASTERNS_FREDERICK', 'MRHcOwdTqaN5cug3eSWW'],
].map(([name, locationId]) => ({
  name,
  locationId,
  envName: `GHL_PRIVATE_TOKEN_${name}`,
}));

function numberEnv(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const baseUrl = (process.env.GHL_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
const apiVersion = process.env.GHL_API_VERSION || DEFAULT_API_VERSION;
const timeoutMs = numberEnv('GHL_TOKEN_VERIFY_TIMEOUT_MS', DEFAULT_TIMEOUT_MS);

function classifyHttpStatus(status) {
  if (status === 0) return 'network_error';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden_scope';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  return 'api_error';
}

async function readSafeError(response) {
  try {
    const payload = await response.json();
    const value = payload?.message || payload?.error || payload?.code;
    return typeof value === 'string' ? value.slice(0, 160) : undefined;
  } catch {
    return undefined;
  }
}

async function ghlGet(path, token) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        Version: apiVersion,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: await readSafeError(response),
      };
    }

    return { ok: true, status: response.status, data: await response.json() };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error?.name === 'AbortError' ? `timeout_after_${timeoutMs}ms` : 'network_error',
    };
  } finally {
    clearTimeout(timer);
  }
}

function resultFor(location, status, extra = {}) {
  return {
    dealer: location.name,
    locationId: location.locationId,
    tokenEnv: location.envName,
    status,
    ...extra,
  };
}

async function verifyLocation(location) {
  const token = process.env[location.envName]?.trim();
  if (!token) return resultFor(location, 'missing_env');

  const searchPath = `/conversations/search?locationId=${encodeURIComponent(location.locationId)}&limit=1&sort=desc`;
  const search = await ghlGet(searchPath, token);
  if (!search.ok) {
    return resultFor(location, classifyHttpStatus(search.status), {
      endpoint: 'conversations/search',
      httpStatus: search.status || undefined,
      detail: search.error,
    });
  }

  const conversations = Array.isArray(search.data?.conversations) ? search.data.conversations : [];
  const mismatched = conversations.find((conversation) => conversation?.locationId && conversation.locationId !== location.locationId);
  if (mismatched) {
    return resultFor(location, 'location_mismatch', {
      endpoint: 'conversations/search',
      returnedLocationId: mismatched.locationId,
      conversationAccess: 'ok',
    });
  }

  const conversation = conversations.find((item) => typeof item?.id === 'string');
  if (!conversation) {
    return resultFor(location, 'conversation_access_ok_messages_not_tested', {
      endpoint: 'conversations/search',
      conversationCount: Number.isFinite(search.data?.total) ? search.data.total : 0,
    });
  }

  const messagesPath = `/conversations/${encodeURIComponent(conversation.id)}/messages?limit=1`;
  const messages = await ghlGet(messagesPath, token);
  if (!messages.ok) {
    return resultFor(location, classifyHttpStatus(messages.status), {
      endpoint: 'conversations/:conversationId/messages',
      httpStatus: messages.status || undefined,
      conversationAccess: 'ok',
      detail: messages.error,
    });
  }

  const messageList = Array.isArray(messages.data?.messages?.messages)
    ? messages.data.messages.messages
    : Array.isArray(messages.data?.messages)
      ? messages.data.messages
      : [];

  return resultFor(location, 'ok', {
    endpoint: 'conversations/:conversationId/messages',
    conversationAccess: 'ok',
    messageAccess: 'ok',
    conversationCount: Number.isFinite(search.data?.total) ? search.data.total : undefined,
    sampleMessageCount: messageList.length,
  });
}

function printResults(results) {
  console.table(results.map(({ locationId, ...result }) => ({ locationId, ...result })));
  const counts = results.reduce((summary, result) => {
    summary[result.status] = (summary[result.status] || 0) + 1;
    return summary;
  }, {});
  console.log(`Resumen: ${JSON.stringify(counts)}`);
}

const results = [];
for (const location of LOCATIONS) {
  results.push(await verifyLocation(location));
}

printResults(results);

if (process.argv.includes('--strict') && results.some((result) => result.status !== 'ok')) {
  process.exitCode = 1;
}
