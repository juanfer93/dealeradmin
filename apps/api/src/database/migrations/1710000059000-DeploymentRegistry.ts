import { MigrationInterface, QueryRunner } from 'typeorm';

export class DeploymentRegistry1710000059000 implements MigrationInterface {
  name = 'DeploymentRegistry1710000059000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE deployment_registry (
        id BIGSERIAL PRIMARY KEY,
        target TEXT NOT NULL,
        commit_sha VARCHAR(40) NOT NULL,
        instance_id TEXT NOT NULL,
        started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        confirmed_at TIMESTAMPTZ
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_deployment_registry_target_started
      ON deployment_registry (target, started_at DESC, id DESC)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS deployment_registry');
  }
}
