import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { parseEnvironment } from '@dealeradmin/config';
import { AuthModule } from './features/auth/presentation/auth.module';
import { WebhooksModule } from './features/webhooks/presentation/webhooks.module';
import { LeadsModule } from './features/leads/presentation/leads.module';
import { RoutingModule } from './features/routing/presentation/routing.module';
import { ReportsModule } from './features/reports/presentation/reports.module';

const databaseModule = TypeOrmModule.forRootAsync({
      useFactory: () => {
        const env = parseEnvironment();
        return {
          type: 'postgres' as const,
          url: env.DATABASE_URL,
          autoLoadEntities: true,
          synchronize: false,
          migrationsRun: false,
          ssl: env.DATABASE_URL.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined,
        };
      },
    });

@Module({
  imports: [
    ...(process.env.NODE_ENV === 'test' ? [] : [databaseModule]),
    AuthModule,
    WebhooksModule,
    LeadsModule,
    RoutingModule,
    ReportsModule,
  ],
})
export class AppModule {}
