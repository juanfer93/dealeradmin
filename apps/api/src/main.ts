import 'reflect-metadata';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { NestFactory } from '@nestjs/core';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { SafeExceptionFilter } from './common/filters/safe-exception.filter';
import { parseEnvironment, parseMonthlyReportsConfig } from '@dealeradmin/config';

async function bootstrap(): Promise<void> {
  const env = parseEnvironment();
  parseMonthlyReportsConfig();
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.use(cookieParser());
  app.use(helmet());
  const configuredOrigins = env.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean);
  app.enableCors({
    origin: configuredOrigins.length > 0 ? configuredOrigins : false,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-GHL-Signature', 'X-DealerADMIN-Webhook-Secret'],
  });
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: () => new BadRequestException('Invalid request payload'),
  }));
  app.useGlobalFilters(new SafeExceptionFilter());
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  await app.listen(env.PORT, '0.0.0.0');
}

void bootstrap();
