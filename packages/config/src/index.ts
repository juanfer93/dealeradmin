import { z } from 'zod';

export const EnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  DATABASE_URL: z.string().url().startsWith('postgres'),
  JWT_SECRET: z.string().min(32),
  GHL_WEBHOOK_SECRET: z.string().min(16),
  ADMIN_USERNAME: z.string().min(1),
  ADMIN_PASSWORD_HASH: z.string().startsWith('$argon2id$'),
  PORT: z.coerce.number().int().positive().max(65535).default(3001),
});

export type Environment = z.infer<typeof EnvironmentSchema>;

const MONTHLY_REPORTS_TRUE = 'true';

export type MonthlyReportsConfig = {
  enabled: boolean;
  from: string;
  to: string;
  timezone: string;
  sendHour: number;
  sendMinute: number;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPassword: string;
  dryRun: boolean;
};

function parseExactBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error('Monthly reports boolean configuration must be exactly true or false.');
}

function parseEmail(value: string | undefined, key: string, required: boolean): string {
  const normalized = value?.trim() ?? '';
  if (!normalized && !required) return '';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) {
    throw new Error(`Invalid monthly reports email configuration: ${key}.`);
  }
  return normalized;
}

export function parseMonthlyReportsConfig(source: NodeJS.ProcessEnv = process.env): MonthlyReportsConfig {
  const enabled = source.MONTHLY_REPORTS_ENABLED === MONTHLY_REPORTS_TRUE;
  if (!enabled) {
    return {
      enabled: false,
      from: '',
      to: '',
      timezone: 'America/Bogota',
      sendHour: 12,
      sendMinute: 0,
      smtpHost: '',
      smtpPort: 587,
      smtpSecure: false,
      smtpUser: '',
      smtpPassword: '',
      dryRun: false,
    };
  }

  const timezone = source.MONTHLY_REPORTS_TIMEZONE?.trim() || 'America/Bogota';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
  } catch {
    throw new Error('Invalid monthly reports timezone configuration.');
  }

  const sendHour = Number(source.MONTHLY_REPORTS_SEND_HOUR ?? '12');
  const sendMinute = Number(source.MONTHLY_REPORTS_SEND_MINUTE ?? '0');
  const smtpPort = Number(source.MONTHLY_REPORTS_SMTP_PORT ?? '587');
  if (!Number.isInteger(sendHour) || sendHour < 0 || sendHour > 23) {
    throw new Error('Invalid monthly reports send hour configuration.');
  }
  if (!Number.isInteger(sendMinute) || sendMinute < 0 || sendMinute > 59) {
    throw new Error('Invalid monthly reports send minute configuration.');
  }
  if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) {
    throw new Error('Invalid monthly reports SMTP port configuration.');
  }

  const smtpSecure = parseExactBoolean(source.MONTHLY_REPORTS_SMTP_SECURE, false);
  const dryRun = parseExactBoolean(source.MONTHLY_REPORTS_DRY_RUN, false);
  const from = parseEmail(source.MONTHLY_REPORTS_FROM ?? 'jfpi_0793@icloud.com', 'MONTHLY_REPORTS_FROM', true);
  const to = parseEmail(source.MONTHLY_REPORTS_TO ?? 'pixelmediacolombia@gmail.com', 'MONTHLY_REPORTS_TO', true);
  const smtpHost = source.MONTHLY_REPORTS_SMTP_HOST?.trim() || 'smtp.mail.me.com';
  const smtpUser = parseEmail(source.MONTHLY_REPORTS_SMTP_USER ?? from, 'MONTHLY_REPORTS_SMTP_USER', true);
  if (smtpUser.toLowerCase() !== from.toLowerCase()) {
    throw new Error('MONTHLY_REPORTS_SMTP_USER must match MONTHLY_REPORTS_FROM.');
  }
  const smtpPassword = source.MONTHLY_REPORTS_SMTP_PASSWORD ?? '';
  if (!smtpPassword) throw new Error('MONTHLY_REPORTS_SMTP_PASSWORD is required when monthly reports are enabled.');

  return { enabled, from, to, timezone, sendHour, sendMinute, smtpHost, smtpPort, smtpSecure, smtpUser, smtpPassword, dryRun };
}

export function parseEnvironment(source: NodeJS.ProcessEnv = process.env): Environment {
  const result = EnvironmentSchema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  return result.data;
}
