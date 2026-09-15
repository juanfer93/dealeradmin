import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { timingSafeEqual } from 'node:crypto';

function matchesSecret(provided: string | undefined, expected: string | undefined): boolean {
  if (!provided || !expected) return false;
  const left = Buffer.from(provided.trim(), 'utf8');
  const right = Buffer.from(expected.trim(), 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

@Injectable()
export class MonthlyReportCronGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const bearer = request.header('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!matchesSecret(bearer, process.env.CRON_SECRET)) throw new UnauthorizedException('Invalid cron authorization');
    return true;
  }
}
