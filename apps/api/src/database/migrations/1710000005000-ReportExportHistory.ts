import { MigrationInterface, QueryRunner } from 'typeorm';

export class ReportExportHistory1710000005000 implements MigrationInterface {
  name = 'ReportExportHistory1710000005000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS report_export_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        dealer_id UUID REFERENCES dealers(id) ON DELETE SET NULL,
        dealer_filter VARCHAR(80) NOT NULL,
        from_date DATE NOT NULL,
        to_date DATE NOT NULL,
        file_name VARCHAR(255),
        status VARCHAR(20) NOT NULL CHECK (status IN ('processing', 'completed', 'failed')),
        row_count INTEGER NOT NULL DEFAULT 0 CHECK (row_count >= 0),
        sheet_count INTEGER NOT NULL DEFAULT 0 CHECK (sheet_count >= 0),
        error_message TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMPTZ
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS report_export_history_created_idx ON report_export_history (created_at DESC)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS report_export_history_dealer_idx ON report_export_history (dealer_id, created_at DESC)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS report_export_history`);
  }
}
