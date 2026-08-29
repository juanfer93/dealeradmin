import 'reflect-metadata';
import { AppDataSource } from '../src/database/data-source';

async function main(): Promise<void> {
  const dataSource = await AppDataSource.initialize();
  try {
    const applied = await dataSource.runMigrations({ transaction: 'all' });
    console.log(`Applied ${applied.length} migration(s).`);
    for (const migration of applied) console.log(`- ${migration.name}`);
  } finally {
    await dataSource.destroy();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Migration failed.');
  process.exitCode = 1;
});
