import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const child = spawn(process.execPath, [resolve('node_modules/next/dist/bin/next'), 'start'], {
  cwd: resolve('apps/web'),
  stdio: 'inherit',
  env: { ...process.env, PORT: process.env.PORT ?? '3000' },
});

const stop = () => {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  child.kill('SIGTERM');
};

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.on('exit', (code) => process.exit(code ?? 1));
