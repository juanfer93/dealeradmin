import { MigrationInterface, QueryRunner } from 'typeorm';

export class MonthlyReportDeliveries1710000024000 implements MigrationInterface {
  name = 'MonthlyReportDeliveries1710000024000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS monthly_report_deliveries (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        period_key VARCHAR(7) NOT NULL UNIQUE,
        period_start TIMESTAMPTZ NOT NULL,
        period_end TIMESTAMPTZ NOT NULL,
        timezone VARCHAR(80) NOT NULL,
        from_address VARCHAR(320) NOT NULL,
        to_address VARCHAR(2000) NOT NULL,
        subject VARCHAR(255) NOT NULL,
        row_count INTEGER NOT NULL DEFAULT 0 CHECK (row_count >= 0),
        dealer_count INTEGER NOT NULL DEFAULT 0 CHECK (dealer_count >= 0),
        attachment_filename VARCHAR(255) NOT NULL,
        attachment_sha256 CHAR(64),
        status VARCHAR(24) NOT NULL CHECK (status IN ('processing', 'sent', 'failed', 'skipped_disabled', 'skipped_duplicate', 'skipped_dry_run')),
        attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
        last_error TEXT,
        next_retry_at TIMESTAMPTZ,
        provider_message_id VARCHAR(255),
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        sent_at TIMESTAMPTZ,
        CONSTRAINT monthly_report_delivery_period_order CHECK (period_start < period_end)
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS monthly_report_deliveries_status_idx ON monthly_report_deliveries (status, next_retry_at)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS monthly_report_deliveries`);
  }
}
