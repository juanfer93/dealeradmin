import { describe, expect, it } from 'vitest';
import { normalizeGhlAttachments } from '../../domain/ghl-attachment-normalizer';

describe('normalizeGhlAttachments', () => {
  it('accepts a URL string and infers audio from its extension', () => {
    expect(normalizeGhlAttachments('https://cdn.example.test/voice.ogg', 'message-1')).toEqual([
      expect.objectContaining({
        sourceUrl: 'https://cdn.example.test/voice.ogg',
        kind: 'audio',
        sourceMessageId: 'message-1',
      }),
    ]);
  });

  it('accepts native object metadata and preserves the raw attachment', () => {
    const result = normalizeGhlAttachments({
      url: 'https://cdn.example.test/id.png',
      contentType: 'image/png',
      filename: 'id.png',
      size: '1200',
      attachmentId: 'attachment-1',
    }, 'message-2');

    expect(result[0]).toMatchObject({
      sourceUrl: 'https://cdn.example.test/id.png',
      sourceId: 'attachment-1',
      contentType: 'image/png',
      kind: 'image',
      filename: 'id.png',
      size: 1200,
      raw: expect.objectContaining({ attachmentId: 'attachment-1' }),
    });
  });

  it('flattens arrays and ignores absent media without inventing attachments', () => {
    expect(normalizeGhlAttachments([null, '', { url: 'https://cdn.example.test/photo.jpg', type: 'image' }], 'message-3'))
      .toHaveLength(1);
    expect(normalizeGhlAttachments(undefined, 'message-4')).toEqual([]);
  });

  it('decodes a collector attachment array serialized as JSON text', () => {
    const result = normalizeGhlAttachments(
      JSON.stringify([
        { url: 'https://cdn.example.test/photo.jpg', content_type: 'image/jpeg' },
        { url: 'https://cdn.example.test/voice.ogg', content_type: 'audio/ogg' },
      ]),
      'message-serialized',
    );

    expect(result).toHaveLength(2);
    expect(result.map((item) => item.kind)).toEqual(['image', 'audio']);
    expect(result[0]?.sourceUrl).toBe('https://cdn.example.test/photo.jpg');
    expect(JSON.stringify(result)).not.toMatch(/secret|token|password/i);
  });

  it('accepts native media_url and mime aliases from a nested GHL message', () => {
    const result = normalizeGhlAttachments({
      mediaUrl: 'https://cdn.example.test/equinox.webp',
      mime: 'image/webp',
      fileName: 'equinox.webp',
    }, 'message-native-media');

    expect(result[0]).toMatchObject({
      sourceUrl: 'https://cdn.example.test/equinox.webp',
      contentType: 'image/webp',
      kind: 'image',
      filename: 'equinox.webp',
    });
  });
});
