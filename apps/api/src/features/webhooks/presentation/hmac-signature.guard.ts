import { createHmac, timingSafeEqual } from 'node:crypto';
import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { parseEnvironment } from '@dealeradmin/config';

type RawBodyRequest = Request & { rawBody?: Buffer };

export function verifyHmacSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  secret: string,
  timestampHeader?: string,
  nowMs = Date.now(),
): boolean {
  if (!signatureHeader) return false;
  if (timestampHeader !== undefined && !isFreshTimestamp(timestampHeader, nowMs)) return false;
  const provided = signatureHeader.replace(/^sha256=/i, '').trim();
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const providedBuffer = Buffer.from(provided, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  return providedBuffer.length === expectedBuffer.length && timingSafeEqual(providedBuffer, expectedBuffer);
}

const HMAC_MAX_AGE_MS = 5 * 60 * 1000;

export function isFreshTimestamp(timestampHeader: string, nowMs = Date.now()): boolean {
  const timestampMs = Number(timestampHeader) * 1000;
  return Number.isFinite(timestampMs) && Math.abs(nowMs - timestampMs) <= HMAC_MAX_AGE_MS;
}

export function verifySharedSecret(secretHeader: string | undefined, secret: string): boolean {
  if (!secretHeader || !secret) return false;
  const providedBuffer = Buffer.from(secretHeader.trim(), 'utf8');
  const expectedBuffer = Buffer.from(secret, 'utf8');
  return providedBuffer.length === expectedBuffer.length && timingSafeEqual(providedBuffer, expectedBuffer);
}

@Injectable()
export class HmacSignatureGuard implements CanActivate {
  private readonly logger = new Logger(HmacSignatureGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RawBodyRequest>();
    const signatureHeader = request.header('X-GHL-Signature');
    const sharedSecretHeader = request.header('X-DealerADMIN-Webhook-Secret');
    const rawBody = request.rawBody;
    const timestampHeader = request.header('X-GHL-Timestamp');
    const configuredSecret = parseEnvironment().GHL_WEBHOOK_SECRET;
    const authorization = request.header('Authorization');
    const cronSecret = process.env.CRON_SECRET?.trim();
    const bearerSecret = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];

    if (
      request.method === 'GET'
      && request.path.endsWith('/webhooks/ghl/conversations/process-due')
      && verifySharedSecret(bearerSecret, cronSecret ?? '')
    ) return true;

    // GHL's native outbound Webhook action does not calculate an HMAC. It can
    // send a fixed custom header, so accept that transport while keeping the
    // HMAC path for signed integrations.
    if (verifySharedSecret(sharedSecretHeader, configuredSecret)) return true;

    if (!signatureHeader || !rawBody) {
      this.logger.warn(`Rejected unsigned webhook: ${request.method} ${request.originalUrl} from ${request.ip}`);
      throw new UnauthorizedException('Missing webhook signature');
    }

    if (!verifyHmacSignature(rawBody, signatureHeader, configuredSecret, timestampHeader)) {
      this.logger.warn(`Rejected invalid webhook signature: ${request.method} ${request.originalUrl} from ${request.ip}`);
      throw new UnauthorizedException('Invalid webhook signature');
    }
    return true;
  }
}
