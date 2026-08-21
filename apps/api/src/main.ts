import 'reflect-metadata';
import cookieParser from 'cookie-parser';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { parseEnvironment } from '@dealeradmin/config';

async function bootstrap(): Promise<void> {
  const env = parseEnvironment();
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.use(cookieParser());
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  await app.listen(env.PORT, '0.0.0.0');
}

void bootstrap();
