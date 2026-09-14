export type MediaKind = 'audio' | 'image' | 'unknown';

export type NormalizedGhlAttachment = {
  sourceUrl: string | null;
  sourceId: string | null;
  contentType: string | null;
  kind: MediaKind;
  filename: string | null;
  size: number | null;
  expiresAt: string | null;
  sourceMessageId: string;
  raw: Record<string, unknown>;
};

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};

const asText = (value: unknown): string | null => {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
};

const firstText = (record: UnknownRecord, keys: string[]): string | null => {
  for (const key of keys) {
    const value = asText(record[key]);
    if (value) return value;
  }
  return null;
};

const asSize = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value !== 'string') return null;
  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
};

function inferKind(contentType: string | null, filename: string | null, declaredKind: string | null): MediaKind {
  const source = [contentType, filename, declaredKind].filter(Boolean).join(' ').toLowerCase();
  if (/\baudio\b|\.(?:ogg|oga|opus|aac|m4a|mp3|wav|webm)(?:$|\?)/i.test(source)) return 'audio';
  if (/\bimage\b|\.(?:jpg|jpeg|png|gif|webp|heic|bmp|tiff?)(?:$|\?)/i.test(source)) return 'image';
  return 'unknown';
}

function flattenAttachments(value: unknown): unknown[] {
  if (value === undefined || value === null || value === '') return [];
  return Array.isArray(value) ? value.flatMap((item) => flattenAttachments(item)) : [value];
}

export function normalizeGhlAttachments(value: unknown, sourceMessageId: string): NormalizedGhlAttachment[] {
  return flattenAttachments(value).map((item): NormalizedGhlAttachment => {
    const record = asRecord(item);
    const sourceUrl = typeof item === 'string'
      ? asText(item)
      : firstText(record, ['url', 'href', 'download_url', 'downloadUrl', 'file_url', 'fileUrl']);
    const contentType = typeof item === 'string' ? null : firstText(record, ['content_type', 'contentType', 'mime_type', 'mimeType']);
    const filename = typeof item === 'string' ? null : firstText(record, ['filename', 'file_name', 'fileName', 'name']);
    const declaredKind = typeof item === 'string' ? null : firstText(record, ['kind', 'type', 'media_type', 'mediaType']);

    return {
      sourceUrl,
      sourceId: typeof item === 'string' ? null : firstText(record, ['attachment_id', 'attachmentId', 'id']),
      contentType,
      kind: inferKind(contentType, filename || sourceUrl, declaredKind),
      filename,
      size: typeof item === 'string' ? null : asSize(record.size ?? record.byte_size ?? record.byteSize),
      expiresAt: typeof item === 'string' ? null : firstText(record, ['expires_at', 'expiresAt', 'url_expires_at', 'urlExpiresAt']),
      sourceMessageId,
      raw: typeof item === 'string' ? { url: item } : record,
    };
  });
}
