import 'reflect-metadata';
import cookieParser from 'cookie-parser';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

type ServerlessRequest = IncomingMessage & { rawBody?: Buffer };

let appPromise: ReturnType<typeof createApp> | undefined;

async function createApp() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.use(cookieParser());
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  await app.init();
  return app;
}

export default async function handler(request: ServerlessRequest, response: ServerResponse): Promise<void> {
  appPromise ??= createApp();
  const app = await appPromise;
  const expressApplication = app.getHttpAdapter().getInstance() as (req: ServerlessRequest, res: ServerResponse) => void;
  expressApplication(request, response);
}
