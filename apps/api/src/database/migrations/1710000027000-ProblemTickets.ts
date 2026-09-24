import { MigrationInterface, QueryRunner } from 'typeorm';

export class ProblemTickets1710000027000 implements MigrationInterface {
  name = 'ProblemTickets1710000027000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS problem_tickets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        ticket_number BIGSERIAL NOT NULL UNIQUE,
        problem TEXT NOT NULL,
        evidence TEXT,
        scope TEXT,
        out_of_scope TEXT,
        markdown TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS problem_tickets_created_idx ON problem_tickets (created_at DESC)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS problem_tickets_created_idx');
    await queryRunner.query('DROP TABLE IF EXISTS problem_tickets');
  }
}
