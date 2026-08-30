import { createHmac, timingSafeEqual } from 'node:crypto';
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { parseEnvironment } from '@dealeradmin/config';

type RawBodyRequest = Request & { rawBody?: Buffer };

export function verifyHmacSignature(rawBody: Buffer, signatureHeader: string | undefined, secret: string): boolean {
  if (!signatureHeader) return false;
  const provided = signatureHeader.replace(/^sha256=/i, '').trim();
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const providedBuffer = Buffer.from(provided, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  return providedBuffer.length === expectedBuffer.length && timingSafeEqual(providedBuffer, expectedBuffer);
}

export function verifySharedSecret(secretHeader: string | undefined, secret: string): boolean {
  if (!secretHeader || !secret) return false;
  const providedBuffer = Buffer.from(secretHeader.trim(), 'utf8');
  const expectedBuffer = Buffer.from(secret, 'utf8');
  return providedBuffer.length === expectedBuffer.length && timingSafeEqual(providedBuffer, expectedBuffer);
}

@Injectable()
export class HmacSignatureGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RawBodyRequest>();
    const signatureHeader = request.header('X-GHL-Signature');
    const sharedSecretHeader = request.header('X-DealerADMIN-Webhook-Secret');
    const rawBody = request.rawBody;
    const configuredSecret = parseEnvironment().GHL_WEBHOOK_SECRET;

    // GHL's native outbound Webhook action does not calculate an HMAC. It can
    // send a fixed custom header, so accept that transport while keeping the
    // HMAC path for signed integrations.
    if (verifySharedSecret(sharedSecretHeader, configuredSecret)) return true;

    if (!signatureHeader || !rawBody) {
      throw new UnauthorizedException('Missing webhook signature');
    }

    if (!verifyHmacSignature(rawBody, signatureHeader, configuredSecret)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }
    return true;
  }
}
