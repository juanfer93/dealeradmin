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
