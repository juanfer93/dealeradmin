import { ExecutionContext, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { afterEach, describe, expect, it } from 'vitest';
import { GhlContextSecretGuard } from '../../presentation/ghl-context-secret.guard';

function contextWithHeader(value?: string): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ header: (name: string) => name === 'X-DealerADMIN-Context-Secret' ? value : undefined }) }),
  } as never;
}

describe('GhlContextSecretGuard', () => {
  afterEach(() => { delete process.env.GHL_CONTEXT_API_SECRET; });

  it('requires the dedicated context secret', () => {
    delete process.env.GHL_CONTEXT_API_SECRET;
    expect(() => new GhlContextSecretGuard().canActivate(contextWithHeader('secret'))).toThrow(ServiceUnavailableException);
  });

  it('rejects invalid credentials', () => {
    process.env.GHL_CONTEXT_API_SECRET = 'a-dedicated-secret-with-enough-length';
    expect(() => new GhlContextSecretGuard().canActivate(contextWithHeader('wrong-secret'))).toThrow(UnauthorizedException);
  });

  it('accepts the dedicated secret without using the webhook secret', () => {
    process.env.GHL_CONTEXT_API_SECRET = 'a-dedicated-secret-with-enough-length';
    expect(new GhlContextSecretGuard().canActivate(contextWithHeader('a-dedicated-secret-with-enough-length'))).toBe(true);
  });
});
