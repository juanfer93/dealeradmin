import 'reflect-metadata';
import { AppDataSource } from '../src/database/data-source';

async function main(): Promise<void> {
  const dataSource = await AppDataSource.initialize();
  try {
    // A database restore/copy can preserve the rows in TypeORM's migrations
    // table without advancing its serial sequence. In that state TypeORM's
    // next migration insert collides with an existing primary key. Repair the
    // sequence before runMigrations; this is safe on a fresh database too.
    await dataSource.query(`
      DO $$
      DECLARE
        sequence_name TEXT;
        maximum_id BIGINT;
      BEGIN
        IF to_regclass('public.migrations') IS NOT NULL THEN
          SELECT pg_get_serial_sequence('public.migrations', 'id')
          INTO sequence_name;

          IF sequence_name IS NOT NULL THEN
            SELECT COALESCE(MAX(id), 0)
            INTO maximum_id
            FROM public.migrations;

            IF maximum_id > 0 THEN
              PERFORM setval(sequence_name, maximum_id, true);
            ELSE
              PERFORM setval(sequence_name, 1, false);
            END IF;
          END IF;
        END IF;
      END $$;
    `);

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
