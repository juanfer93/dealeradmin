import { MigrationInterface, QueryRunner } from 'typeorm';

export class BulkLeadIngestion1710000004000 implements MigrationInterface {
  name = 'BulkLeadIngestion1710000004000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS lead_ingestion_batches (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        dealer_id UUID NOT NULL REFERENCES dealers(id),
        source VARCHAR(40) NOT NULL DEFAULT 'operator_bulk_textarea',
        input_hash VARCHAR(64) NOT NULL,
        total_rows INTEGER NOT NULL CHECK (total_rows >= 0),
        inserted_rows INTEGER NOT NULL DEFAULT 0 CHECK (inserted_rows >= 0),
        duplicate_rows INTEGER NOT NULL DEFAULT 0 CHECK (duplicate_rows >= 0),
        invalid_rows INTEGER NOT NULL DEFAULT 0 CHECK (invalid_rows >= 0),
        status VARCHAR(20) NOT NULL DEFAULT 'processing',
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMPTZ
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS lead_ingestion_rows (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        batch_id UUID NOT NULL REFERENCES lead_ingestion_batches(id) ON DELETE CASCADE,
        row_number INTEGER NOT NULL CHECK (row_number > 0),
        source_line_hash VARCHAR(64) NOT NULL,
        parsed_name VARCHAR(255),
        parsed_phone VARCHAR(32),
        status VARCHAR(20) NOT NULL,
        reason TEXT,
        lead_id UUID REFERENCES leads(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (batch_id, row_number)
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_lead_ingestion_batches_dealer_created ON lead_ingestion_batches (dealer_id, created_at DESC)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_lead_ingestion_rows_batch_status ON lead_ingestion_rows (batch_id, status)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS lead_ingestion_rows`);
    await queryRunner.query(`DROP TABLE IF EXISTS lead_ingestion_batches`);
  }
}
