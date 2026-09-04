import { DataSource } from 'typeorm';
import { InitialSchema1710000000000 } from './migrations/1710000000000-InitialSchema';
import { AddLeadFinancialDetails1710000001000 } from './migrations/1710000001000-AddLeadFinancialDetails';
import { Day5EasternsRouting1710000002000 } from './migrations/1710000002000-Day5EasternsRouting';
import { UnifyOffleaseFredericksburg1710000003000 } from './migrations/1710000003000-UnifyOffleaseFredericksburg';
import { BulkLeadIngestion1710000004000 } from './migrations/1710000004000-BulkLeadIngestion';
import { ReportExportHistory1710000005000 } from './migrations/1710000005000-ReportExportHistory';
import { DealerScopedLeadIdentity1710000006000 } from './migrations/1710000006000-DealerScopedLeadIdentity';
import { GhlLocationRouting1710000007000 } from './migrations/1710000007000-GhlLocationRouting';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL must be set before running migrations.');
}

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: databaseUrl,
  entities: [],
  migrations: [
    InitialSchema1710000000000,
    AddLeadFinancialDetails1710000001000,
    Day5EasternsRouting1710000002000,
    UnifyOffleaseFredericksburg1710000003000,
    BulkLeadIngestion1710000004000,
    ReportExportHistory1710000005000,
    DealerScopedLeadIdentity1710000006000,
    GhlLocationRouting1710000007000,
  ],
  migrationsTableName: 'migrations',
  synchronize: false,
  migrationsRun: false,
  ssl: databaseUrl.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined,
});
