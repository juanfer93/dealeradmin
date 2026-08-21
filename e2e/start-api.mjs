import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const requireApiDependency = createRequire(fileURLToPath(new URL('../apps/api/package.json', import.meta.url)));
const argon2 = requireApiDependency('argon2');
const passwordHash = await argon2.hash('test-password');
const child = spawn(process.execPath, ['apps/api/dist/apps/api/src/main.js'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'test',
    PORT: '3010',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    JWT_SECRET: 'test-jwt-secret-with-at-least-32-characters',
    GHL_WEBHOOK_SECRET: 'test-ghl-secret-123456',
    ADMIN_USERNAME: 'operator',
    ADMIN_PASSWORD_HASH: passwordHash,
  },
});

const stop = () => child.kill('SIGTERM');
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.on('exit', (code) => process.exit(code ?? 1));
