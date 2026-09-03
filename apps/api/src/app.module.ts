import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { parseEnvironment } from '@dealeradmin/config';
import { AuthModule } from './features/auth/presentation/auth.module';
import { WebhooksModule } from './features/webhooks/presentation/webhooks.module';
import { LeadsModule } from './features/leads/presentation/leads.module';
import { RoutingModule } from './features/routing/presentation/routing.module';
import { ReportsModule } from './features/reports/presentation/reports.module';
import { TestFixturesModule } from './features/test-fixtures/presentation/test-fixtures.module';
import { InitialSchema1710000000000 } from './database/migrations/1710000000000-InitialSchema';
import { AddLeadFinancialDetails1710000001000 } from './database/migrations/1710000001000-AddLeadFinancialDetails';
import { Day5EasternsRouting1710000002000 } from './database/migrations/1710000002000-Day5EasternsRouting';
import { UnifyOffleaseFredericksburg1710000003000 } from './database/migrations/1710000003000-UnifyOffleaseFredericksburg';
import { BulkLeadIngestion1710000004000 } from './database/migrations/1710000004000-BulkLeadIngestion';
import { ReportExportHistory1710000005000 } from './database/migrations/1710000005000-ReportExportHistory';
import { DealerScopedLeadIdentity1710000006000 } from './database/migrations/1710000006000-DealerScopedLeadIdentity';

const databaseModule = TypeOrmModule.forRootAsync({
      useFactory: () => {
        const env = parseEnvironment();
        return {
          type: 'postgres' as const,
          url: env.DATABASE_URL,
          autoLoadEntities: true,
          synchronize: false,
          migrations: [
            InitialSchema1710000000000,
            AddLeadFinancialDetails1710000001000,
            Day5EasternsRouting1710000002000,
            UnifyOffleaseFredericksburg1710000003000,
            BulkLeadIngestion1710000004000,
            ReportExportHistory1710000005000,
            DealerScopedLeadIdentity1710000006000,
          ],
          migrationsRun: true,
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
    ...(process.env.NODE_ENV === 'test' ? [TestFixturesModule] : []),
  ],
})
export class AppModule {}
